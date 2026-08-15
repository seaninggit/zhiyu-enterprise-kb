import type { ExpiryGovernanceConfig } from "./expiry-governance";

// 未传入到期配置时的兜底成本上限（元），与 DEFAULT_EXPIRY_GOVERNANCE_CONFIG.maxCostCny 保持一致；
// 定时入口始终传入 expiryConfig，该兜底仅覆盖直接调用 runGovernanceAgent 的场景。
const FALLBACK_MAX_COST_CNY = 0.5;

type AgentDb = D1Database;
type AgentEnv = Record<string, unknown>;

type DefinitionConfig = {
  actorUserId: number;
  maxIterations: number;
  maxToolCalls: number;
  maxDocuments: number;
  departmentIds: number[];
  allowedTools: string[];
  citationWindowDays: number;
  mediumCitationThreshold: number;
  highCitationThreshold: number;
};

type AgentDefinition = { id:number; code:string; goal:string; config_json:string; config_version:number };
type AgentContext = { db:AgentDb; env:AgentEnv; runId:number; requestId:string; actorUserId:number; departmentIds:number[]; maxDocuments:number; allowedTools:Set<string>; citationWindowDays:number; mediumCitationThreshold:number; highCitationThreshold:number; advanceDays:number; expiry:ExpiryGovernanceConfig|null; sequence:number; toolCalls:number };
type ToolCall = { id:string; function:{ name:string; arguments:string } };
type ModelRoute = { model:string; baseUrl:string; apiKey:string; provider:string };

export const toolPolicy = {
  list_expiring_documents: "READ",
  inspect_document: "READ",
  create_governance_task: "LOW",
  propose_high_risk_action: "HIGH",
} as const;

const TOOL_DEFINITIONS = [
  {type:"function",function:{name:"list_expiring_documents",description:"列出授权范围内已到或临近复核日期的有效制度，并返回引用次数和负责人。",parameters:{type:"object",properties:{advance_days:{type:"number",minimum:0,maximum:365},limit:{type:"number",minimum:1,maximum:50}},required:[]}}},
  {type:"function",function:{name:"inspect_document",description:"读取一份候选制度的元数据、正文摘要和当前未完成治理任务，用于核验证据。",parameters:{type:"object",properties:{document_id:{type:"number"}},required:["document_id"]}}},
  {type:"function",function:{name:"create_governance_task",description:"为证据充分的制度创建可撤销的低风险人工治理任务。不得用于发布、审批、作废、删除、转交或权限变更。",parameters:{type:"object",properties:{document_id:{type:"number"},reason:{type:"string"},detail:{type:"string"},due_days:{type:"number",minimum:1,maximum:90}},required:["document_id","reason","detail"]}}},
  {type:"function",function:{name:"propose_high_risk_action",description:"提出高风险动作并暂停等待人工确认；此工具绝不直接修改文档或权限。",parameters:{type:"object",properties:{action_type:{type:"string",enum:["PUBLISH","APPROVE","VOID","DELETE","TRANSFER_OWNER","CHANGE_PERMISSION"]},target_type:{type:"string",enum:["DOCUMENT","PERMISSION"]},target_id:{type:"number"},reason:{type:"string"},evidence:{type:"array",items:{type:"string"}}},required:["action_type","target_type","target_id","reason","evidence"]}}},
] as const;

function parseConfig(raw:string):DefinitionConfig {
  const value=JSON.parse(raw||"{}") as Partial<DefinitionConfig>;
  return {
    actorUserId:Math.max(1,Number(value.actorUserId||1)),
    maxIterations:Math.min(10,Math.max(1,Number(value.maxIterations||6))),
    maxToolCalls:Math.min(60,Math.max(1,Number(value.maxToolCalls||30))),
    maxDocuments:Math.min(100,Math.max(1,Number(value.maxDocuments||50))),
    departmentIds:Array.isArray(value.departmentIds)?value.departmentIds.map(Number).filter(Number.isInteger):[],
    allowedTools:Array.isArray(value.allowedTools)?value.allowedTools.filter(name=>name in toolPolicy):Object.keys(toolPolicy),
    citationWindowDays:Math.min(365,Math.max(1,Number(value.citationWindowDays||30))),
    mediumCitationThreshold:Math.min(10000,Math.max(0,Number(value.mediumCitationThreshold||3))),
    highCitationThreshold:Math.min(10000,Math.max(1,Number(value.highCitationThreshold||10))),
  };
}

