import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { canManageDepartment, enforceRateLimit, requireApiUser } from "../../../../lib/authz";
import { canEditDocument, canReadDocument } from "../../../../lib/document-access";
import { deleteKnowledgeFile, getKnowledgeFile } from "../../../../lib/knowledge-files";
import { notifyUser } from "../../../../lib/notifications";

async function applyDownloadWatermark(object:Awaited<ReturnType<typeof getKnowledgeFile>>,mime:string,identity:string){
  if(!object)return null;
  const mark=`ZH I YU · ${identity} · ${new Date().toISOString().slice(0,16).replace("T"," ")} UTC`;
  if(mime.includes("pdf")){
    const {PDFDocument,StandardFonts,rgb,degrees}=await import("pdf-lib");
    const pdf=await PDFDocument.load(await object.arrayBuffer());
    const font=await pdf.embedFont(StandardFonts.Helvetica);
    for(const page of pdf.getPages()){
      const {width,height}=page.getSize();
      page.drawText(mark,{x:Math.max(24,width*.12),y:height*.48,size:Math.max(9,Math.min(16,width/42)),font,color:rgb(.45,.52,.5),opacity:.24,rotate:degrees(28)});
    }
    return new Uint8Array(await pdf.save());
  }
  if(mime.startsWith("text/")||/json|csv|xml|markdown/.test(mime))return new TextEncoder().encode(`[Download trace: ${mark}]\n\n${await object.text()}`);
  return null;
}

