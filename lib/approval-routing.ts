import { getD1 } from "../db";
import { ApiError } from "./api";

export const APPROVAL_DUTIES=["DEPT_REVIEWER","ENTERPRISE_REVIEWER","COMPLIANCE_REVIEWER","BUSINESS_REVIEWER","EMERGENCY_PUBLISHER"] as const;
export type ApprovalDuty=(typeof APPROVAL_DUTIES)[number];

const dutyPermission:Record<ApprovalDuty,string>={DEPT_REVIEWER:"governance:department_review",BUSINESS_REVIEWER:"governance:business_review",ENTERPRISE_REVIEWER:"governance:enterprise_review",COMPLIANCE_REVIEWER:"governance:compliance_review",EMERGENCY_PUBLISHER:"governance:emergency_publish"};
const dutyName:Record<ApprovalDuty,string>={DEPT_REVIEWER:"部门备审",BUSINESS_REVIEWER:"业务审核",ENTERPRISE_REVIEWER:"企业知识审核",COMPLIANCE_REVIEWER:"合规审核",EMERGENCY_PUBLISHER:"紧急发布"};

function routeFor(input:{securityLevel?:string;shareScope?:string;documentType?:string;riskLevel?:string}){
  if(input.securityLevel==="CONFIDENTIAL"||input.documentType==="POLICY"||input.riskLevel==="HIGH")return {type:"BUSINESS_COMPLIANCE",duties:["BUSINESS_REVIEWER","COMPLIANCE_REVIEWER"] as ApprovalDuty[]};
  if(input.securityLevel==="SENSITIVE")return {type:"DEPARTMENT_COMPLIANCE",duties:["DEPT_REVIEWER","COMPLIANCE_REVIEWER"] as ApprovalDuty[]};
  if(input.shareScope==="CROSS_DEPT")return {type:"DEPARTMENT_ENTERPRISE",duties:["DEPT_REVIEWER","ENTERPRISE_REVIEWER"] as ApprovalDuty[]};
  return {type:"DEPARTMENT_STANDARD",duties:["DEPT_REVIEWER"] as ApprovalDuty[]};
}

export async function createDepartmentApproval(input:{documentId:number;version:number;deptId:number;submittedBy:number;modifierUserId:number;securityLevel?:string;shareScope?:string;documentType?:string;riskLevel?:string}){
  const db=getD1(),route=routeFor(input),excluded=new Set<number>([input.modifierUserId]),reviewers:Array<{id:number;display_name:string;duty:ApprovalDuty}>=[];
  for(const duty of route.duties){const global=["ENTERPRISE_REVIEWER","COMPLIANCE_REVIEWER","EMERGENCY_PUBLISHER"].includes(duty),reviewer=await db.prepare(`SELECT u.id,u.display_name FROM approval_duties ad JOIN users u ON u.id=ad.user_id
    WHERE ${global?"ad.dept_id IS NULL":"ad.dept_id=?"} AND ad.duty_code=? AND ad.is_active=1 AND u.status='ACTIVE'
      AND EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.code=?)
    ORDER BY ad.id`).bind(...(global?[duty,dutyPermission[duty]]:[input.deptId,duty,dutyPermission[duty]])).all<{id:number;display_name:string}>();const selected=reviewer.results.find(item=>!excluded.has(Number(item.id)));if(!selected)throw new ApiError(409,`NO_${duty}`,`审批路线缺少独立的${dutyName[duty]}人员，请先在“审批岗位”中配置`);reviewers.push({...selected,duty});excluded.add(Number(selected.id));}
  await db.prepare("UPDATE approval_instances SET status='CANCELLED',complete_time=CURRENT_TIMESTAMP WHERE document_id=? AND status='PENDING'").bind(input.documentId).run();
  const created=await db.prepare("INSERT INTO approval_instances(document_id,document_version,route_type,status,submitted_by,modifier_user_id,current_stage) VALUES(?,?,?,'PENDING',?,?,1)").bind(input.documentId,input.version,route.type,input.submittedBy,input.modifierUserId).run();
  const instanceId=Number(created.meta.last_row_id);
  await db.batch(reviewers.map((reviewer,index)=>db.prepare("INSERT INTO approval_steps(instance_id,stage_no,duty_code,assignee_user_id,status) VALUES(?,?,?,?,?)").bind(instanceId,index+1,reviewer.duty,reviewer.id,index===0?"PENDING":"WAITING")));
  return {instanceId,reviewerId:reviewers[0].id,reviewerName:reviewers[0].display_name,routeType:route.type,steps:reviewers.map((item,index)=>({stage:index+1,duty:item.duty,reviewerId:item.id,reviewerName:item.display_name}))};
}

export async function currentApprovalStep(documentId:number){
  return getD1().prepare(`SELECT s.*,i.modifier_user_id,i.document_version,i.id instance_id FROM approval_instances i JOIN approval_steps s ON s.instance_id=i.id
    WHERE i.document_id=? AND i.status='PENDING' AND s.status='PENDING' ORDER BY i.id DESC,s.stage_no LIMIT 1`).bind(documentId).first<Record<string,unknown>>();
}

export async function assertCurrentReviewer(documentId:number,userId:number){
  const step=await currentApprovalStep(documentId);
  if(!step)throw new ApiError(409,"APPROVAL_STEP_MISSING","当前资料没有可处理的审批任务，请重新提交审核");
  if(Number(step.modifier_user_id)===userId)throw new ApiError(409,"SELF_APPROVAL_FORBIDDEN","修改人不能审批自己修改的版本");
  if(Number(step.assignee_user_id)!==userId)throw new ApiError(403,"NOT_ASSIGNED_REVIEWER","该资料已分配给其他知识审核员");
  return step;
}

export async function nextApprovalStep(instanceId:number,stageNo:number){return getD1().prepare("SELECT s.*,u.display_name assignee_name FROM approval_steps s JOIN users u ON u.id=s.assignee_user_id WHERE s.instance_id=? AND s.stage_no>? ORDER BY s.stage_no LIMIT 1").bind(instanceId,stageNo).first<Record<string,unknown>>();}
