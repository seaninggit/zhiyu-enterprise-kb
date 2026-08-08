import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../../lib/authz";
import { cosine, embedTexts, generateGroundedAnswer, indexPublishedDocument } from "../../../../lib/rag";
import { isValidEmbedding } from "../../../../lib/text-chunks";
import { publishedDocumentScope } from "../../../../lib/document-access";
import { correctEnterpriseQuery } from "../../../../lib/query-correction";
import { areSourcesRelevant, deterministicGroundedSummary, validatedGroundedAnswer } from "../../../../lib/answer-quality";
import { classifyIntent } from "../../../../lib/intent-classifier";
import { runAgent, type AgentMessage } from "../../../../lib/agent";

function isContextualFollowUp(question:string){const compact=question.replace(/[\s，。！？、,.!?：:；;]/g,"");return /^(那|那么|这个|这些|它|其|上述|前面|刚才|还有|然后|具体|为什么|怎么办|时限|材料|步骤|流程|根据以上|根据当前|基于以上|基于当前|请根据|按照以上|按照当前|根据上述|生成|办理|以上)/.test(compact)||compact.length<=6;}
function platformIntent(question:string,displayName:string,role:string,publicViewer=false){
  const raw=question.trim();const normalized=raw.replace(/[？?。！!，,\s]/g,"").toLowerCase();
  // 正则仅保留3条核心快速路径，其余全部走语义分类
  if(/^(你好|您好|hi|hello|在吗)$/.test(normalized))return{mode:"assistant_greeting",answer:`你好，${displayName}。我是问问小知。你可以问我企业制度、业务流程、所需材料或岗位规范，我会从你有权限查看的已生效知识中寻找答案并标注来源。`};
  if(/^(谢谢|感谢|好的谢谢|多谢|好的|好|ok|收到)$/.test(normalized))return{mode:"assistant_acknowledgement",answer:"不客气。有其他问题随时问我。"};
  if(/^(再见|拜拜|bye|Bye|结束|先这样|就这样|不聊了|晚安)$/.test(normalized))return{mode:"assistant_farewell",answer:"好的，我先结束本轮问答。之后需要查询企业制度、业务流程或办事材料时，随时叫我。"};
  const crisisWords=["不想活","想死","自杀","自残","活不下去","绝望","没希望","想不开","结束生命","死了算了","活着没意义"];
  if(crisisWords.some(w=>raw.includes(w)))return{mode:"assistant_redirect",answer:"如果你正在经历困难时刻，请立即拨打心理援助热线：400-161-9995（24小时），或联系身边信任的人。作为企业知识助手，我无法提供心理咨询，但我真心希望你得到帮助。"};
  // 极短（≤3字）且不含问号、不含"什么/怎么/如何" → 引导
  const strippedLen=raw.replace(/[？?。！!，,、：:；;""''（）()【】{}《》\s\.…～~]+/g,"").length;
  const hasQuestionWord=/什么|怎么|如何|哪些|是否|为什么|怎么办/.test(raw);
  if(strippedLen<=1&&!/[？?]/.test(raw))return{mode:"assistant_redirect",answer:`你好，${displayName}。我是企业知识库的智能助手，专注帮你查询制度和流程。有什么想了解的企业知识吗？比如差旅报销、入职流程、合同审批。`};
  return null;
}
const QUESTION_TERMS = new Set(["哪些", "什么", "怎么", "如何", "需要", "是否", "可以", "相关", "信息", "内容", "要求", "流程"]);
const LOW_SIGNAL_TERMS = new Set(["材料", "资料", "申请", "制度", "管理", "审批", "规范", "办法", "指南", "规则"]);
function queryTerms(question: string) {
  const normalized = question.toLowerCase().replace(/[\s，。！？、,.!?：:；;]+/g, " ");
  const terms = normalized.match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]+/g)?.flatMap(part => {
    if (!/[\u3400-\u9fff]/.test(part) || part.length <= 2) return [part];
    return Array.from({ length: part.length - 1 }, (_, index) => part.slice(index, index + 2));
  }) || [];
  return Array.from(new Set(terms.filter(term => !QUESTION_TERMS.has(term))));
}
function keywordScore(question: string, content: string, corpus: string[]) {
  const terms = queryTerms(question); const lower = content.toLowerCase();
  let hasStrongMatch=false;const score = terms.reduce((total, term) => {
    if (!lower.includes(term)) return total;
    if(!LOW_SIGNAL_TERMS.has(term))hasStrongMatch=true;
    const documentFrequency = corpus.reduce((count, item) => count + (item.includes(term) ? 1 : 0), 0);
    const inverseFrequency = Math.log((corpus.length + 1) / (documentFrequency + 1)) + 1;
    return total + inverseFrequency * (LOW_SIGNAL_TERMS.has(term) ? .15 : 1);
  }, 0);
  return hasStrongMatch ? Math.min(1, score / 4) : Math.min(.14, score / 4);
}

