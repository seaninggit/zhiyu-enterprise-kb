import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../lib/authz";

async function readableDocument(id: number, ctx: Awaited<ReturnType<typeof requireApiUser>>) {
  const doc = await getD1().prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(id).first<Record<string, unknown>>();
  if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在");
  const ownDept = ctx.deptIds.includes(Number(doc.dept_id));const acl=await getD1().prepare(`SELECT 1 FROM document_acl WHERE document_id=? AND permission='VIEW' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND ((subject_type='USER' AND subject_id=?) OR (subject_type='DEPT' AND subject_id IN (${ctx.deptIds.map(()=>"?").join(",")}))) LIMIT 1`).bind(id,ctx.userId,...ctx.deptIds).first();
  const published=doc.status === "ARCHIVED_ACTIVE"||Number(doc.published_version)>0;const allowed = ctx.role === "SUPER_ADMIN" || (published && (ownDept || doc.share_scope === "CROSS_DEPT")) || Number(doc.create_user_id) === ctx.userId||Boolean(acl);
  if (!allowed) throw new ApiError(403, "ROW_ACCESS_DENIED", "无权操作该文档"); return doc;
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "engagement", 60, 60);
    const payload = await request.json() as { action?: "VIEW" | "EXPORT" | "SHARE" | "SUBSCRIBE" | "UNSUBSCRIBE" | "CONTACT_OWNER" | "AI_HELPFUL" | "FAVORITE_TOGGLE" | "NOTIFICATION_READ" | "SEARCH_CLICK"; documentId?: number; notificationId?: number; searchLogId?: number; queryLogId?: number; messageId?: number; helpful?: boolean; reason?: string; detail?: string };
    if (!payload.action) throw new ApiError(400, "VALIDATION_ERROR", "操作类型不能为空"); const db = getD1();
    if (payload.action === "AI_HELPFUL") {
      if (!payload.queryLogId) throw new ApiError(400, "VALIDATION_ERROR", "问答记录不能为空");
      const query = await db.prepare("SELECT id FROM ai_query_logs WHERE id=? AND user_id=?").bind(payload.queryLogId, ctx.userId).first();
      if (!query) throw new ApiError(404, "QUERY_NOT_FOUND", "问答记录不存在");
      const reason = safeText(payload.reason, 100); const detail = safeText(payload.detail, 1000);
      if (!payload.helpful && !reason) throw new ApiError(400, "FEEDBACK_REASON_REQUIRED", "请选择没有解决的原因");
      const message = payload.messageId ? await db.prepare("SELECT id,source_payload FROM ai_messages WHERE id=? AND user_id=? AND query_log_id=?").bind(payload.messageId, ctx.userId, payload.queryLogId).first<Record<string, unknown>>() : null;
      let sourceDocumentId: number | null = null; try { sourceDocumentId = Number(JSON.parse(String(message?.source_payload ?? "[]"))[0]?.documentId) || null; } catch { /* malformed source payload */ }
      await db.batch([
        db.prepare("INSERT INTO ai_answer_feedback(query_log_id,user_id,helpful,reason) VALUES(?,?,?,?) ON CONFLICT(query_log_id,user_id) DO UPDATE SET helpful=excluded.helpful,reason=excluded.reason,create_time=CURRENT_TIMESTAMP").bind(payload.queryLogId, ctx.userId, payload.helpful ? 1 : 0, [reason, detail].filter(Boolean).join("：")),
        ...(!payload.helpful ? [db.prepare("INSERT INTO knowledge_governance_tasks(type,status,dept_id,source_document_id,source_message_id,reporter_user_id,reason,detail) VALUES('AI_UNRESOLVED','OPEN',?,?,?,?,?,?)").bind(ctx.primaryDeptId, sourceDocumentId, message ? payload.messageId : null, ctx.userId, reason, detail)] : []),
      ]);
      return ok({ recorded: true, governanceTaskCreated: !payload.helpful }, rid, 201);
    }
    if (payload.action === "NOTIFICATION_READ") {
      await db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?${payload.notificationId ? " AND id=?" : ""}`).bind(ctx.userId, ...(payload.notificationId ? [payload.notificationId] : [])).run();
      return ok({ read: true }, rid);
    }
    if (payload.action === "SEARCH_CLICK") {
      if (!payload.searchLogId || !payload.documentId) throw new ApiError(400, "VALIDATION_ERROR", "搜索记录和文档不能为空");
      await readableDocument(payload.documentId, ctx);
      await db.prepare("UPDATE search_logs SET clicked_document_id=? WHERE id=? AND user_id=?").bind(payload.documentId, payload.searchLogId, ctx.userId).run();
      return ok({ recorded: true }, rid);
    }
    if (!payload.documentId) throw new ApiError(400, "VALIDATION_ERROR", "文档不能为空"); const doc = await readableDocument(payload.documentId, ctx);
    if (payload.action === "FAVORITE_TOGGLE") {
      const existing = await db.prepare("SELECT 1 FROM user_favorites WHERE user_id=? AND document_id=?").bind(ctx.userId, payload.documentId).first();
      if (existing) await db.prepare("DELETE FROM user_favorites WHERE user_id=? AND document_id=?").bind(ctx.userId, payload.documentId).run();
      else await db.prepare("INSERT INTO user_favorites(user_id,document_id) VALUES(?,?)").bind(ctx.userId, payload.documentId).run();
      return ok({ favorite: !existing }, rid);
    }
    if (payload.action === "SUBSCRIBE") {
      await db.prepare("INSERT INTO knowledge_subscriptions(document_id,user_id,is_active) VALUES(?,?,1) ON CONFLICT(document_id,user_id) DO UPDATE SET is_active=1,update_time=CURRENT_TIMESTAMP").bind(payload.documentId, ctx.userId).run();
    }
    if (payload.action === "UNSUBSCRIBE") await db.prepare("UPDATE knowledge_subscriptions SET is_active=0,update_time=CURRENT_TIMESTAMP WHERE document_id=? AND user_id=?").bind(payload.documentId, ctx.userId).run();
    if (payload.action === "CONTACT_OWNER") {
      const owner = doc.owner_user_id?{id:Number(doc.owner_user_id)}:await db.prepare("SELECT id FROM users WHERE display_name=? AND status='ACTIVE' LIMIT 1").bind(doc.owner).first<{ id: number }>();
      if (owner) await db.prepare("INSERT INTO notifications(user_id,type,title,content,document_id) VALUES(?,'OWNER_CONTACT','有用户咨询你负责的资料',?,?)").bind(owner.id, `${ctx.displayName} 咨询《${doc.title}》`, payload.documentId).run();
    }
    await db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(payload.documentId, doc.dept_id, payload.action, ctx.userId, ctx.displayName, payload.action === "CONTACT_OWNER" ? `联系知识负责人：${doc.owner}` : "复制内部知识链接", rid).run();
    const subscription=await db.prepare("SELECT is_active FROM knowledge_subscriptions WHERE document_id=? AND user_id=?").bind(payload.documentId,ctx.userId).first<{is_active:number}>();
    return ok({ recorded: true,subscribed:Boolean(subscription?.is_active) }, rid, 201);
  } catch (error) { return fail(error, rid); }
}
