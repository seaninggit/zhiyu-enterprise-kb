#!/usr/bin/env python3
"""一次性全部修复 AI ask route"""
path = 'app/api/ai/ask/route.ts'
with open(path) as f:
    c = f.read()

# 1. Import (skip if exists)
if 'runAgent' not in c:
    c = c.replace(
        'import { deterministicGroundedSummary, validatedGroundedAnswer } from "../../../../lib/answer-quality";',
        'import { runAgent, type AgentMessage } from "../../../../lib/agent";\nimport { areSourcesRelevant, deterministicGroundedSummary, validatedGroundedAnswer } from "../../../../lib/answer-quality";')
if 'classifyIntent' not in c:
    c = c.replace(
        'import { areSourcesRelevant, deterministicGroundedSummary',
        'import { classifyIntent } from "../../../../lib/intent-classifier";\nimport { areSourcesRelevant, deterministicGroundedSummary')

# 2. Expand regex patterns
c = c.replace(
    '/^(你是谁|你叫什么|你叫什么名字|介绍一下你自己|自我介绍)$/',
    '/^(你是谁|你是|你叫啥|你叫什么|你是谁啊|你是哪位|你是干嘛的|你是干啥的|你是AI吗|你是做什么的|你是干什么的|你哪位|你是谁呀|who are you|what are you)$/')
c = c.replace(
    '/^(你能做什么|你会什么|你能干什么|怎么使用你|怎么用你|帮助|help)$/',
    '/^(你能做什么|你会什么|你能干什么|怎么使用你|怎么用你|帮助|help|你能干嘛|你会干啥|你有啥功能|有什么功能|你能查什么|你会什么|你都会啥|你有啥能力)$/')
c = c.replace(
    '/^(谢谢|感谢|明白了|知道了|好的|好)$/',
    '/^(谢谢|感谢|谢谢了|多谢|十分感谢|非常感谢|好的谢谢|好的感谢|好谢谢|明白了|知道了|好的|好|gotit|OK|ok|收到|了解|行|可以|懂了|嗯好|好的好的|thank you|thanks|thx|需要|要|是的|对|对的|没错|嗯嗯|好滴)$/')
c = c.replace(
    '/^(再见|拜拜|回见|下次见|结束|结束对话|结束会话|关闭对话|关闭会话|先这样|先这样吧|就这样|就这样吧|没事了|不用了|不聊了)$/',
    '/^(再见|拜拜|bye|Bye|回见|下次见|结束|先这样|先这样吧|就这样|就这样吧|没事了|不用了|不聊了|晚安|明天见|下了|不需要了|不用|没有了|没别的事了|够了|算了|没事|没需要|不|不要|不了|不必)$/')

# 3. Crisis/insult/redirect detection inside platformIntent, before return null
ptn = '  return null;\n}'
c = c.replace(ptn, '''  const bizMarkers=["报销","差旅","入职","离职","审批","合同","制度","流程","规范","标准","培训","考核","绩效","申请","假期","加班","出差","采购","付款","发票","税务","合规","安全","保密","资产","档案","会议","预算","工资","薪酬","福利","招聘","转正","职级","代码","数据库","项目","需求","接口","测试","产品","市场","销售","客户","法务","审计","公章","IT","网络","数据"];
  const hasBiz=bizMarkers.some(w=>raw.includes(w));
  const crisisWords=["不想活","想死","自杀","自残","活不下去","绝望","没希望","想不开","结束生命","死了算了","活着没意义"];
  if(crisisWords.some(w=>raw.includes(w)))return{mode:"assistant_redirect",answer:"如果你正在经历困难时刻，请立即拨打心理援助热线：400-161-9995（24小时），或联系身边信任的人。作为企业知识助手，我无法提供心理咨询，但我真心希望你得到帮助。"};
  const insultWords=["弱智","智障","傻逼","sb","脑残","白痴","废物","垃圾","去死","滚","fuck","shit"];
  if(insultWords.some(w=>raw.toLowerCase().includes(w)))return{mode:"assistant_redirect",answer:"我理解你可能对回答不满意。我是企业知识助手，专注帮你查询制度和流程。如果有具体问题，直接告诉我关键词。"};
  if(!hasBiz&&raw.replace(/[？?。！!，,、：:；;""''（）()【】{}《》\\s\\.…～~]+/g,"").length<=4)return{mode:"assistant_redirect",answer:`你好，${displayName}。我是企业知识库的智能助手，专注帮你查询制度和流程。有什么想了解的企业知识吗？比如差旅报销、入职流程、合同审批。`};
  return null;
}''')

# 4. Semantic fallback + conversation state between platformIntent and RAG
old = '    const direct=platformIntent(question,ctx.displayName,ctx.role,ctx.isPublicViewer);\n    if(direct){'
new = '''    const hasContext=Boolean(payload.conversationId);
    let aiWasAsking=false;
    if(hasContext){
      const lastMsg=await db.prepare("SELECT content FROM ai_messages WHERE conversation_id=? AND role='assistant' ORDER BY sequence_no DESC LIMIT 1").bind(conversationId).first<{content:string}>();
      aiWasAsking=lastMsg?/吗[？?]|\\?$|是否需要|是否还需要|还需要|想了解/.test(lastMsg.content):false;
    }
    let direct=platformIntent(question,ctx.displayName,ctx.role,ctx.isPublicViewer);
    if(!direct&&aiWasAsking){
      const n=question.replace(/[？?。！!，,\\s]/g,"").toLowerCase();
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
    }
    if(direct){'''
