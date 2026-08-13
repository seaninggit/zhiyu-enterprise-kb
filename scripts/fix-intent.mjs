#!/usr/bin/env node
// 修复 AI ask route：扩展正则 + 接入语义分类器 + Agent 模式
import { readFileSync, writeFileSync } from 'fs';

const path = new URL('../app/api/ai/ask/route.ts', import.meta.url).pathname;
let code = readFileSync(path, 'utf8');

// 1. 扩展正则：身份询问
code = code.replace(
  /^(你是谁\|你叫什么\|你叫什么名字\|介绍一下你自己\|自我介绍)/,
  "^(你是谁|你是|你叫啥|你叫什么|你是谁啊|你是哪位|你是干嘛的|你是干啥的|你是AI吗|你是做什么的|你是干什么的|你哪位|who are you|what are you)"
);

// 2. 扩展正则：能力询问
code = code.replace(
  /^(你能做什么\|你会什么\|你能干什么\|怎么使用你\|怎么用你\|帮助\|help)/,
  "^(你能做什么|你会什么|你能干什么|怎么使用你|怎么用你|帮助|help|你能干嘛|你会干啥|你有啥功能|有什么功能|你能查什么)"
);

// 3. 扩展正则：感谢/确认
code = code.replace(
  /^(谢谢\|感谢\|明白了\|知道了\|好的\|好)\$/,
  "^(谢谢|感谢|谢谢了|多谢|十分感谢|非常感谢|好的谢谢|好的感谢|好谢谢|明白了|知道了|好的|好|got it|OK|ok|收到|了解|行|可以|懂了|嗯好|好的好的|thank you|thanks|thx)$"
);

// 4. 扩展正则：告别
code = code.replace(
  /^(再见\|拜拜\|回见\|下次见\|结束\|结束对话\|结束会话\|关闭对话\|关闭会话\|先这样\|先这样吧\|就这样\|就这样吧\|没事了\|不用了\|不聊了)/,
  "^(再见|拜拜|bye|Bye|回见|下次见|结束|先这样|先这样吧|就这样|就这样吧|没事了|不用了|不聊了|晚安|明天见|下了)"
);

// 5. 在 platformIntent 的 return null 之后插入语义兜底 + Agent 模式
const hasContext = `    const hasContext=Boolean(payload.conversationId);
    let direct=platformIntent(question,ctx.displayName,ctx.role,ctx.isPublicViewer);
    if(!direct){
      const {label}=await classifyIntent(question);
      const g="你可以直接说出想了解的制度、流程或规范名称，比如差旅报销标准、新员工入职流程、合同审批权限。";
      if(label==="identity")direct={mode:"assistant_identity",answer:ctx.isPublicViewer?"我是问问小知，知域企业知识库的智能问答助手。你当前通过外部员工账号访问，可以上传和维护自己创建的资料、提交部门审核、搜索知识并使用带引用的AI问答；审批和全局治理仍由相应管理员负责。":"我是问问小知，知域企业知识库的智能问答助手。我会基于你当前账号有权访问且已经生效的企业资料回答问题，并标注引用来源。"};
      else if(label==="capability")direct={mode:"assistant_capabilities",answer:"你可以直接问我企业制度、业务流程、岗位规范和办事材料。我会先按你的账号权限检索已生效资料，再给出带引用的答案。你还可以继续追问、生成办理清单、打开引用原文、收藏或订阅资料；如果答案不准确，可点'没解决'进入知识治理待办。"};
      else if(label==="greeting")direct={mode:"assistant_greeting",answer:\`你好，\$\{ctx.displayName\}。我是问问小知，企业知识库的智能问答助手。\$\{g\}\`};
      else if(label==="farewell")direct={mode:"assistant_farewell",answer:"好的，之后需要查询企业制度或业务流程时，随时叫我。"};
      else if(label==="gratitude")direct={mode:"assistant_acknowledgement",answer:hasContext?"不客气。还有其他问题可以继续问我。":\`不客气，不过我还没帮上什么忙呢。\$\{g\}\`};
      else if(label==="acknowledge")direct={mode:"assistant_acknowledgement",answer:hasContext?"还有其他需要了解的吗？":\`你好，\$\{ctx.displayName\}。有什么企业制度或流程需要帮你查询吗？\$\{g\}\`};
      else if(label==="account"){const rn=ctx.isPublicViewer?"外部普通员工":ctx.role==="SUPER_ADMIN"?"超级管理员":ctx.role==="DEPT_ADMIN"?"部门管理员":"普通员工";direct={mode:"assistant_account",answer:\`你当前身份是\$\{rn\}。知识检索、资料创建和维护操作都会按照你的部门与角色权限执行。\`};}
    }`;

