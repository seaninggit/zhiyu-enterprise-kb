import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../../lib/authz";
import { cosine, embedTexts, generateGroundedAnswer, indexPublishedDocument } from "../../../../lib/rag";

function placeholders(values: number[]) { return values.map(() => "?").join(","); }
function keywordScore(question: string, content: string) {
  const terms = Array.from(new Set(question.toLowerCase().split(/[\s，。！？、,.!?：:；;]+/).flatMap(term => term.length > 2 ? [term, ...Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2))] : [term]).filter(Boolean)));
  const lower = content.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? Math.min(1, term.length / 4) : 0), 0) / Math.max(1, terms.length);
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "ai-question", 30, 60);
    const payload = await request.json() as { question?: string; conversationId?: number }; const question = safeText(payload.question, 500);
    if (question.length < 2) throw new ApiError(400, "VALIDATION_ERROR", "请输入完整问题");
    const db = getD1(); let conversationId = Number(payload.conversationId || 0);
    if (conversationId) {
      const owned = await db.prepare("SELECT id FROM ai_conversations WHERE id=? AND user_id=? AND status='ACTIVE'").bind(conversationId, ctx.userId).first();
      if (!owned) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "当前会话不存在或已删除");
    } else {
      const created = await db.prepare("INSERT INTO ai_conversations(user_id,title) VALUES(?,?)").bind(ctx.userId, question.slice(0, 32)).run(); conversationId = Number(created.meta.last_row_id);
    }
    let scope = "d.status='ARCHIVED_ACTIVE' AND d.is_deleted=0"; const binds: unknown[] = [];
    if (ctx.role !== "SUPER_ADMIN") { scope += ` AND (d.dept_id IN (${placeholders(ctx.deptIds)}) OR d.share_scope='CROSS_DEPT')`; binds.push(...ctx.deptIds); }
    const loadChunks = () => db.prepare(`SELECT c.id,c.content,c.embedding,c.chunk_index,d.id AS document_id,d.title,d.version,d.update_time,dep.name AS department_name
      FROM document_chunks c JOIN documents d ON d.id=c.document_id JOIN departments dep ON dep.id=d.dept_id
      WHERE c.is_active=1 AND ${scope} ORDER BY d.update_time DESC LIMIT 800`).bind(...binds).all<Record<string, unknown>>();
    let result = await loadChunks();
    if (!result.results.length) {
      const candidates = await db.prepare(`SELECT d.id FROM documents d WHERE ${scope} ORDER BY d.update_time DESC LIMIT 30`).bind(...binds).all<{ id: number }>();
      for (const candidate of candidates.results) await indexPublishedDocument(Number(candidate.id)).catch(() => undefined);
      result = await loadChunks();
    }
    const queryEmbedding = (await embedTexts([question]))[0];
    const ranked = result.results.map(row => { let vector = 0; try { if (queryEmbedding && row.embedding) vector = cosine(queryEmbedding, JSON.parse(String(row.embedding))); } catch { /* malformed legacy vector */ } const keyword = keywordScore(question, String(row.content)); return { ...row, score: queryEmbedding ? vector * .72 + keyword * .28 : keyword }; }).sort((a, b) => b.score - a.score).slice(0, 5);
    const relevant = ranked.filter(item => item.score >= (queryEmbedding ? .18 : .08));
    const sources = relevant.map((item, index) => ({ citation: index + 1, documentId: Number(item.document_id), title: String(item.title), version: Number(item.version), department: String(item.department_name), excerpt: String(item.content).slice(0, 220), score: Number(item.score.toFixed(4)) }));
    let answer = "当前知识库中没有足够依据。请尝试补充关键词，或联系知识管理员完善相关资料。"; let mode = "no_evidence";
    if (sources.length) {
      const context = relevant.map((item, index) => `[${index + 1}] 文档：${item.title}；版本：V${item.version}.0；内容：${item.content}`).join("\n\n");
      const historyRows = await db.prepare("SELECT role,content FROM ai_messages WHERE conversation_id=? AND user_id=? ORDER BY id DESC LIMIT 8").bind(conversationId, ctx.userId).all<Record<string, unknown>>();
      const recent = historyRows.results.reverse().map(item => `${item.role === "assistant" ? "助手" : "用户"}：${safeText(item.content, 800)}`).join("\n");
      const generated = await generateGroundedAnswer(recent ? `${recent}\n当前问题：${question}` : question, context, ctx.userId).catch(() => null);
      const wantsChecklist = /清单|步骤|怎么办|如何办理/.test(question);
      answer = generated || (wantsChecklist ? `办理清单\n\n${sources.map((source, index) => `${index + 1}. 查阅《${source.title}》V${source.version}.0，确认适用范围与最新要求。[${source.citation}]\n   核心依据：${source.excerpt.slice(0, 100)}`).join("\n\n")}\n\n提交或执行前，请由对应知识负责人确认例外事项。` : `${sources.map(source => `[${source.citation}] ${source.excerpt}`).join("\n\n")}\n\n以上为知识库检索结果，请以引用的最新生效版本为准。`);
      mode = generated ? "rag" : "retrieval_only";
    }
    const log = await db.prepare("INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id) VALUES(?,?,?,?,?,?,?)").bind(ctx.userId, ctx.primaryDeptId, question, answer, mode, JSON.stringify(sources.map(source => source.documentId)), rid).run();
    const userMessageId = crypto.getRandomValues(new Uint32Array(1))[0]; const assistantMessageId = crypto.getRandomValues(new Uint32Array(1))[0];
    await db.batch([
      db.prepare("INSERT INTO ai_messages(id,conversation_id,user_id,role,content,source_payload) VALUES(?,?,?,'user',?,'[]')").bind(userMessageId, conversationId, ctx.userId, question),
      db.prepare("INSERT INTO ai_messages(id,conversation_id,user_id,role,content,mode,source_payload,query_log_id) VALUES(?,?,?,'assistant',?,?,?,?)").bind(assistantMessageId, conversationId, ctx.userId, answer, mode, JSON.stringify(sources), log.meta.last_row_id),
      db.prepare("UPDATE ai_conversations SET title=CASE WHEN title='新会话' THEN ? ELSE title END,update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(question.slice(0, 32), conversationId, ctx.userId),
    ]);
    return ok({ answer, sources, mode, queryLogId: log.meta.last_row_id, conversationId, messageId: assistantMessageId }, rid);
  } catch (error) { return fail(error, rid); }
}