async function addStep(ctx:AgentContext, kind:string, data:{tool?:string;risk?:string;input?:unknown;output?:unknown;evidence?:unknown;status?:string;durationMs?:number}) {
  ctx.sequence++;
  const result=await ctx.db.prepare("INSERT INTO agent_workflow_steps(run_id,sequence_no,kind,tool_name,risk_level,input_json,output_json,evidence_json,status,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(ctx.runId,ctx.sequence,kind,data.tool||null,data.risk||"READ",JSON.stringify(data.input||{}),JSON.stringify(data.output||{}),JSON.stringify(data.evidence||[]),data.status||"SUCCEEDED",data.durationMs||0).run();
  return Number(result.meta.last_row_id);
}

async function authorizedDepartments(db:AgentDb, actorUserId:number, configured:number[]) {
  const user=await db.prepare("SELECT u.status,MAX(CASE WHEN r.scope='global' THEN 1 ELSE 0 END) global_scope,MAX(CASE WHEN p.code IN ('governance:platform','governance:admin') THEN 1 ELSE 0 END) governance_permission FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE u.id=? GROUP BY u.id")
    .bind(actorUserId).first<{status:string;global_scope:number;governance_permission:number}>();
  if(!user||user.status!=="ACTIVE"||!user.governance_permission)throw new Error("AGENT_SERVICE_PRINCIPAL_FORBIDDEN");
  const rows=await db.prepare(user.global_scope?"SELECT id FROM departments WHERE is_active=1":"SELECT d.id FROM departments d JOIN user_departments ud ON ud.dept_id=d.id WHERE ud.user_id=? AND d.is_active=1").bind(...(user.global_scope?[]:[actorUserId])).all<{id:number}>();
  const permitted=rows.results.map(row=>Number(row.id));
  return configured.length?configured.filter(id=>permitted.includes(id)):permitted;
}

async function listExpiring(ctx:AgentContext,args:Record<string,unknown>) {
  const advance=Math.min(365,Math.max(0,Number(args.advance_days??ctx.advanceDays)));
  const limit=Math.min(ctx.maxDocuments,Math.max(1,Number(args.limit||ctx.maxDocuments)));
  if(!ctx.departmentIds.length)return {documents:[],stop:"NO_AUTHORIZED_DEPARTMENTS"};
  const marks=ctx.departmentIds.map(()=>"?").join(",");
  const rows=await ctx.db.prepare(`SELECT d.id,d.title,d.dept_id,d.review_due_at,d.owner_user_id,d.create_user_id,d.risk_level,
    (SELECT COUNT(*) FROM ai_query_logs q, json_each(q.source_document_ids) je WHERE q.create_time>date('now',?) AND CAST(je.value AS INTEGER)=d.id) citation_count
    FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND d.published_version IS NOT NULL
    AND d.review_due_at IS NOT NULL AND date(d.review_due_at)<=date('now',?) AND d.dept_id IN (${marks})
    ORDER BY date(d.review_due_at),d.id LIMIT ?`).bind(`-${ctx.citationWindowDays} day`,`+${advance} day`,...ctx.departmentIds,limit).all<Record<string,unknown>>();
  return {documents:rows.results,evidence:rows.results.map(row=>({documentId:row.id,reviewDueAt:row.review_due_at})),thresholds:{medium:ctx.mediumCitationThreshold,high:ctx.highCitationThreshold},citationWindowDays:ctx.citationWindowDays};
}

async function inspectDocument(ctx:AgentContext,args:Record<string,unknown>) {
  const id=Number(args.document_id);
  const marks=ctx.departmentIds.map(()=>"?").join(",");
  if(!id||!marks)return {error:"DOCUMENT_FORBIDDEN"};
  const doc=await ctx.db.prepare(`SELECT d.id,d.title,d.summary,substr(COALESCE(NULLIF(d.extracted_text,''),d.content),1,3000) content,d.status,d.version,d.published_version,d.review_due_at,d.dept_id,d.owner_user_id,d.risk_level FROM documents d WHERE d.id=? AND d.is_deleted=0 AND d.dept_id IN (${marks})`).bind(id,...ctx.departmentIds).first<Record<string,unknown>>();
  if(!doc)return {error:"DOCUMENT_FORBIDDEN_OR_MISSING"};
  const tasks=await ctx.db.prepare("SELECT id,type,status,workflow_stage,reason,assignee_user_id FROM knowledge_governance_tasks WHERE source_document_id=? AND status IN ('OPEN','IN_PROGRESS') ORDER BY id DESC LIMIT 10").bind(id).all();
  return {document:doc,openTasks:tasks.results,evidence:[{documentId:id,version:doc.version,status:doc.status}]};
}

async function createGovernanceTask(ctx:AgentContext,args:Record<string,unknown>) {
  const id=Number(args.document_id),reason=String(args.reason||"").trim().slice(0,60),detail=String(args.detail||"").trim().slice(0,1500),dueDays=Math.min(90,Math.max(1,Number(args.due_days||7)));
  if(!id||!reason||!detail)return {error:"INVALID_TASK_INPUT"};
  const marks=ctx.departmentIds.map(()=>"?").join(",");
  if(!marks)return {error:"NO_AUTHORIZED_DEPARTMENTS"};
  const doc=await ctx.db.prepare(`SELECT id,title,dept_id,owner_user_id,create_user_id FROM documents WHERE id=? AND is_deleted=0 AND dept_id IN (${marks})`).bind(id,...ctx.departmentIds).first<{id:number;title:string;dept_id:number;owner_user_id:number|null;create_user_id:number}>();
  if(!doc)return {error:"DOCUMENT_FORBIDDEN_OR_MISSING"};
  const existing=await ctx.db.prepare("SELECT id FROM knowledge_governance_tasks WHERE source_document_id=? AND type='EXPIRED' AND status IN ('OPEN','IN_PROGRESS') LIMIT 1").bind(id).first<{id:number}>();
  if(existing)return {taskId:existing.id,created:false,reason:"IDEMPOTENT_EXISTING_TASK"};
  const needAdmin=ctx.expiry?.assigneeStrategy==="DEPARTMENT_ADMIN"||ctx.expiry?.unownedFallback==="DEPARTMENT_ADMIN";
  const deptAdmin=needAdmin?await ctx.db.prepare("SELECT u.id FROM users u JOIN user_departments ud ON ud.user_id=u.id WHERE ud.dept_id=? AND ud.is_dept_admin=1 AND u.status='ACTIVE' ORDER BY u.id LIMIT 1").bind(doc.dept_id).first<{id:number}>():null;
  const assignee=ctx.expiry?.assigneeStrategy==="DEPARTMENT_ADMIN"
    ? deptAdmin?.id||doc.owner_user_id||doc.create_user_id
    : doc.owner_user_id||(ctx.expiry?.unownedFallback==="DEPARTMENT_ADMIN"?deptAdmin?.id:null)||doc.create_user_id;
  const finalDetail=/建议\s*\d+\s*天/.test(detail)?detail:`${detail}；建议 ${dueDays} 天内完成复核`;
  const result=await ctx.db.prepare("INSERT INTO knowledge_governance_tasks(type,status,workflow_stage,dept_id,source_document_id,reporter_user_id,assignee_user_id,reason,detail) VALUES('EXPIRED','OPEN','WAITING_OWNER',?,?,?,?,?,?)").bind(doc.dept_id,id,ctx.actorUserId,assignee,reason,finalDetail).run();
  const taskId=Number(result.meta.last_row_id);
  const batch=[
    ctx.db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'AGENT_LOW_RISK_TASK_CREATED',?,'制度到期治理 Agent',?,?)").bind(id,doc.dept_id,ctx.actorUserId,`任务 #${taskId}：${reason}`,ctx.requestId),
  ];
  if(!ctx.expiry||ctx.expiry.notifyOwner)batch.push(ctx.db.prepare("INSERT INTO notifications(user_id,type,title,content,document_id) VALUES(?,'GOVERNANCE',?,?,?)").bind(assignee,"制度复核任务",`《${doc.title}》需要处理：${finalDetail}`,id));
  await ctx.db.batch(batch);
  return {taskId,created:true,documentId:id,assigneeUserId:assignee};
}

