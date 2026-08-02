import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { canManageDepartment, enforceRateLimit, requireApiUser } from "../../../../lib/authz";

async function authorizedDocument(id: number, ctx: Awaited<ReturnType<typeof requireApiUser>>) {
  const doc = await getD1().prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(id).first<Record<string, unknown>>();
  if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在");
  const deptId = Number(doc.dept_id); const ownDept = ctx.deptIds.includes(deptId); const creator = Number(doc.create_user_id) === ctx.userId;
  const hasPublished=Number(doc.published_version||0)>0&&["DRAFT","PENDING_DEPT_REVIEW"].includes(String(doc.status));
  const acl=await getD1().prepare(`SELECT 1 FROM document_acl WHERE document_id=? AND permission='VIEW' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND ((subject_type='USER' AND subject_id=?) OR (subject_type='DEPT' AND subject_id IN (${ctx.deptIds.map(()=>"?").join(",")}))) LIMIT 1`).bind(id,ctx.userId,...ctx.deptIds).first();
  const readable = ctx.role === "SUPER_ADMIN" || (ctx.role === "DEPT_ADMIN" && ownDept) || (ownDept && (doc.status === "ARCHIVED_ACTIVE" || hasPublished || creator)) || (doc.share_scope === "CROSS_DEPT" && (doc.status === "ARCHIVED_ACTIVE" || hasPublished)) || Boolean(acl);
  if (!readable) throw new ApiError(403, "ROW_ACCESS_DENIED", "无权访问该文档"); return doc;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const db = getD1();
    if (new URL(request.url).searchParams.get("download") === "1") {
      await enforceRateLimit(ctx, "download", 120, 60); if (!doc.source_key) throw new ApiError(404, "NO_ATTACHMENT", "该知识没有原始附件");
      const bucket = (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES; const object = await bucket?.get(String(doc.source_key)); if (!object) throw new ApiError(404, "FILE_NOT_FOUND", "附件不存在");
      await db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id, doc.dept_id, "DOWNLOAD", ctx.userId, ctx.displayName, doc.source_name, rid).run();
      return new Response(object.body, { headers: { "content-type": String(doc.mime_type || "application/octet-stream"), "content-length": String(object.size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(doc.source_name || "document"))}`, "cache-control": "private, no-store" } });
    }
    const versions = await db.prepare("SELECT * FROM document_versions WHERE document_id=? ORDER BY version DESC").bind(id).all();
    const manager=canManageDepartment(ctx,Number(doc.dept_id)); const creator=Number(doc.create_user_id)===ctx.userId; const baseDoc={...doc,content:doc.content||doc.extracted_text||""};const visibleDoc=!manager&&!creator&&doc.status!=="ARCHIVED_ACTIVE"&&doc.published_version?{...baseDoc,title:doc.published_title,summary:doc.published_summary||String(doc.published_content||"").slice(0,180),content:doc.published_content||"",extracted_text:doc.published_content||"",version:doc.published_version,status:"ARCHIVED_ACTIVE"}:baseDoc;
    const approvals=await db.prepare("SELECT a.*,u.display_name approver FROM approval_records a LEFT JOIN users u ON u.id=a.approver_user_id WHERE a.document_id=? ORDER BY a.create_time DESC").bind(id).all(); const acl=manager?await db.prepare("SELECT * FROM document_acl WHERE document_id=? ORDER BY create_time DESC").bind(id).all():{results:[]};
    const aclEdit=await db.prepare(`SELECT 1 FROM document_acl WHERE document_id=? AND permission='EDIT' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND ((subject_type='USER' AND subject_id=?) OR (subject_type='DEPT' AND subject_id IN (${ctx.deptIds.map(()=>"?").join(",")}))) LIMIT 1`).bind(id,ctx.userId,...ctx.deptIds).first();const subscription=await db.prepare("SELECT is_active FROM knowledge_subscriptions WHERE document_id=? AND user_id=?").bind(id,ctx.userId).first<{is_active:number}>();
    return ok({ document: visibleDoc, versions: versions.results, approvals:approvals.results, acl:acl.results,capabilities:{canEdit:manager||creator||Boolean(aclEdit),canManage:manager},subscribed:Boolean(subscription?.is_active) }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const deptId = Number(doc.dept_id);
    const aclEdit=await getD1().prepare(`SELECT 1 FROM document_acl WHERE document_id=? AND permission='EDIT' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND ((subject_type='USER' AND subject_id=?) OR (subject_type='DEPT' AND subject_id IN (${ctx.deptIds.map(()=>"?").join(",")}))) LIMIT 1`).bind(id,ctx.userId,...ctx.deptIds).first();
    if (!(canManageDepartment(ctx, deptId) || Number(doc.create_user_id) === ctx.userId || aclEdit)) throw new ApiError(403, "EDIT_FORBIDDEN", "无权编辑该资料");
    const payload = await request.json() as { title?: string; content?: string; summary?: string }; const title = safeText(payload.title || doc.title, 200); const content = safeText(payload.content || doc.content, 500000); const nextVersion = Number(doc.version) + 1; const db = getD1();
    await db.batch([
      db.prepare("UPDATE documents SET title=?,summary=?,content=?,extracted_text=?,extraction_method='MANUAL_EDIT',extraction_detail='在线编辑正文',version=?,status='DRAFT',parse_status='COMPLETED',ai_index_status='PENDING',update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(title, safeText(payload.summary || doc.summary, 1000), content,content, nextVersion, ctx.userId, id),
      db.prepare("DELETE FROM document_chunks WHERE document_id=? AND document_version=?").bind(id,nextVersion),
      db.prepare("INSERT INTO document_versions(document_id,version,title,content,change_note,operator_user_id,operator) VALUES(?,?,?,?,?,?,?)").bind(id, nextVersion, title, content, "内容更新，重新进入草稿", ctx.userId, ctx.displayName),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id, deptId, "UPDATE", ctx.userId, ctx.displayName, `更新至 V${nextVersion}`, rid),
    ]);
    return ok({ document: await db.prepare("SELECT * FROM documents WHERE id=?").bind(id).first() }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try { const ctx = await requireApiUser(); await enforceRateLimit(ctx, "feedback", 20, 60); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const payload = await request.json() as { type?: string; content?: string }; const content = safeText(payload.content, 2000); if (!content) throw new ApiError(400, "VALIDATION_ERROR", "反馈内容不能为空"); const db = getD1(); const receiver=Number(doc.owner_user_id||doc.create_user_id); await db.batch([db.prepare("INSERT INTO feedback(document_id,type,content,reporter_user_id,reporter) VALUES(?,?,?,?,?)").bind(id, safeText(payload.type || "纠错", 30), content, ctx.userId, ctx.displayName), db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id, doc.dept_id, "FEEDBACK", ctx.userId, ctx.displayName, content, rid),db.prepare("INSERT INTO notifications(user_id,type,title,content,document_id) VALUES(?,'KNOWLEDGE_FEEDBACK','收到知识纠错反馈',?,?,?)").bind(receiver,`${ctx.displayName}：${content}`,id)]); return ok({ submitted: true }, rid, 201); } catch (error) { return fail(error, rid); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try { const ctx = await requireApiUser(); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const deptId = Number(doc.dept_id); if (!canManageDepartment(ctx, deptId)) throw new ApiError(403, "DELETE_FORBIDDEN", "仅管理员可删除文档"); const hard = new URL(request.url).searchParams.get("hard") === "1"; const db = getD1(); if (hard && ctx.role !== "SUPER_ADMIN") throw new ApiError(403, "HARD_DELETE_FORBIDDEN", "仅超级管理员可彻底删除"); if(hard&&Number(doc.legal_hold))throw new ApiError(409,"LEGAL_HOLD","该文档处于法务留置，禁止彻底删除");if(hard&&doc.retention_until&&new Date(String(doc.retention_until)).getTime()>Date.now())throw new ApiError(409,"RETENTION_ACTIVE",`文档保留期至 ${doc.retention_until}，禁止彻底删除`);
    if (hard) { await db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'HARD_DELETE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`彻底删除文档 #${id} ${doc.title}`,rid).run(); await db.batch([db.prepare("DELETE FROM user_favorites WHERE document_id=?").bind(id),db.prepare("DELETE FROM document_acl WHERE document_id=?").bind(id),db.prepare("DELETE FROM knowledge_subscriptions WHERE document_id=?").bind(id),db.prepare("DELETE FROM feedback WHERE document_id=?").bind(id),db.prepare("DELETE FROM approval_records WHERE document_id=?").bind(id),db.prepare("DELETE FROM document_tags WHERE document_id=?").bind(id), db.prepare("DELETE FROM document_visibility WHERE document_id=?").bind(id),db.prepare("DELETE FROM document_chunks WHERE document_id=?").bind(id),db.prepare("DELETE FROM ingestion_jobs WHERE document_id=?").bind(id),db.prepare("DELETE FROM security_events WHERE document_id=?").bind(id),db.prepare("UPDATE knowledge_governance_tasks SET source_document_id=NULL WHERE source_document_id=?").bind(id), db.prepare("DELETE FROM document_versions WHERE document_id=?").bind(id), db.prepare("DELETE FROM documents WHERE id=?").bind(id)]); if(doc.source_key)await (env as unknown as {KNOWLEDGE_FILES?:R2Bucket}).KNOWLEDGE_FILES?.delete(String(doc.source_key)); }
    else { await db.batch([db.prepare("UPDATE documents SET is_deleted=1,deleted_by=?,deleted_at=CURRENT_TIMESTAMP,update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(ctx.userId,ctx.userId,ctx.userId,id),db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id,deptId,"SOFT_DELETE",ctx.userId,ctx.displayName,"文档移入回收站",rid)]); } return ok({ deleted: true, hard }, rid); } catch (error) { return fail(error, rid); }
}