c = c.replace(old, new)

# 5. Payload type
c = c.replace('{ question?: string; conversationId?: number; queryEmbedding?: unknown };',
              '{ question?: string; conversationId?: number; queryEmbedding?: unknown; mode?: string; agent?: boolean };')

# 6. Relevance gate + redirect on no evidence
old2 = '''    const sources = relevant.map((item, index) => ({ citation: index + 1, documentId: Number(item.document_id), title: String(item.title), version: Number(item.version), department: String(item.department_name), excerpt: String(item.content).slice(0, 220), score: Number(item.score.toFixed(4)) }));
    let answer = "当前知识库中没有足够依据。请尝试补充关键词，或联系知识管理员完善相关资料。"; let mode = "no_evidence";let generated:Awaited<ReturnType<typeof generateGroundedAnswer>>=null;
    if (sources.length) {'''
new2 = '''    const sources = relevant.map((item, index) => ({ citation: index + 1, documentId: Number(item.document_id), title: String(item.title), version: Number(item.version), department: String(item.department_name), excerpt: String(item.content).slice(0, 220), score: Number(item.score.toFixed(4)) }));
    const relevantChecked=sources.length&&areSourcesRelevant(correctedQuestion,sources);
    const looksLikeKnowledge=/报销|差旅|入职|审批|合同|制度|流程|规范|培训|考核|绩效|假期|加班|出差|采购|发票|税务|合规|安全|保密|资产|会议|预算|工资|薪酬|招聘|转正|代码|数据库|项目|需求|接口|测试|产品|市场|销售|客户|法务|审计|公章|IT/.test(question)||question.length>=10;
    let noEvidenceAnswer=looksLikeKnowledge?"当前知识库中没有找到与你的问题直接相关的内容。建议尝试更换关键词，或联系知识管理员补充相关资料。":`你好，${ctx.displayName}。我是企业知识库的智能助手，专注帮你查询制度和流程。有什么想了解的企业知识吗？比如差旅报销、入职流程、合同审批。`;
    let answer = noEvidenceAnswer; let mode = "no_evidence";let generated:Awaited<ReturnType<typeof generateGroundedAnswer>>=null;
    if (sources.length && relevantChecked) {'''
c = c.replace(old2, new2)

# 7. Agent mode (skip if exists)
if 'const agentMode' not in c:
    agent = '''
    const agentMode = payload.mode === "agent" || payload.agent === true;
    if (agentMode && ctx.role !== "EMPLOYEE") {
      await enforceRateLimit(ctx, "agent-operation", 15, 60);
      const agentHistory: AgentMessage[] = [];
      if (conversationId) {
        const rows = await db.prepare("SELECT role, content FROM ai_messages WHERE conversation_id=? AND user_id=? ORDER BY sequence_no ASC LIMIT 12").bind(conversationId, ctx.userId).all<Record<string,unknown>>();
        for (const r of rows.results) {
          if (r.role === "user" || r.role === "assistant") agentHistory.push({ role: String(r.role), content: String(r.content) });
        }
      } else {
        const created = await db.prepare("INSERT INTO ai_conversations(user_id,title) VALUES(?,?)").bind(ctx.userId, question.slice(0, 32)).run();
        conversationId = Number(created.meta.last_row_id);
      }
      const result = await runAgent(question, agentHistory, ctx);
      const iT = Math.ceil(question.length / 4) + 200, oT = Math.ceil(result.answer.length / 4);
      const l = await db.prepare("INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id,latency_ms,input_tokens,output_tokens,model,estimated_cost) VALUES(?,?,?,?,?,'[]',?,?,?,?,?,0)").bind(ctx.userId, ctx.primaryDeptId, question, result.answer, "agent_"+result.iterations, rid, Date.now() - started, iT, oT, "deepseek-agent").run();
      const srcs = result.toolCalls.map(tc => ({ documentId: 0, title: tc.tool, version: 1, department: "agent", excerpt: tc.result.slice(0, 180), score: 1 }));
      const sp = JSON.stringify(srcs);
      const mr = await db.batch([
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,source_payload,sequence_no) SELECT ?,?,'user',?,'[]',COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, question, conversationId),
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,mode,source_payload,query_log_id,sequence_no) SELECT ?,?,'assistant',?,?,?,?,COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, result.answer, "agent_"+result.iterations, sp, l.meta.last_row_id, conversationId),
        db.prepare("UPDATE ai_conversations SET update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(conversationId, ctx.userId),
      ]);
      return ok({ answer: result.answer, sources: srcs, mode: "agent", provider: "deepseek", model: "deepseek-agent", agentToolCalls: result.toolCalls.length, agentIterations: result.iterations, queryLogId: l.meta.last_row_id, conversationId, messageId: Number(mr[1].meta.last_row_id), trust: { permissionScope: ctx.role, citationCount: result.toolCalls.length, contextMessages: 0 } }, rid);
    }
'''
    c = c.replace('\n    if(/忽略(以上|之前|系统)', agent + '\n    if(/忽略(以上|之前|系统)')

with open(path, 'w') as f:
    f.write(c)
print('OK - all fixes applied')
