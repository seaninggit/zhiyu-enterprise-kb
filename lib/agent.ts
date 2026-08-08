/**
 * 知域 · Knowledge Ops Agent
 *
 * 给 DeepSeek 配上 6 个企业知识操作工具，让它能从"回答问题"升级为"执行治理任务"。
 * 核心：tool-use loop — AI 调用工具 → 系统执行 → AI 分析结果 → 决定下一步 → 最终回复。
 */
import { env } from "cloudflare:workers";
import { getD1 } from "../db";
import { safeText } from "./api";
import { type AuthContext } from "./authz";
import { publishedDocumentScope } from "./document-access";

type RuntimeEnv = { AI_PROVIDER?: string; AI_CHAT_MODEL?: string; AI_BASE_URL?: string; DEEPSEEK_API_KEY?: string; OPENAI_API_KEY?: string; };
function runtime() { return env as unknown as RuntimeEnv; }

// ---- Agent Request/Response Types ----

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface AgentResult {
  answer: string;
  toolCalls: { tool: string; args: unknown; result: string }[];
  iterations: number;
}

// ---- Tool Definitions (OpenAI/DeepSeek function-calling format) ----

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description: "在企业知识库中语义搜索文档。用于查找相关制度、流程、规范等。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索查询，使用业务术语" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "inspect_document",
      description: "读取指定文档的完整内容和元数据（标题、摘要、正文、版本、状态、负责人）。",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "number", description: "文档ID" },
        },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_documents",
      description: "列出指定条件下的文档列表。用于巡检过期、草稿、待审核等文档。",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["expired", "draft", "review", "published", "failed_parse"],
            description: "文档状态：expired=已过期, draft=草稿, review=待审核, published=已发布, failed_parse=解析失败",
          },
          limit: {
            type: "number",
            description: "返回数量上限，默认15，最大50",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_similar",
      description: "查找与指定文本内容语义相似的文档，用于检测重复内容或发现相关知识。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "用于比对的描述文本" },
          limit: {
            type: "number",
            description: "返回数量上限，默认5",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "batch_archive",
      description: "批量作废指定文档。操作将写入审计日志。仅管理员可用。",
      parameters: {
        type: "object",
        properties: {
          document_ids: {
            type: "array",
            items: { type: "number" },
            description: "要作废的文档ID列表",
          },
          reason: { type: "string", description: "作废原因，将写入审计记录" },
        },
        required: ["document_ids", "reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_governance_task",
      description: "创建知识治理任务，进入负责人的处理闭环。用于记录需要人工处理的知识问题。",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["EXPIRED", "DUPLICATE", "QUALITY", "MISSING"],
            description: "任务类型：EXPIRED=过期内容, DUPLICATE=疑似重复, QUALITY=质量问题, MISSING=知识缺口",
          },
          reason: { type: "string", description: "任务标题/原因（15字以内）" },
          detail: { type: "string", description: "详细描述" },
          document_id: { type: "number", description: "关联的文档ID（可选）" },
        },
        required: ["type", "reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_email",
      description: "发送邮件通知。可指定用户ID或直接填写邮箱地址。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "number", description: "接收通知的用户ID（可选，与email二选一）" },
          email: { type: "string", description: "接收邮箱地址（可选，如yangshanpm@163.com）" },
          subject: { type: "string", description: "邮件主题" },
          body: { type: "string", description: "邮件正文" },
        },
        required: ["subject", "body"],
      },
    },
  },
];

// ---- Tool Executors ----