async function proposeHighRisk(ctx:AgentContext,args:Record<string,unknown>,stepId:number) {
  const allowedActions=new Set(["PUBLISH","APPROVE","VOID","DELETE","TRANSFER_OWNER","CHANGE_PERMISSION"]);
  const allowedTargets=new Set(["DOCUMENT","PERMISSION"]);
  const action=String(args.action_type||""),targetType=String(args.target_type||"DOCUMENT"),targetId=Number(args.target_id)||null;
  if(!allowedActions.has(action))return {error:"HIGH_RISK_ACTION_INVALID"};
  if(!allowedTargets.has(targetType))return {error:"HIGH_RISK_TARGET_TYPE_INVALID"};
  if(targetType==="DOCUMENT"){
    const marks=ctx.departmentIds.map(()=>"?").join(",");
    if(!marks||!targetId)return {error:"HIGH_RISK_TARGET_FORBIDDEN_OR_MISSING"};
    const target=await ctx.db.prepare(`SELECT id FROM documents WHERE id=? AND is_deleted=0 AND dept_id IN (${marks})`).bind(targetId,...ctx.departmentIds).first<{id:number}>();
    if(!target)return {error:"HIGH_RISK_TARGET_FORBIDDEN_OR_MISSING"};
  }
  const result=await ctx.db.prepare("INSERT INTO agent_action_confirmations(run_id,step_id,action_type,target_type,target_id,proposal_json) VALUES(?,?,?,?,?,?)")
    .bind(ctx.runId,stepId,action,targetType,targetId,JSON.stringify(args)).run();
  await ctx.db.prepare("UPDATE agent_workflow_runs SET status='WAITING_CONFIRMATION',stop_reason='HIGH_RISK_CONFIRMATION_REQUIRED',update_time=CURRENT_TIMESTAMP WHERE id=?").bind(ctx.runId).run();
  return {confirmationId:Number(result.meta.last_row_id),status:"PENDING",paused:true};
}