async function authorizedDocument(id: number, ctx: Awaited<ReturnType<typeof requireApiUser>>) {
  const doc = await getD1().prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(id).first<Record<string, unknown>>();
  if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在");
  if (!await canReadDocument(doc,ctx)) throw new ApiError(403, "ROW_ACCESS_DENIED", "无权访问该文档"); return doc;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const db = getD1();
    if (new URL(request.url).searchParams.get("download") === "1") {
      await enforceRateLimit(ctx, "download", 120, 60); if (!doc.source_key) throw new ApiError(404, "NO_ATTACHMENT", "该知识没有原始附件");
      const object = await getKnowledgeFile(String(doc.source_key)); if (!object) throw new ApiError(404, "FILE_NOT_FOUND", "附件不存在");
      const mime=String(doc.mime_type||object.contentType||"application/octet-stream"),watermarked=Number(doc.watermark_enabled)?await applyDownloadWatermark(object,mime,ctx.email):null,body=watermarked||object.body,size=watermarked?.byteLength||object.size;
      await db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id, doc.dept_id, "DOWNLOAD", ctx.userId, ctx.displayName, `${doc.source_name}${Number(doc.watermark_enabled)?watermarked?" · 已写入下载水印":" · 已记录下载追踪（原格式不支持写入水印）":""}`, rid).run();
      return new Response(body, { headers: { "content-type": mime, "content-length": String(size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(doc.source_name || "document"))}`, "cache-control": "private, no-store",...(Number(doc.watermark_enabled)?{"x-knowledge-download-trace":rid,"x-knowledge-watermark":watermarked?"embedded":"audited"}:{}) } });
    }
    const versions = await db.prepare("SELECT * FROM document_versions WHERE document_id=? ORDER BY version DESC").bind(id).all();
    const tagRow = await db.prepare("SELECT GROUP_CONCAT(t.name, ',') tags FROM document_tags dt JOIN tags t ON t.id=dt.tag_id WHERE dt.document_id=?").bind(id).first<{tags:string|null}>();
    const manager=canManageDepartment(ctx,Number(doc.dept_id)); const creator=Number(doc.create_user_id)===ctx.userId; const baseDoc={...doc,tags:tagRow?.tags||"",content:doc.content||doc.extracted_text||""};const visibleDoc=!manager&&!creator&&doc.status!=="ARCHIVED_ACTIVE"&&doc.published_version?{...baseDoc,title:doc.published_title,summary:doc.published_summary||String(doc.published_content||"").slice(0,180),content:doc.published_content||"",extracted_text:doc.published_content||"",version:doc.published_version,status:"ARCHIVED_ACTIVE"}:baseDoc;
    const approvals=await db.prepare("SELECT a.*,u.display_name approver FROM approval_records a LEFT JOIN users u ON u.id=a.approver_user_id WHERE a.document_id=? ORDER BY a.create_time DESC").bind(id).all();
    const acl=manager?await db.prepare(`SELECT a.*,CASE a.subject_type WHEN 'USER' THEN (SELECT display_name FROM users WHERE id=a.subject_id) WHEN 'DEPT' THEN (SELECT name FROM departments WHERE id=a.subject_id) WHEN 'GROUP' THEN (SELECT name FROM enterprise_groups WHERE id=a.subject_id) END subject_name FROM document_acl a WHERE a.document_id=? ORDER BY a.create_time DESC`).bind(id).all():{results:[]};
    const permissionPrincipals=manager?{
      departments:(await db.prepare(ctx.role==="SUPER_ADMIN"?"SELECT id,name FROM departments WHERE is_active=1 ORDER BY name":`SELECT id,name FROM departments WHERE is_active=1 AND id IN (${ctx.deptIds.map(()=>"?").join(",")}) ORDER BY name`).bind(...(ctx.role==="SUPER_ADMIN"?[]:ctx.deptIds)).all()).results,
      users:(await db.prepare(ctx.role==="SUPER_ADMIN"?"SELECT id,display_name name FROM users WHERE status='ACTIVE' ORDER BY display_name":`SELECT DISTINCT u.id,u.display_name name FROM users u JOIN user_departments ud ON ud.user_id=u.id WHERE u.status='ACTIVE' AND ud.dept_id IN (${ctx.deptIds.map(()=>"?").join(",")}) ORDER BY u.display_name`).bind(...(ctx.role==="SUPER_ADMIN"?[]:ctx.deptIds)).all()).results,
      groups:(await db.prepare(ctx.role==="SUPER_ADMIN"?"SELECT id,name FROM enterprise_groups WHERE is_active=1 ORDER BY name":`SELECT id,name FROM enterprise_groups WHERE is_active=1 AND (dept_id IS NULL OR dept_id IN (${ctx.deptIds.map(()=>"?").join(",")})) ORDER BY name`).bind(...(ctx.role==="SUPER_ADMIN"?[]:ctx.deptIds)).all()).results,
    }:null;
    const spacePermissions=manager&&doc.space_id?(await db.prepare(`SELECT p.*,CASE p.subject_type WHEN 'USER' THEN (SELECT display_name FROM users WHERE id=p.subject_id) WHEN 'DEPT' THEN (SELECT name FROM departments WHERE id=p.subject_id) WHEN 'GROUP' THEN (SELECT name FROM enterprise_groups WHERE id=p.subject_id) END subject_name FROM space_permissions p WHERE p.space_id=? ORDER BY p.create_time DESC`).bind(doc.space_id).all()).results:[];
    const editable=await canEditDocument(doc,ctx);const subscription=await db.prepare("SELECT is_active FROM knowledge_subscriptions WHERE document_id=? AND user_id=?").bind(id,ctx.userId).first<{is_active:number}>();
    return ok({ document: visibleDoc, versions: versions.results, approvals:approvals.results, acl:acl.results,permissionPrincipals,spacePermissions,capabilities:{canEdit:editable,canManage:manager},subscribed:Boolean(subscription?.is_active) }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const deptId = Number(doc.dept_id);
    if (!await canEditDocument(doc,ctx)) throw new ApiError(403, "EDIT_FORBIDDEN", "无权编辑该资料");
    const payload = await request.json() as { title?: string; content?: string; summary?: string }; const title = safeText(payload.title || doc.title, 200); const content = safeText(payload.content || doc.content, 500000); const nextVersion = Number(doc.version) + 1; const db = getD1();
    await db.batch([
      db.prepare("UPDATE documents SET title=?,summary=?,content=?,extracted_text=?,extraction_method='MANUAL_EDIT',extraction_detail='在线编辑正文',version=?,status='DRAFT',parse_status='COMPLETED',ai_index_status='PENDING',update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(title, safeText(payload.summary || doc.summary, 1000), content,content, nextVersion, ctx.userId, id),
      db.prepare("DELETE FROM document_chunks WHERE document_id=? AND document_version=?").bind(id,nextVersion),
      db.prepare("INSERT INTO document_versions(document_id,version,title,content,change_note,operator_user_id,operator) VALUES(?,?,?,?,?,?,?)").bind(id, nextVersion, title, content, "内容更新，重新进入草稿", ctx.userId, ctx.displayName),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id, deptId, "UPDATE", ctx.userId, ctx.displayName, `更新至 V${nextVersion}`, rid),
    ]);
    const { processDocument } = await import("../../../../lib/ingestion");
    await processDocument(id).catch(async (error) => {
      await db.prepare("UPDATE documents SET ai_index_status='FAILED' WHERE id=?").bind(id).run();
      console.error(JSON.stringify({ level: "error", requestId: rid, action: "AI_REINDEX_AFTER_EDIT", documentId: id, message: error instanceof Error ? error.message : "索引失败" }));
    });
    return ok({ document: await db.prepare("SELECT * FROM documents WHERE id=?").bind(id).first() }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try { const ctx = await requireApiUser(); await enforceRateLimit(ctx, "feedback", 20, 60); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const payload = await request.json() as { type?: string; content?: string }; const type=safeText(payload.type || "纠错", 30);const content = safeText(payload.content, 2000); if (!content) throw new ApiError(400, "VALIDATION_ERROR", "反馈内容不能为空"); const db = getD1(); const receiver=Number(doc.owner_user_id||doc.create_user_id); await db.batch([db.prepare("INSERT INTO feedback(document_id,type,content,reporter_user_id,reporter) VALUES(?,?,?,?,?)").bind(id, type, content, ctx.userId, ctx.displayName),db.prepare("INSERT INTO knowledge_governance_tasks(type,status,dept_id,source_document_id,reporter_user_id,assignee_user_id,reason,detail) VALUES('DOCUMENT_FEEDBACK','OPEN',?,?,?,?,?,?)").bind(doc.dept_id,id,ctx.userId,receiver,type,content), db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id, doc.dept_id, "FEEDBACK", ctx.userId, ctx.displayName, content, rid)]); const delivery=await notifyUser({userId:receiver,type:"KNOWLEDGE_FEEDBACK",title:"收到知识纠错反馈",content:`${ctx.displayName} 对《${String(doc.title)}》提交了“${type}”反馈：${content}`,documentId:id,requestId:rid,email:true}); return ok({ submitted: true,governanceTaskCreated:true,notification:delivery }, rid, 201); } catch (error) { return fail(error, rid); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try { const ctx = await requireApiUser(); const id = Number((await context.params).id); const doc = await authorizedDocument(id, ctx); const deptId = Number(doc.dept_id); if (!canManageDepartment(ctx, deptId)) throw new ApiError(403, "DELETE_FORBIDDEN", "仅管理员可删除文档"); const hard = new URL(request.url).searchParams.get("hard") === "1"; const db = getD1(); if (hard && ctx.role !== "SUPER_ADMIN") throw new ApiError(403, "HARD_DELETE_FORBIDDEN", "仅超级管理员可彻底删除"); if(hard&&Number(doc.legal_hold))throw new ApiError(409,"LEGAL_HOLD","该文档处于法务留置，禁止彻底删除");if(hard&&doc.retention_until&&new Date(String(doc.retention_until)).getTime()>Date.now())throw new ApiError(409,"RETENTION_ACTIVE",`文档保留期至 ${doc.retention_until}，禁止彻底删除`);
    if (hard) { await db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'HARD_DELETE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`彻底删除文档 #${id} ${doc.title}`,rid).run(); await db.batch([db.prepare("DELETE FROM user_favorites WHERE document_id=?").bind(id),db.prepare("DELETE FROM document_acl WHERE document_id=?").bind(id),db.prepare("DELETE FROM knowledge_subscriptions WHERE document_id=?").bind(id),db.prepare("DELETE FROM feedback WHERE document_id=?").bind(id),db.prepare("DELETE FROM approval_records WHERE document_id=?").bind(id),db.prepare("DELETE FROM document_tags WHERE document_id=?").bind(id), db.prepare("DELETE FROM document_visibility WHERE document_id=?").bind(id),db.prepare("DELETE FROM document_chunks WHERE document_id=?").bind(id),db.prepare("DELETE FROM ingestion_jobs WHERE document_id=?").bind(id),db.prepare("DELETE FROM security_events WHERE document_id=?").bind(id),db.prepare("UPDATE knowledge_governance_tasks SET source_document_id=NULL WHERE source_document_id=?").bind(id), db.prepare("DELETE FROM document_versions WHERE document_id=?").bind(id), db.prepare("DELETE FROM documents WHERE id=?").bind(id)]); if(doc.source_key)await deleteKnowledgeFile(String(doc.source_key)); }
    else { await db.batch([db.prepare("UPDATE documents SET is_deleted=1,deleted_by=?,deleted_at=CURRENT_TIMESTAMP,update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(ctx.userId,ctx.userId,id),db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(id,deptId,"SOFT_DELETE",ctx.userId,ctx.displayName,"文档移入回收站",rid)]); } return ok({ deleted: true, hard }, rid); } catch (error) { return fail(error, rid); }
}