async function runSearchKnowledge(args: Record<string, unknown>, ctx: AuthContext) {
  const db = getD1();
  const query = safeText(args.query, 200);
  const access = publishedDocumentScope(ctx, "d");
  const chunks = await db
    .prepare(
      `SELECT c.id, c.content, c.chunk_index, d.id AS document_id, d.title, d.version, d.category, d.status, d.owner, d.update_time, dep.name AS department_name
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       JOIN departments dep ON dep.id = d.dept_id
       WHERE c.is_active = 1 AND ${access.sql}
       ORDER BY d.update_time DESC LIMIT 300`,
    )
    .bind(...access.binds)
    .all<Record<string, unknown>>();

  // Simple keyword scoring (no embedding needed for agent overview)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = chunks.results
    .map((row) => {
      const text = `${row.title} ${row.content}`.toLowerCase();
      const hits = terms.filter((t) => text.includes(t)).length;
      return { ...row, score: terms.length ? hits / terms.length : 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const seen = new Set<number>();
  const unique = scored.filter((r) => {
    const id = Number(r.document_id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return JSON.stringify(
    unique.map((r) => ({
      id: r.document_id,
      title: r.title,
      version: r.version,
      category: r.category,
      status: r.status,
      department: r.department_name,
      owner: r.owner,
      excerpt: String(r.content).slice(0, 200),
    })),
  );
}

async function runInspectDocument(args: Record<string, unknown>, ctx: AuthContext) {
  const db = getD1();
  const id = Number(args.document_id);
  if (!id || id < 1) return JSON.stringify({ error: "无效的文档ID" });

  const doc = await db
    .prepare("SELECT * FROM documents WHERE id = ? AND is_deleted = 0")
    .bind(id)
    .first<Record<string, unknown>>();

  if (!doc) return JSON.stringify({ error: `文档 #${id} 不存在或已删除` });

  // Check if user has access
  const access = publishedDocumentScope(ctx, "d");
  const hasAccess = await db
    .prepare(
      `SELECT 1 FROM documents d WHERE d.id = ? AND d.is_deleted = 0 AND (${access.sql})`,
    )
    .bind(id, ...access.binds)
    .first();

  if (!hasAccess) return JSON.stringify({ error: `无权访问文档 #${id}` });

  return JSON.stringify({
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    content: String(doc.content || "").slice(0, 1000),
    category: doc.category,
    status: doc.status,
    version: doc.version,
    owner: doc.owner,
    uploader: doc.uploader,
    security_level: doc.security_level,
    department_id: doc.dept_id,
    review_due_at: doc.review_due_at,
    parse_status: doc.parse_status,
    update_time: doc.update_time,
  });
}

async function runListDocuments(args: Record<string, unknown>, ctx: AuthContext) {
  const db = getD1();
  const status = String(args.status || "published");
  const limit = Math.min(50, Math.max(1, Number(args.limit || 15)));

  const access = publishedDocumentScope(ctx, "d");
  let statusFilter = "";

  switch (status) {
    case "expired":
      statusFilter = `AND d.status = 'EXPIRED_VOID' OR (d.review_due_at IS NOT NULL AND d.review_due_at < DATE('now'))`;
      break;
    case "draft":
      statusFilter = `AND d.status = 'DRAFT'`;
      break;
    case "review":
      statusFilter = `AND d.status = 'PENDING_DEPT_REVIEW'`;
      break;
    case "published":
      statusFilter = `AND d.status = 'ARCHIVED_ACTIVE'`;
      break;
    case "failed_parse":
      statusFilter = `AND d.parse_status = 'FAILED'`;
      break;
  }

  const rows = await db
    .prepare(
      `SELECT d.id, d.title, d.status, d.version, d.category, d.owner, d.review_due_at, d.parse_status, d.update_time, dep.name AS department_name
       FROM documents d
       JOIN departments dep ON dep.id = d.dept_id
       WHERE d.is_deleted = 0 AND (${access.sql}) ${statusFilter}
       ORDER BY d.update_time DESC LIMIT ?`,
    )
    .bind(...access.binds, limit)
    .all<Record<string, unknown>>();

  return JSON.stringify(
    rows.results.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      version: r.version,
      category: r.category,
      owner: r.owner,
      department: r.department_name,
      review_due_at: r.review_due_at,
      parse_status: r.parse_status,
      update_time: r.update_time,
    })),
  );
}

async function runFindSimilar(args: Record<string, unknown>, ctx: AuthContext) {
  const db = getD1();
  const text = safeText(args.text, 500);
  const limit = Math.min(10, Math.max(1, Number(args.limit || 5)));

  const access = publishedDocumentScope(ctx, "d");
  const chunks = await db
    .prepare(
      `SELECT c.id, c.content, c.chunk_index, d.id AS document_id, d.title, d.version, d.category, d.owner, dep.name AS department_name
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       JOIN departments dep ON dep.id = d.dept_id
       WHERE c.is_active = 1 AND (${access.sql})
       ORDER BY d.update_time DESC LIMIT 400`,
    )
    .bind(...access.binds)
    .all<Record<string, unknown>>();

  // Keyword-based similarity
  const terms = text.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const scored = chunks.results
    .map((row) => {
      const content = `${row.title} ${row.content}`.toLowerCase();
      const hits = terms.filter((t) => content.includes(t)).length;
      return { ...row, score: terms.length ? hits / terms.length : 0 };
    })
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<number>();
  const unique = scored
    .filter((r) => {
      const id = Number(r.document_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);

  return JSON.stringify(
    unique.map((r) => ({
      document_id: r.document_id,
      title: r.title,
      version: r.version,
      category: r.category,
      owner: r.owner,
      department: r.department_name,
      similarity: Number(r.score.toFixed(3)),
      excerpt: String(r.content).slice(0, 180),
    })),
  );
}

async function runBatchArchive(args: Record<string, unknown>, ctx: AuthContext) {
  if (ctx.role === "EMPLOYEE")
    return JSON.stringify({ error: "权限不足：仅管理员可执行作废操作" });

  const db = getD1();
  const ids = (Array.isArray(args.document_ids) ? args.document_ids : []).map(Number).filter((n) => n > 0);
  const reason = safeText(args.reason, 500);

  if (!ids.length) return JSON.stringify({ error: "未提供有效的文档ID" });
  if (ids.length > 20) return JSON.stringify({ error: "单次最多作废20份文档" });

  const results: { id: number; title: string; archived: boolean; error?: string }[] = [];

  for (const id of ids) {
    try {
      const doc = await db
        .prepare("SELECT * FROM documents WHERE id = ? AND is_deleted = 0")
        .bind(id)
        .first<Record<string, unknown>>();

      if (!doc) {
        results.push({ id, title: `#${id}`, archived: false, error: "不存在" });
        continue;
      }
      if (ctx.role !== "SUPER_ADMIN" && !ctx.deptIds.includes(Number(doc.dept_id))) {
        results.push({ id, title: String(doc.title), archived: false, error: "无权管理该部门" });
        continue;
      }
      if (String(doc.status) === "EXPIRED_VOID") {
        results.push({ id, title: String(doc.title), archived: false, error: "已作废" });
        continue;
      }

      await db.batch([
        db
          .prepare(
            "UPDATE documents SET status = 'EXPIRED_VOID', update_user_id = ?, update_time = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(ctx.userId, id),
        db
          .prepare(
            "INSERT INTO approval_records(document_id, applicant_user_id, approver_user_id, action, comment) VALUES(?, ?, ?, 'REJECT', ?)",
          )
          .bind(id, Number(doc.create_user_id), ctx.userId, `[Agent 批量作废] ${reason}`),
        db
          .prepare(
            "INSERT INTO audit_logs(document_id, dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?, ?, 'AGENT_ARCHIVE', ?, ?, ?, ?)",
          )
          .bind(id, doc.dept_id, ctx.userId, ctx.displayName, `${reason}（Agent 执行）`, `agent-${Date.now()}`),
        db
          .prepare(
            "UPDATE document_chunks SET is_active = 0 WHERE document_id = ?",
          )
          .bind(id),
      ]);

      results.push({ id, title: String(doc.title), archived: true });
    } catch (e) {
      results.push({ id, title: `#${id}`, archived: false, error: e instanceof Error ? e.message : "作废失败" });
    }
  }

  return JSON.stringify(results);
}

async function runCreateGovernanceTask(args: Record<string, unknown>, ctx: AuthContext) {
  const db = getD1();
  const type = String(args.type || "QUALITY");
  const reason = safeText(args.reason, 60);
  const detail = safeText(args.detail, 1000);
  const documentId = Number(args.document_id) || null;

  if (!reason) return JSON.stringify({ error: "任务原因不能为空" });

  const result = await db
    .prepare(
      "INSERT INTO knowledge_governance_tasks(type, status, dept_id, source_document_id, reporter_user_id, reason, detail) VALUES(?, 'OPEN', ?, ?, ?, ?, ?)",
    )
    .bind(type, ctx.primaryDeptId, documentId, ctx.userId, reason, detail)
    .run();

  // 发送通知给任务创建人
  await db.prepare("INSERT INTO notifications(user_id, type, title, content, document_id) VALUES(?, 'GOVERNANCE', ?, ?, ?)")
    .bind(ctx.userId, `治理任务：${reason}`, detail, documentId).run();

  await db
    .prepare(
      "INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?, 'AGENT_GOVERNANCE_TASK', ?, ?, ?, ?)",
    )
    .bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `${type}: ${reason}`, `agent-${Date.now()}`)
    .run();

  return JSON.stringify({
    task_id: Number(result.meta.last_row_id),
    type,
    reason,
    status: "OPEN",
  });
}

async function runSendEmail(args: Record<string, unknown>, ctx: AuthContext) {
  const db = getD1();
  const userId = Number(args.user_id) || 0;
  const directEmail = safeText(args.email, 200);
  const subject = safeText(args.subject, 200);
  const body = safeText(args.body, 2000);
  if (!subject || !body) return JSON.stringify({ error: "邮件主题和正文不能为空" });

  let toEmail = directEmail;
  if (userId > 0) {
    const u = await db.prepare("SELECT email,display_name FROM users WHERE id=? AND status='ACTIVE'").bind(userId).first<{email:string;display_name:string}>();
    if (u) { toEmail = u.email; }
  }
  if (!toEmail) return JSON.stringify({ error: "未指定收件人（user_id 或 email 至少填一个）" });

  // 站内通知
  if (userId > 0) {
    await db.prepare("INSERT INTO notifications(user_id, type, title, content) VALUES(?,'EMAIL',?,?)").bind(userId, subject, body).run();
  }
  await db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?,'AGENT_SEND_EMAIL',?,'Agent',?,?)").bind(ctx.primaryDeptId, ctx.userId, `${toEmail}: ${subject}`, `agent-${Date.now()}`).run();

  // Resend API 发送
  const apiKey = (env as unknown as Record<string,string>).RESEND_API_KEY;
  let actuallySent = false;
  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: "知域知识库 <onboarding@resend.dev>",
          to: [toEmail],
          subject: `[知域] ${subject}`,
          html: `<h3>${subject}</h3><p>${body.replace(/\n/g,"<br>")}</p><hr><small>此邮件由知域企业知识中台 Agent 自动发送</small>`,
        }),
      });
      actuallySent = res.ok;
      if(!res.ok){ const errBody=await res.text().catch(()=>""); return JSON.stringify({sent:false,error:`Resend HTTP ${res.status}: ${errBody.slice(0,200)}`,to:toEmail}) }
    } catch(e) { return JSON.stringify({ sent:false, error: e instanceof Error ? e.message : "网络错误", to:toEmail }); }
  }

  return JSON.stringify({ sent: actuallySent, to: toEmail, subject });
}