async function executeTool(ctx:AgentContext,name:string,args:Record<string,unknown>) {
  if(!ctx.allowedTools.has(name)||!(name in toolPolicy))return {result:{error:"TOOL_NOT_ALLOWED"},risk:"READ"};
  const risk=toolPolicy[name as keyof typeof toolPolicy];
  if(name==="list_expiring_documents")return {result:await listExpiring(ctx,args),risk};
  if(name==="inspect_document")return {result:await inspectDocument(ctx,args),risk};
  if(name==="create_governance_task")return {result:await createGovernanceTask(ctx,args),risk};
  return {result:null,risk};
}

function systemPrompt(goal:string,departments:number[]) {
  return `你是企业知识治理 Agent。目标：${goal}\n授权部门ID：${departments.join(",")||"无"}。\n\n工作方法（按顺序执行，预算有限，优先保证覆盖）：\n1. 先调用 list_expiring_documents 获取全部候选制度。\n2. 逐份调用 create_governance_task 为每份候选创建任务（reason 写"制度到期复核"，detail 写明复核日期与建议完成时限；工具会自动跳过已有未关闭任务的制度）。这一步必须覆盖所有候选。\n3. 再用剩余预算对重点候选调用 inspect_document 核验证据。\n4. 发布、审批、作废、删除、责任转交和权限变更只能调用 propose_high_risk_action 并立即暂停，绝不直接修改文档。\n5. 仅当确实没有候选、文档缺失或没有权限时才停止；不得以"需要人工确认"为由跳过本可自动完成的低风险建任务。\n不得猜测企业制度，不得输出内部思维链。`;
}

async function modelRoutes(db:AgentDb,env:AgentEnv):Promise<ModelRoute[]> {
  const rows=await db.prepare("SELECT s.model_code,s.base_url,s.secret_env_key,s.provider FROM ai_scene_routes r JOIN ai_model_services s ON s.id=r.primary_service_id OR s.id=r.fallback_service_id WHERE r.scene_code='GOVERNANCE_AGENT' AND r.status='ACTIVE' AND s.status='ACTIVE' ORDER BY CASE WHEN s.id=r.primary_service_id THEN 0 ELSE 1 END").all<{model_code:string;base_url:string;secret_env_key:string;provider:string}>();
  return rows.results
    .map(row=>{const apiKey=String(env[String(row.secret_env_key||"")]||"");return apiKey?{model:String(row.model_code),baseUrl:String(row.base_url||"").replace(/\/$/,""),apiKey,provider:String(row.provider||"").toLowerCase()}:null;})
    .filter((route):route is ModelRoute=>route!==null);
}