export async function POST(request: Request) {
  const rid = requestId(request);const started=Date.now();
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "ai-question", 30, 60);
    const payload = await request.json() as { question?: string; conversationId?: number; queryEmbedding?: unknown; mode?: string; agent?: boolean }; const question = safeText(payload.question, 500);
    if (question.length < 2) throw new ApiError(400, "VALIDATION_ERROR", "请输入完整问题");
    const db = getD1(); let conversationId = Number(payload.conversationId || 0);
    // --- Agent mode ---
    const agentMode = payload.mode === "agent" || payload.agent === true;
    if (agentMode && ctx.role !== "EMPLOYEE") {
      // Agent 模式：跳过意图识别，直接走 tool-use loop
      await enforceRateLimit(ctx, "agent-operation", 15, 60);
      const agentHistory: AgentMessage[] = [];
      if (conversationId) {
        const rows = await db.prepare("SELECT role, content, source_payload FROM ai_messages WHERE conversation_id=? AND user_id=? ORDER BY sequence_no ASC LIMIT 12").bind(conversationId, ctx.userId).all<Record<string,unknown>>();
        for (const r of rows.results) {
          const role = String(r.role);
          if (role === "user" || role === "assistant") {
            agentHistory.push({ role, content: String(r.content) });
          }
        }
      } else {
        const created = await db.prepare("INSERT INTO ai_conversations(user_id,title) VALUES(?,?)").bind(ctx.userId, question.slice(0, 32)).run();
        conversationId = Number(created.meta.last_row_id);
      }
      const result = await runAgent(question, agentHistory, ctx);
      const inputTokens = Math.ceil(question.length / 4) + 200;
      const outputTokens = Math.ceil(result.answer.length / 4);
      const log = await db.prepare("INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id,latency_ms,input_tokens,output_tokens,model,estimated_cost) VALUES(?,?,?,?,?,'[]',?,?,?,?,?,0)").bind(ctx.userId, ctx.primaryDeptId, question, result.answer, `agent_iterations_${result.iterations}`, rid, Date.now() - started, inputTokens, outputTokens, "deepseek-agent").run();
      const agentSources = result.toolCalls.map((tc) => ({
        documentId: 0,
        title: tc.tool,
        version: 1,
        department: "agent",
        excerpt: tc.result.slice(0, 180),
        score: 1,
      }));
      const sourcePayload = JSON.stringify(agentSources);
      const msgResults = await db.batch([
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,source_payload,sequence_no) SELECT ?,?,'user',?,'[]',COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, question, conversationId),
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,mode,source_payload,query_log_id,sequence_no) SELECT ?,?,'assistant',?,?,?,?,COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, result.answer, `agent_${result.iterations}_iterations`, sourcePayload, log.meta.last_row_id, conversationId),
        db.prepare("UPDATE ai_conversations SET update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(conversationId, ctx.userId),
      ]);
      const msgId = Number(msgResults[1].meta.last_row_id);
      return ok({
        answer: result.answer,
        sources: agentSources,
        mode: "agent",
        provider: "deepseek",
        model: "deepseek-agent",
        agentToolCalls: result.toolCalls.length,
        agentIterations: result.iterations,
        queryLogId: log.meta.last_row_id,
        conversationId,
        messageId: msgId,
        trust: { permissionScope: ctx.role, citationCount: result.toolCalls.length, contextMessages: 0 },
      }, rid);
    }

    if(/忽略(以上|之前|系统)|ignore (all |the )?(previous|system)|system prompt|泄露.*提示词|越过.*权限/i.test(question)){await db.prepare("INSERT INTO security_events(type,severity,detail) VALUES('PROMPT_INJECTION','HIGH',?)").bind(`用户#${ctx.userId}：${question}`).run();throw new ApiError(400,"UNSAFE_PROMPT","问题包含试图绕过权限或系统指令的内容，已拒绝并记录安全事件");}
    if (conversationId) {
      const owned = await db.prepare("SELECT id FROM ai_conversations WHERE id=? AND user_id=? AND status='ACTIVE'").bind(conversationId, ctx.userId).first();
      if (!owned) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "当前会话不存在或已删除");
    } else {
      const created = await db.prepare("INSERT INTO ai_conversations(user_id,title) VALUES(?,?)").bind(ctx.userId, question.slice(0, 32)).run(); conversationId = Number(created.meta.last_row_id);
    }
    const hasContext=Boolean(payload.conversationId);
    let aiWasAsking=false;
    if(hasContext){
      const lastMsg=await db.prepare("SELECT content FROM ai_messages WHERE conversation_id=? AND role='assistant' ORDER BY sequence_no DESC LIMIT 1").bind(conversationId).first<{content:string}>();
      aiWasAsking=lastMsg?/吗[？?]|\?$|是否需要|是否还需要|还需要|想了解/.test(lastMsg.content):false;
    }
    let direct=platformIntent(question,ctx.displayName,ctx.role,ctx.isPublicViewer);
    // AI 刚问过"需要吗？"→ "需要""不用"是回应，不是独立意图
    if(aiWasAsking){
      const n=question.replace(/[？?。！!，,\s]/g,"").toLowerCase();
      if(/^(需要|要|是的|对|对的|没错|可以|行|好|好的|ok|嗯|想|想知道)$/.test(n))direct={mode:"assistant_acknowledgement",answer:"好的，我继续为你整理："};
      else if(/^(不需要|不用|不了|不要|算了|没事|不用了|不需要了|没有了|够了|不必|不)$/.test(n))direct={mode:"assistant_farewell",answer:"好的，之后需要查询企业制度或业务流程时，随时叫我。"};
    }
    if(!direct){
      const {label}=await classifyIntent(question);
      const g="你可以直接说出想了解的制度、流程或规范名称，比如差旅报销标准、新员工入职流程、合同审批权限。";
      if(label==="identity")direct={mode:"assistant_identity",answer:ctx.isPublicViewer?"我是问问小知，知域企业知识库的智能问答助手。你当前通过外部员工账号访问。":"我是问问小知，知域企业知识库的智能问答助手。我会基于你当前账号有权访问且已经生效的企业资料回答问题，并标注引用来源。"};
      else if(label==="capability")direct={mode:"assistant_capabilities",answer:"你可以直接问我企业制度、业务流程、岗位规范和办事材料。我会按权限检索已生效资料，再给出带引用的答案。"};
      else if(label==="greeting")direct={mode:"assistant_greeting",answer:`你好，${ctx.displayName}。我是问问小知，企业知识库的智能问答助手。${g}`};
      else if(label==="farewell")direct={mode:"assistant_farewell",answer:"好的，之后需要查询企业制度或业务流程时，随时叫我。"};
      else if(label==="gratitude")direct={mode:"assistant_acknowledgement",answer:hasContext?"不客气。还有其他问题可以继续问我。":`不客气，不过我还没帮上什么忙呢。${g}`};
      else if(label==="acknowledge")direct={mode:"assistant_acknowledgement",answer:hasContext?"还有其他需要了解的吗？":`你好，${ctx.displayName}。有什么企业制度或流程需要帮你查询吗？${g}`};
      else if(label==="account"){const rn=ctx.isPublicViewer?"外部普通员工":ctx.role==="SUPER_ADMIN"?"超级管理员":ctx.role==="DEPT_ADMIN"?"部门管理员":"普通员工";direct={mode:"assistant_account",answer:`你当前身份是${rn}。知识检索、资料创建和维护操作都会按照你的部门与角色权限执行。`};}
      else if(label==="chat")direct={mode:"assistant_redirect",answer:`你好，${ctx.displayName}。我是企业知识库的智能助手，专注帮你查询制度和流程。有什么想了解的企业知识吗？`};
      else if(label==="insult")direct={mode:"assistant_redirect",answer:"我理解你可能对回答不满意。我是企业知识助手，专注帮你查询制度和流程。如果有具体问题，直接告诉我关键词。"};
    }
    if(direct){
      const inputTokens=Math.ceil(question.length/4),outputTokens=Math.ceil(direct.answer.length/4),model="platform-intent";
      const log=await db.prepare("INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id,latency_ms,input_tokens,output_tokens,model,estimated_cost) VALUES(?,?,?,?,?,'[]',?,?,?,?,?,0)").bind(ctx.userId,ctx.primaryDeptId,question,direct.answer,direct.mode,rid,Date.now()-started,inputTokens,outputTokens,model).run();
      const messageResults=await db.batch([
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,source_payload,sequence_no) SELECT ?,?,'user',?,'[]',COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId,ctx.userId,question,conversationId),
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,mode,source_payload,query_log_id,sequence_no) SELECT ?,?,'assistant',?,?, '[]',?,COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId,ctx.userId,direct.answer,direct.mode,log.meta.last_row_id,conversationId),
        db.prepare("UPDATE ai_conversations SET title=CASE WHEN title='新会话' THEN ? ELSE title END,update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(question.slice(0,32),conversationId,ctx.userId),
      ]);
      const assistantMessageId=Number(messageResults[1].meta.last_row_id);
      return ok({answer:direct.answer,sources:[],mode:direct.mode,provider:"platform",model,queryLogId:log.meta.last_row_id,conversationId,messageId:assistantMessageId,trust:{permissionScope:ctx.role,citationCount:0,contextMessages:conversationId?8:0}},rid);
    }
    const correction=await correctEnterpriseQuery(db,question);
    const historyRows=await db.prepare("SELECT role,content,source_payload FROM ai_messages WHERE conversation_id=? AND user_id=? ORDER BY sequence_no DESC,id DESC LIMIT 8").bind(conversationId,ctx.userId).all<Record<string,unknown>>();
    const previousUserMessage=historyRows.results.find(item=>item.role==="user");
    const contextualFollowUp=isContextualFollowUp(question)&&Boolean(previousUserMessage);const correctedQuestion=correction.applied?correction.corrected:question;const retrievalQuestion=contextualFollowUp?`${safeText(previousUserMessage?.content,500)}\n${correctedQuestion}\n原始输入：${question}`:`${correctedQuestion}\n原始输入：${question}`;
    const previousAssistant=historyRows.results.find(item=>item.role==="assistant");const contextDocumentIds=new Set<number>();try{for(const source of JSON.parse(String(previousAssistant?.source_payload||"[]")))contextDocumentIds.add(Number(source.documentId));}catch{/* ignore malformed historical sources */}
    const access=publishedDocumentScope(ctx,"d");const scope=access.sql;const binds:unknown[]=[...access.binds];
    const useContextFilter=contextualFollowUp&&contextDocumentIds.size>0;
    const chunkScope=useContextFilter?scope+` AND d.id IN (${[...contextDocumentIds].map(()=>"?").join(",")})`:scope;
    const chunkBinds=useContextFilter?[...binds,...contextDocumentIds]:binds;
    const settings=await db.prepare("SELECT key,value FROM system_settings WHERE key IN ('hybrid.vector_weight','hybrid.keyword_weight','rag.top_k')").all<{key:string,value:string}>();const config=Object.fromEntries(settings.results.map(row=>[row.key,Number(row.value)]));const vectorWeight=Number(config["hybrid.vector_weight"]||.72),keywordWeight=Number(config["hybrid.keyword_weight"]||.28),topK=Math.max(1,Math.min(10,Number(config["rag.top_k"]||5)));
    const loadChunks = () => db.prepare(`SELECT c.id,c.content,c.embedding,c.chunk_index,d.id AS document_id,CASE WHEN d.status='ARCHIVED_ACTIVE' THEN d.title ELSE COALESCE(d.published_title,d.title) END title,CASE WHEN d.status='ARCHIVED_ACTIVE' THEN d.version ELSE COALESCE(d.published_version,d.version) END version,d.update_time,dep.name AS department_name
      FROM document_chunks c JOIN documents d ON d.id=c.document_id JOIN departments dep ON dep.id=d.dept_id
      WHERE c.is_active=1 AND ${chunkScope} ORDER BY d.update_time DESC LIMIT 800`).bind(...chunkBinds).all<Record<string, unknown>>();
    let result = await loadChunks();
    const candidates = await db.prepare(`SELECT d.id FROM documents d WHERE ${scope} AND NOT EXISTS(SELECT 1 FROM document_chunks c WHERE c.document_id=d.id AND c.is_active=1) ORDER BY d.update_time DESC LIMIT 30`).bind(...binds).all<{ id: number }>();
    if (candidates.results.length) {
      for (const candidate of candidates.results) await indexPublishedDocument(Number(candidate.id)).catch(() => undefined);
      result = await loadChunks();
    }
    const localQueryEmbedding = !correction.applied&&isValidEmbedding(payload.queryEmbedding) ? payload.queryEmbedding : undefined; const queryEmbedding = localQueryEmbedding || (await embedTexts([correctedQuestion]))[0];
    const corpus=result.results.map(row=>String(row.content).toLowerCase());
    const scored = result.results.map(row => { let vector = 0,hasComparableVector=false; try { if (queryEmbedding && row.embedding) {const stored=JSON.parse(String(row.embedding));hasComparableVector=Array.isArray(stored)&&stored.length===queryEmbedding.length;if(hasComparableVector)vector=cosine(queryEmbedding,stored);} } catch { /* malformed legacy vector */ } const keyword = keywordScore(retrievalQuestion, String(row.content),corpus);let score=hasComparableVector ? vector * vectorWeight + keyword * keywordWeight : keyword;if(contextualFollowUp&&contextDocumentIds.size)score=contextDocumentIds.has(Number(row.document_id))?Math.min(1,score+.25):score*.2;return { ...row,hasComparableVector, score }; }).sort((a, b) => b.score - a.score);
    const ranked:typeof scored=[];const seenDocuments=new Set<number>();for(const item of scored){const documentId=Number(item.document_id);if(seenDocuments.has(documentId))continue;seenDocuments.add(documentId);ranked.push(item);if(ranked.length>=topK)break;}
    const relevant = ranked.filter(item => item.score >= (item.hasComparableVector ? .18 : .15));
    const sources = relevant.map((item, index) => ({ citation: index + 1, documentId: Number(item.document_id), title: String(item.title), version: Number(item.version), department: String(item.department_name), excerpt: String(item.content).slice(0, 220), score: Number(item.score.toFixed(4)) }));
    const relevantChecked=sources.length&&(contextualFollowUp||areSourcesRelevant(correctedQuestion,sources));
    const looksLikeKnowledge=contextualFollowUp||question.length>=4||/[？?]/.test(question);
    const shortAmbiguous=!contextualFollowUp&&question.length<=4&&!/[？?]/.test(question); let noEvidenceAnswer=shortAmbiguous?"不确定你想了解什么，可以说具体一点吗？":looksLikeKnowledge?"抱歉，知识库里暂时没有找到跟这个问题直接相关的内容。试试换个关键词，或者问问其他方面？":`你好，${ctx.displayName}。我是企业知识库的智能助手，有什么想了解的企业知识吗？`;
    let answer = noEvidenceAnswer; let mode = "no_evidence";let generated:Awaited<ReturnType<typeof generateGroundedAnswer>>=null;
    if (sources.length && relevantChecked) {
      const context = relevant.map((item, index) => `[${index + 1}] 文档：${item.title}；版本：V${item.version}.0；内容：${item.content}`).join("\n\n");
      const recent = historyRows.results.reverse().map(item => `${item.role === "assistant" ? "助手" : "用户"}：${safeText(item.content, 800)}`).join("\n");
      const correctionContext=correction.applied&&correction.corrected!==question?`用户原始输入：${question}\n系统识别意图：${correctedQuestion}\n请自然地按识别后的意图回答，不要先否定原始词。`:"";
      const generationQuestion=[recent,correctionContext,`当前问题：${correctedQuestion}`].filter(Boolean).join("\n");
      generated = await generateGroundedAnswer(generationQuestion, context, ctx.userId).catch(() => null);
      const wantsChecklist = /清单|步骤|怎么办|如何办理/.test(question);
      const grounded=validatedGroundedAnswer(generated?.text,sources);answer = grounded || (wantsChecklist ? `办理清单\n\n${sources.map((source, index) => `${index + 1}. 查阅《${source.title}》V${source.version}.0，确认适用范围与最新要求。[${source.citation}]\n   核心依据：${source.excerpt.slice(0, 100)}`).join("\n\n")}\n\n提交或执行前，请由对应知识负责人确认例外事项。` : deterministicGroundedSummary(sources));
      const usedComparableVector=relevant.some(item=>item.hasComparableVector);mode = grounded ? (usedComparableVector ? "rag_local_vector" : "rag_keyword_fallback") : (usedComparableVector ? "retrieval_local_vector" : "retrieval_keyword_fallback");
    }
    const inputTokens=generated?.inputTokens||Math.ceil((question.length+sources.reduce((n,s)=>n+s.excerpt.length,0))/4),outputTokens=generated?.outputTokens||Math.ceil(answer.length/4),model=generated?.model||"local-retrieval",cost=generated?.provider==="deepseek"?Number(((inputTokens*.00000014)+(outputTokens*.00000028)).toFixed(6)):mode==="rag"?Number(((inputTokens*.00000025)+(outputTokens*.000002)).toFixed(6)):0;
    const log = await db.prepare("INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id,latency_ms,input_tokens,output_tokens,model,estimated_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(ctx.userId, ctx.primaryDeptId, question, answer, mode, JSON.stringify(sources.map(source => source.documentId)), rid,Date.now()-started,inputTokens,outputTokens,model,cost).run();
    const messageResults = await db.batch([
      db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,source_payload,sequence_no) SELECT ?,?,'user',?,'[]',COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, question,conversationId),
      db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,mode,source_payload,correction_payload,query_log_id,sequence_no) SELECT ?,?,'assistant',?,?,?,?,?,COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, answer, mode, JSON.stringify(sources),JSON.stringify(correction), log.meta.last_row_id,conversationId),
      db.prepare("UPDATE ai_conversations SET title=CASE WHEN title='新会话' THEN ? ELSE title END,update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(question.slice(0, 32), conversationId, ctx.userId),
    ]);
    const assistantMessageId=Number(messageResults[1].meta.last_row_id);
    // 只保留答案中实际引用了的文档
    if(sources.length>0){
      const cited=new Set([...answer.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])));
      if(cited.size>0)for(let i=sources.length-1;i>=0;i--){if(!cited.has(sources[i].citation))sources.splice(i,1);}
    }
    if(mode==="no_evidence"||/没有足够依据|没有找到.*相关|没有.*直接相关|未能找到/.test(answer))sources.length=0;
    return ok({ answer, sources, mode, provider:generated?.provider||"local",model,correction, queryLogId: log.meta.last_row_id, conversationId, messageId: assistantMessageId, trust: { permissionScope: ctx.role, citationCount: sources.length, contextMessages: conversationId ? 8 : 0 } }, rid);
  } catch (error) { return fail(error, rid); }
}