// ---- Tool Dispatch ----

const TOOL_EXECUTORS: Record<
  string,
  (args: Record<string, unknown>, ctx: AuthContext) => Promise<string>
> = {
  search_knowledge: runSearchKnowledge,
  inspect_document: runInspectDocument,
  list_documents: runListDocuments,
  find_similar: runFindSimilar,
  batch_archive: runBatchArchive,
  create_governance_task: runCreateGovernanceTask,
  send_email: runSendEmail,
};

// ---- Agent Loop ----

const SYSTEM_PROMPT = `你是知域企业知识中台的治理智能助手。你可以使用工具来执行知识库操作。

核心原则：
1. 每次回复简洁、可操作，用中文
2. 先搜索/巡检了解情况，再提出建议，最后执行操作
3. 批量操作前先向用户确认
4. 执行操作后汇报结果
5. 治理任务类型：EXPIRED=过期, DUPLICATE=重复, QUALITY=质量, MISSING=缺失

工作模式：
- 巡检：用 list_documents 查看各状态文档 → 分析 → 给出治理建议
- 通知：发现问题后用 send_email 发送邮件给管理员（邮箱 yangshanpm@163.com）
- 诊断：用 inspect_document + find_similar 深入分析问题文档
- 执行：用 batch_archive 作废、create_governance_task 建待办、send_email 发邮件通知
- 问答：用 search_knowledge 查找相关制度`;

