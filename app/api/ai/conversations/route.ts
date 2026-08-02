import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../../lib/authz";

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); const db = getD1(); const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (id) {
      const conversation = await db.prepare("SELECT * FROM ai_conversations WHERE id=? AND user_id=? AND status='ACTIVE'").bind(id, ctx.userId).first();
      if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "会话不存在或已删除");
      const messages = await db.prepare("SELECT m.*,f.helpful,f.reason,q.model FROM ai_messages m LEFT JOIN ai_answer_feedback f ON f.query_log_id=m.query_log_id AND f.user_id=m.user_id LEFT JOIN ai_query_logs q ON q.id=m.query_log_id WHERE m.conversation_id=? AND m.user_id=? ORDER BY m.id ASC LIMIT 100").bind(id, ctx.userId).all();
      return ok({ conversation, messages: messages.results }, rid);
    }
    const conversations = await db.prepare("SELECT c.*, (SELECT content FROM ai_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message FROM ai_conversations c WHERE c.user_id=? AND c.status='ACTIVE' ORDER BY c.update_time DESC LIMIT 30").bind(ctx.userId).all();
    return ok({ conversations: conversations.results }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "ai-conversation", 30, 60); const payload = await request.json().catch(() => ({})) as { title?: string }; const title = safeText(payload.title || "新会话", 80); const db = getD1();
    const created = await db.prepare("INSERT INTO ai_conversations(user_id,title) VALUES(?,?)").bind(ctx.userId, title).run();
    return ok({ conversation: await db.prepare("SELECT * FROM ai_conversations WHERE id=?").bind(created.meta.last_row_id).first() }, rid, 201);
  } catch (error) { return fail(error, rid); }
}

export async function DELETE(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); const id = Number(new URL(request.url).searchParams.get("id") || 0); if (!id) throw new ApiError(400, "VALIDATION_ERROR", "会话不能为空");
    const result = await getD1().prepare("UPDATE ai_conversations SET status='DELETED',update_time=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(id, ctx.userId).run();
    if (!result.meta.changes) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "会话不存在");
    return ok({ deleted: true }, rid);
  } catch (error) { return fail(error, rid); }
}