async function requestCompletion(route:ModelRoute,messages:Array<Record<string,unknown>>,allowedTools:Set<string>) {
  const response=await fetch(`${route.baseUrl}/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${route.apiKey}`},body:JSON.stringify({model:route.model,messages,tools:TOOL_DEFINITIONS.filter(tool=>allowedTools.has(tool.function.name)),tool_choice:"auto",temperature:.2,max_tokens:1800}),signal:AbortSignal.timeout(60_000)});
  if(!response.ok)throw new Error(`MODEL_HTTP_${response.status}`);
  const payload=await response.json() as {choices?:Array<{message?:{content?:string;tool_calls?:ToolCall[]}}>;usage?:{prompt_tokens?:number;completion_tokens?:number}};
  const message=payload.choices?.[0]?.message;
  if(!message)throw new Error("MODEL_EMPTY_RESPONSE");
  return {payload,message};
}

export async function runGovernanceAgent(db:AgentDb,env:AgentEnv,input:{definitionCode:string;triggerType:string;triggerKey:string;requestId:string;expiryConfig?:ExpiryGovernanceConfig;expiryConfigVersion?:number}) {
  const definition=await db.prepare("SELECT id,code,goal,config_json,config_version FROM agent_workflow_definitions WHERE code=? AND status='ACTIVE'").bind(input.definitionCode).first<AgentDefinition>();
  if(!definition)throw new Error("AGENT_DEFINITION_INACTIVE_OR_MISSING");
  const base=parseConfig(definition.config_json),expiry=input.expiryConfig||null;
  const configuredDepts=expiry&&expiry.scopeMode==="SELECTED_DEPARTMENTS"&&expiry.departmentIds.length?expiry.departmentIds:base.departmentIds;
  const departments=await authorizedDepartments(db,base.actorUserId,configuredDepts);
  const citationWindowDays=expiry?expiry.citationWindowDays:base.citationWindowDays;
  const mediumCitationThreshold=expiry?expiry.mediumCitationThreshold:base.mediumCitationThreshold;
  const highCitationThreshold=expiry?expiry.highCitationThreshold:base.highCitationThreshold;
  const maxDocuments=expiry?expiry.maxDocumentsPerRun:base.maxDocuments;
  const advanceDays=expiry?expiry.advanceDays:30;
  const allowedTools=new Set(base.allowedTools);
  if(expiry&&expiry.taskCreationMode==="REPORT_ONLY")allowedTools.delete("create_governance_task");
  const scope={departmentIds:departments,configVersion:definition.config_version,expiryConfigVersion:input.expiryConfigVersion??null,citationWindowDays,mediumCitationThreshold,highCitationThreshold,maxDocuments,advanceDays,taskCreationMode:expiry?.taskCreationMode||"AUTO_CREATE"};
  const created=await db.prepare("INSERT OR IGNORE INTO agent_workflow_runs(definition_id,trigger_type,trigger_key,goal,status,actor_user_id,scope_json,request_id) VALUES(?,?,?,?, 'PENDING',?,?,?)").bind(definition.id,input.triggerType,input.triggerKey,definition.goal,base.actorUserId,JSON.stringify(scope),input.requestId).run();
  if(created.meta.changes===0){const existing=await db.prepare("SELECT id,status,summary FROM agent_workflow_runs WHERE definition_id=? AND trigger_key=?").bind(definition.id,input.triggerKey).first<{id:number;status:string;summary:string}>();return {runId:existing?.id,status:existing?.status,summary:existing?.summary,deduplicated:true};}
  const runId=Number(created.meta.last_row_id);
  const ctx:AgentContext={db,env,runId,requestId:input.requestId,actorUserId:base.actorUserId,departmentIds:departments,maxDocuments,allowedTools,citationWindowDays,mediumCitationThreshold,highCitationThreshold,advanceDays,expiry,sequence:0,toolCalls:0};
  await db.prepare("UPDATE agent_workflow_runs SET status='RUNNING',started_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(runId).run();
  const routes=await modelRoutes(db,env);
  if(!routes.length){await db.prepare("UPDATE agent_workflow_runs SET status='FAILED',stop_reason='MODEL_UNAVAILABLE',finished_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(runId).run();return {runId,status:"FAILED",stopReason:"MODEL_UNAVAILABLE"};}
  const messages:Array<Record<string,unknown>>=[{role:"system",content:systemPrompt(definition.goal,departments)},{role:"user",content:"开始本次制度到期治理。请基于当前数据自主规划并执行允许的工具。"}];
  let summary="",inputTokens=0,outputTokens=0,status="SUCCEEDED",stopReason="",route:ModelRoute|undefined;
  try{
    for(let iteration=0;iteration<base.maxIterations;iteration++){
      let message:{content?:string;tool_calls?:ToolCall[]}|undefined,payload:{usage?:{prompt_tokens?:number;completion_tokens?:number}}={};
      for(const candidate of routes){
        try{({payload,message}=await requestCompletion(candidate,messages,ctx.allowedTools));route=candidate;break;}
        catch(error){stopReason=error instanceof Error?error.message:"MODEL_REQUEST_FAILED";}
      }
      if(!message)throw new Error(stopReason||"MODEL_UNAVAILABLE");
      inputTokens+=Number(payload.usage?.prompt_tokens||0);outputTokens+=Number(payload.usage?.completion_tokens||0);
      const costLimit=ctx.expiry?.maxCostCny??FALLBACK_MAX_COST_CNY;
      const costSoFar=route?.provider==="deepseek"?(inputTokens*0.00000014)+(outputTokens*0.00000028):0;
      if(costSoFar>costLimit){status="FAILED";stopReason="COST_LIMIT_EXCEEDED";summary=`累计成本 ${costSoFar.toFixed(4)} 元，超过单次运行上限 ${costLimit} 元，已停止。`;break;}
      messages.push({role:"assistant",content:message.content||"",tool_calls:message.tool_calls});
      if(!message.tool_calls?.length){summary=message.content||"治理巡检完成";break;}
      for(const call of message.tool_calls){
        if(ctx.toolCalls>=base.maxToolCalls){status="PARTIAL";stopReason="TOOL_BUDGET_EXCEEDED";break;}
        ctx.toolCalls++;const started=Date.now();let args:Record<string,unknown>={};try{args=JSON.parse(call.function.arguments||"{}");}catch{args={};}
        const risk=toolPolicy[call.function.name as keyof typeof toolPolicy]||"READ";
        const stepId=await addStep(ctx,"TOOL_CALL",{tool:call.function.name,risk,input:args});
        let result:unknown;
        if(risk==="HIGH")result=await proposeHighRisk(ctx,args,stepId);else result=(await executeTool(ctx,call.function.name,args)).result;
        await addStep(ctx,"TOOL_RESULT",{tool:call.function.name,risk,input:args,output:result,evidence:(result as {evidence?:unknown})?.evidence||[],durationMs:Date.now()-started});
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify(result)});
        if((result as {paused?:boolean})?.paused){status="WAITING_CONFIRMATION";stopReason="HIGH_RISK_CONFIRMATION_REQUIRED";break;}
      }
      if(status!=="SUCCEEDED")break;
    }
    if(!summary&&status==="SUCCEEDED"){status="PARTIAL";stopReason="ITERATION_BUDGET_EXCEEDED";summary="已达到规划轮次上限，请人工查看执行链路。";}
  }catch(error){status="FAILED";stopReason=error instanceof Error?error.message:"AGENT_RUNTIME_FAILED";await addStep(ctx,"ERROR",{output:{error:stopReason},status:"FAILED"});}
  const estimatedCost=route?.provider==="deepseek"?Number(((inputTokens*0.00000014)+(outputTokens*0.00000028)).toFixed(6)):0;
  await db.prepare("UPDATE agent_workflow_runs SET status=?,summary=?,stop_reason=?,model=?,input_tokens=?,output_tokens=?,estimated_cost=?,finished_at=CASE WHEN ? IN ('SUCCEEDED','PARTIAL','FAILED','CANCELLED') THEN CURRENT_TIMESTAMP ELSE finished_at END,update_time=CURRENT_TIMESTAMP WHERE id=?")
    .bind(status,summary,stopReason,route?.model||"",inputTokens,outputTokens,estimatedCost,status,runId).run();
  return {runId,status,summary,stopReason,toolCalls:ctx.toolCalls};
}