const MAX_ITERATIONS = 5;

export async function runAgent(
  userMessage: string,
  history: AgentMessage[],
  ctx: AuthContext,
): Promise<AgentResult> {
  const messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
      }
      return { role: m.role, content: m.content };
    }),
    { role: "user", content: userMessage },
  ];

  const toolCallLog: AgentResult["toolCalls"] = [];
  let iterations = 0;
  let finalAnswer = "";

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const c = runtime();
    const baseUrl = (c.AI_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const apiKeyEnv = c.DEEPSEEK_API_KEY || "";
    const model = c.AI_CHAT_MODEL || "deepseek-v4-flash";

    if (!apiKeyEnv) {
      return {
        answer: "Agent 需要配置 DEEPSEEK_API_KEY 才能运行。请在环境变量中设置密钥。",
        toolCalls: [],
        iterations: 0,
      };
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyEnv}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => "");
      return {
        answer: `AI 服务调用失败（HTTP ${response.status}），请稍后重试。`,
        toolCalls: toolCallLog,
        iterations,
      };
    }

    const completion = await response.json() as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = completion.choices?.[0];
    if (!choice) {
      return { answer: "AI 返回异常，请重试。", toolCalls: toolCallLog, iterations };
    }

    const msg = choice.message;

    // If AI returned a text response (no tool calls), we're done
    if (!msg.tool_calls?.length) {
      finalAnswer = msg.content || "处理完成。";
      break;
    }

    // Execute tool calls
    messages.push({
      role: "assistant",
      content: msg.content || "",
      tool_calls: msg.tool_calls,
    });

    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      const executor = TOOL_EXECUTORS[toolName];

      let toolResult: string;
      if (!executor) {
        toolResult = JSON.stringify({ error: `未知工具: ${toolName}` });
      } else {
        try {
          const args = JSON.parse(tc.function.arguments);
          toolResult = await executor(args, ctx);
        } catch (e) {
          toolResult = JSON.stringify({ error: `工具执行失败: ${e instanceof Error ? e.message : "未知错误"}` });
        }
      }

      toolCallLog.push({
        tool: toolName,
        args: JSON.parse(tc.function.arguments),
        result: toolResult.slice(0, 500),
      });

      messages.push({
        role: "tool",
        content: toolResult,
        tool_call_id: tc.id,
      });
    }

    // Check if we should stop
    if (choice.finish_reason === "stop") {
      finalAnswer = msg.content || "操作执行完成。";
      break;
    }
  }

  if (!finalAnswer) {
    // Max iterations reached — ask AI to summarize
    messages.push({
      role: "user",
      content: "请根据以上工具执行结果，用中文给出简洁的总结和建议。",
    });

    const c2 = runtime();
    const baseUrl2 = (c2.AI_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const apiKey2 = c2.DEEPSEEK_API_KEY || "";
    const model2 = c2.AI_CHAT_MODEL || "deepseek-v4-flash";

    try {
      const summary = await fetch(`${baseUrl2}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey2}`,
        },
        body: JSON.stringify({
          model: model2,
          messages: messages.filter((m) => m.role !== "tool" || m.tool_call_id).slice(-15),
          temperature: 0.5,
          max_tokens: 1500,
        }),
      });
      const data = await summary.json() as { choices?: Array<{ message?: { content?: string } }> };
      finalAnswer = data.choices?.[0]?.message?.content || "巡检完成，详见工具执行记录。";
    } catch {
      finalAnswer = `执行了 ${toolCallLog.length} 次工具调用，详情已在治理记录中。`;
    }
  }

  return { answer: finalAnswer, toolCalls: toolCallLog, iterations };
}