// Replace the old platformIntent call + direct check
code = code.replace(
  /    const direct=platformIntent\(question,ctx\.displayName,ctx\.role,ctx\.isPublicViewer\);\n    if\(direct\)\{/,
  hasContext + '\n    if(direct){'
);

// 6. Add Agent mode after the payload parsing
const payloadLine = 'const payload = await request.json() as { question?: string; conversationId?: number; queryEmbedding?: unknown };';
code = code.replace(
  payloadLine,
  payloadLine.replace('unknown };', 'unknown; mode?: string; agent?: boolean };')
);

// Add agent mode block after conversation setup
const agentBlock = `    const agentMode = payload.mode === "agent" || payload.agent === true;
    if (agentMode && ctx.role !== "EMPLOYEE") {
      await enforceRateLimit(ctx, "agent-operation", 15, 60);
      const agentHistory: AgentMessage[] = [];
      if (conversationId) {
        const rows = await db.prepare("SELECT role, content FROM ai_messages WHERE conversation_id=? AND user_id=? ORDER BY sequence_no ASC LIMIT 12").bind(conversationId, ctx.userId).all<Record<string,unknown>>();
        for (const r of rows.results) {
          const role = String(r.role);
          if (role === "user" || role === "assistant") agentHistory.push({ role, content: String(r.content) });
        }
      } else {
        const created = await db.prepare("INSERT INTO ai_conversations(user_id,title) VALUES(?,?)").bind(ctx.userId, question.slice(0, 32)).run();
        conversationId = Number(created.meta.last_row_id);
      }
      const result = await runAgent(question, agentHistory, ctx);
      const iT = Math.ceil(question.length / 4) + 200, oT = Math.ceil(result.answer.length / 4);
      const l = await db.prepare("INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id,latency_ms,input_tokens,output_tokens,model,estimated_cost) VALUES(?,?,?,?,?,'[]',?,?,?,?,?,0)").bind(ctx.userId, ctx.primaryDeptId, question, result.answer, \`agent_\${result.iterations}\`, rid, Date.now() - started, iT, oT, "deepseek-agent").run();
      const srcs = result.toolCalls.map(tc => ({ documentId: 0, title: tc.tool, version: 1, department: "agent", excerpt: tc.result.slice(0, 180), score: 1 }));
      const sp = JSON.stringify(srcs);
      const mr = await db.batch([
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,source_payload,sequence_no) SELECT ?,?,'user',?,'[]',COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, question, conversationId),
        db.prepare("INSERT INTO ai_messages(conversation_id,user_id,role,content,mode,source_payload,query_log_id,sequence_no) SELECT ?,?,'assistant',?,?,?,?,COALESCE(MAX(sequence_no),0)+1 FROM ai_messages WHERE conversation_id=?").bind(conversationId, ctx.userId, result.answer, \`agent_\${result.iterations}\`, sp, l.meta.last_row_id, conversationId),
        db.prepare("UPDATE ai_conversations SET update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(conversationId, ctx.userId),
      ]);
      return ok({ answer: result.answer, sources: srcs, mode: "agent", provider: "deepseek", model: "deepseek-agent", agentToolCalls: result.toolCalls.length, agentIterations: result.iterations, queryLogId: l.meta.last_row_id, conversationId, messageId: Number(mr[1].meta.last_row_id), trust: { permissionScope: ctx.role, citationCount: result.toolCalls.length, contextMessages: 0 } }, rid);
    }`;

const convCheck = 'if (conversationId) {';
code = code.replace(
  new RegExp('(' + convCheck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')'),
  agentBlock + '\n    ' + convCheck
);

writeFileSync(path, code);
console.log('Done. File updated:', path);
