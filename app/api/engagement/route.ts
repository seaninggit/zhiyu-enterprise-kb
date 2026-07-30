import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../lib/authz";

async function readableDocument(id: number, ctx: Awaited<ReturnType<typeof requireApiUser>>) {
  const doc = await getD1().prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(id).first<Record<string, unknown>>();
  if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在");
  const ownDept = ctx.deptIds.includes(Number(doc.dept_id));
  const allowed = ctx.role === "SUPER_ADMIN" || (doc.status === "ARCHIVED_ACTIVE" && (ownDept || doc.share_scope === "CROSS_DEPT")) || Number(doc.create_user_id) === ctx.userId;
  if (!allowed) throw new ApiError(403, "ROW_ACCESS_DENIED", "无权操作该文档"); return doc;
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "engagement", 60, 60);
    const payload = await request.json() as { action?: "SHARE" | "SUBSCRIBE" | "CONTACT_OWNER" | "AI_HELPFUL"; documentId?: number; queryLogId?: number; helpful?: boolean; reason?: string };
    if (!payload.action) throw new ApiError(400, "VALIDATION_ERROR", "操作类型不能为空"); const db = getD1();
    if (payload.action === "AI_HELPFUL") {
      if (!payload.queryLogId) throw new ApiError(400, "VALIDATION_ERROR", "问答记录不能为空");
      const query = await db.prepare("SELECT id FROM ai_query_logs WHERE id=? AND user_id=?").bind(payload.queryLogId, ctx.userId).first();
      if (!query) throw new ApiError(404, "QUERY_NOT_FOUND", "问答记录不存在");
      await db.prepare("INSERT INTO ai_answer_feedback(query_log_id,user_id,helpful,reason) VALUES(?,?,?,?) ON CONFLICT(query_log_id,user_id) DO UPDATE SET helpful=excluded.helpful,reason=excluded.reason,create_time=CURRENT_TIMESTAMP").bind(payload.queryLogId, ctx.userId, payload.helpful ? 1 : 0, safeText(payload.reason, 500)).run();
      return ok({ recorded: true }, rid, 201);
    }
    if (!payload.documentId) throw new ApiError(400, "VALIDATION_ERROR", "文档不能为空"); const doc = await readableDocument(payload.documentId, ctx);
    if (payload.action === "SUBSCRIBE") {
      await db.prepare("INSERT INTO knowledge_subscriptions(document_id,user_id,is_active) VALUES(?,?,1) ON CONFLICT(document_id,user_id) DO UPDATE SET is_active=1,update_time=CURRENT_TIMESTAMP").bind(payload.documentId, ctx.userId).run();
    }
    await db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(payload.documentId, doc.dept_id, payload.action, ctx.userId, ctx.displayName, payload.action === "CONTACT_OWNER" ? `联系知识负责人：${doc.owner}` : "复制内部知识链接", rid).run();
    return ok({ recorded: true }, rid, 201);
  } catch (error) { return fail(error, rid); }
}
