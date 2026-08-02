import { env } from "cloudflare:workers";
import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, requiredText, safeText } from "../../../lib/api";
import { canManageDepartment, enforceRateLimit, requireApiUser } from "../../../lib/authz";
import { resolveDocumentTransition, WorkflowAction, WorkflowStatus } from "../../../lib/workflow";

function placeholders(values: number[]) { return values.map(() => "?").join(","); }

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    const db = getD1();
    let where = "d.is_deleted = 0"; const binds: unknown[] = [];
    if (ctx.role === "DEPT_ADMIN") {
      where += ` AND (d.dept_id IN (${placeholders(ctx.deptIds)}) OR (d.share_scope='CROSS_DEPT' AND d.status='ARCHIVED_ACTIVE'))`; binds.push(...ctx.deptIds);
    } else if (ctx.role === "EMPLOYEE") {
      where += ` AND ((d.dept_id IN (${placeholders(ctx.deptIds)}) AND (d.status='ARCHIVED_ACTIVE' OR d.published_version IS NOT NULL OR d.create_user_id=?)) OR (d.share_scope='CROSS_DEPT' AND (d.status='ARCHIVED_ACTIVE' OR d.published_version IS NOT NULL)))`; binds.push(...ctx.deptIds, ctx.userId);
    }
    const result = await db.prepare(`SELECT d.*, u.display_name AS creator_name, dep.name AS department_name,
      COALESCE((SELECT GROUP_CONCAT(t.name) FROM document_tags dt JOIN tags t ON t.id=dt.tag_id WHERE dt.document_id=d.id),'') AS tags
      FROM documents d JOIN users u ON u.id=d.create_user_id JOIN departments dep ON dep.id=d.dept_id
      WHERE ${where} ORDER BY d.update_time DESC, d.id DESC LIMIT 500`).bind(...binds).all();
    const logs = ctx.role === "SUPER_ADMIN" ? await db.prepare("SELECT * FROM audit_logs ORDER BY create_time DESC LIMIT 50").all() : await db.prepare(`SELECT * FROM audit_logs WHERE dept_id IN (${placeholders(ctx.deptIds)}) ORDER BY create_time DESC LIMIT 50`).bind(...ctx.deptIds).all();
    const governanceTasks = ctx.role === "EMPLOYEE" ? { results: [] } : ctx.role === "SUPER_ADMIN"
      ? await db.prepare("SELECT t.*,d.title AS document_title,u.display_name AS reporter FROM knowledge_governance_tasks t LEFT JOIN documents d ON d.id=t.source_document_id JOIN users u ON u.id=t.reporter_user_id WHERE t.status='OPEN' ORDER BY t.create_time DESC LIMIT 50").all()
      : await db.prepare(`SELECT t.*,d.title AS document_title,u.display_name AS reporter FROM knowledge_governance_tasks t LEFT JOIN documents d ON d.id=t.source_document_id JOIN users u ON u.id=t.reporter_user_id WHERE t.status='OPEN' AND t.dept_id IN (${placeholders(ctx.deptIds)}) ORDER BY t.create_time DESC LIMIT 50`).bind(...ctx.deptIds).all();
    const departmentWhere = ctx.role === "SUPER_ADMIN" ? "d.is_active=1" : `d.is_active=1 AND d.id IN (${placeholders(ctx.deptIds)})`;
    const departments = await db.prepare(`SELECT d.id,d.code,d.name,d.parent_id,
      COALESCE((SELECT u.display_name FROM users u WHERE u.id=d.manager_user_id),
        (SELECT u.display_name FROM user_departments ud JOIN users u ON u.id=ud.user_id WHERE ud.dept_id=d.id AND ud.is_dept_admin=1 AND u.status='ACTIVE' LIMIT 1), '待配置部门管理员') AS approver
      FROM departments d WHERE ${departmentWhere} ORDER BY d.id`).bind(...(ctx.role === "SUPER_ADMIN" ? [] : ctx.deptIds)).all();
    const members = await db.prepare(`SELECT ud.dept_id,u.id,u.display_name FROM user_departments ud JOIN users u ON u.id=ud.user_id
      WHERE u.status='ACTIVE' AND ud.dept_id IN (${placeholders(ctx.role === "SUPER_ADMIN" ? (departments.results as { id: number }[]).map(d => Number(d.id)) : ctx.deptIds)}) ORDER BY u.display_name`)
      .bind(...(ctx.role === "SUPER_ADMIN" ? (departments.results as { id: number }[]).map(d => Number(d.id)) : ctx.deptIds)).all();
    const favorites=await db.prepare("SELECT document_id FROM user_favorites WHERE user_id=?").bind(ctx.userId).all<{document_id:number}>();
    const notifications=await db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY create_time DESC LIMIT 30").bind(ctx.userId).all();
    const spaces=await db.prepare(`SELECT s.*,f.id folder_id,f.name folder_name,f.parent_id,f.sort_order,(SELECT COUNT(*) FROM documents d WHERE d.space_id=s.id AND d.is_deleted=0) document_count FROM knowledge_spaces s LEFT JOIN knowledge_folders f ON f.space_id=s.id WHERE s.is_active=1 AND (${ctx.role === "SUPER_ADMIN" ? "1=1" : `s.dept_id IS NULL OR s.dept_id IN (${placeholders(ctx.deptIds)})`}) ORDER BY s.id,f.sort_order`).bind(...(ctx.role === "SUPER_ADMIN"?[]:ctx.deptIds)).all();
    const metricScope=ctx.role==="SUPER_ADMIN"?"1=1":`dept_id IN (${placeholders(ctx.deptIds)})`;
    const metrics=await db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='PENDING_DEPT_REVIEW' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN parse_status IN ('FAILED','OCR_FAILED','NEEDS_CONTENT') THEN 1 ELSE 0 END) parse_failed,SUM(CASE WHEN review_due_at IS NOT NULL AND review_due_at<=date('now','+30 day') AND status='ARCHIVED_ACTIVE' THEN 1 ELSE 0 END) due_soon,SUM(CASE WHEN verification_status='VERIFIED' THEN 1 ELSE 0 END) verified FROM documents WHERE is_deleted=0 AND ${metricScope}`).bind(...(ctx.role==="SUPER_ADMIN"?[]:ctx.deptIds)).first();
    return ok({ documents: result.results, logs: logs.results, governanceTasks: governanceTasks.results, currentUser: ctx, favorites:favorites.results.map(row=>Number(row.document_id)), notifications:notifications.results, spaces:spaces.results, metrics, uploadOptions: { departments: departments.results, members: members.results } }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid = requestId(request); let sourceKey: string | null = null;
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "upload", 20, 60);
    const contentType = request.headers.get("content-type") || "";
    const input = contentType.includes("application/json") ? await request.json() as Record<string, unknown> : Object.fromEntries(await request.formData());
    const value = (key: string) => input[key] ?? null;
    const title = requiredText(value("title") as string | null, "标题"); const category = requiredText(value("category") as string | null, "分类", 50); const owner = requiredText(value("owner") as string | null, "负责人", 100);
    const deptId = Number(value("deptId") || ctx.primaryDeptId);
    if (!ctx.deptIds.includes(deptId) && ctx.role !== "SUPER_ADMIN") throw new ApiError(403, "DEPARTMENT_FORBIDDEN", "只能在所属部门创建文档");
    const requestedStatus = String(value("status") ?? "DRAFT"); const status = requestedStatus === "review" || requestedStatus === "PENDING_DEPT_REVIEW" ? "PENDING_DEPT_REVIEW" : "DRAFT";
    const shareScope = String(value("shareScope") ?? "DEPT") === "CROSS_DEPT" && canManageDepartment(ctx, deptId) ? "CROSS_DEPT" : "DEPT";
    const file = value("file"); let sourceName = safeText(value("sourceName"), 240) || null; let mimeType = safeText(value("mimeType"), 200) || null; let size = Number(value("size") || 0);
    sourceKey = safeText(value("sourceKey"), 600) || null;
    if (sourceKey && !sourceKey.startsWith(`documents/${deptId}/`)) throw new ApiError(403, "FILE_SCOPE_MISMATCH", "文件与归属部门不匹配");
    if (file instanceof File && file.size > 0) {
      sourceName = file.name; mimeType = file.type || "application/octet-stream"; size = file.size; sourceKey = `documents/${deptId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const bucket = (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES;
      if (!bucket) throw new ApiError(503, "STORAGE_UNAVAILABLE", "文件存储服务暂不可用");
      await bucket.put(sourceKey, file.stream(), { httpMetadata: { contentType: mimeType } });
    }
    const extractedContent = safeText(value("content"), 500000); const extractionMethod = safeText(value("extractionMethod") || (extractedContent ? "MANUAL" : "NONE"), 40); const extractionDetail = safeText(value("extractionDetail"), 500); const ocrStatus = safeText(value("ocrStatus") || "NOT_REQUIRED", 40);
    const initialParseStatus = extractedContent ? "COMPLETED" : (ocrStatus === "FAILED" ? "OCR_FAILED" : sourceKey ? "PENDING" : "NEEDS_CONTENT");
    const db = getD1(); const id = crypto.getRandomValues(new Uint32Array(1))[0];const ownerUser=await db.prepare("SELECT u.id FROM users u JOIN user_departments ud ON ud.user_id=u.id WHERE u.status='ACTIVE' AND ud.dept_id=? AND u.display_name=? LIMIT 1").bind(deptId,owner).first<{id:number}>();
    await db.batch([
      db.prepare(`INSERT INTO documents(id,dept_id,space_id,folder_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,source_name,source_key,mime_type,size,version,review_due_at,retention_until,is_deleted,parse_status,extraction_method,extraction_detail,ocr_status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,date('now','+1095 day'),0,?,?,?,?)`).bind(id, deptId, Number(value("spaceId"))||null, Number(value("folderId"))||null, ctx.userId, ctx.userId, ownerUser?.id||ctx.userId, title, safeText(value("summary"), 1000), extractedContent, category, status, shareScope, safeText(value("securityLevel") || "INTERNAL", 30), owner, ctx.displayName, sourceName, sourceKey, mimeType, size, 1, safeText(value("reviewDueAt"), 30) || null, initialParseStatus, extractionMethod, extractionDetail, ocrStatus),
      db.prepare("INSERT INTO document_versions(document_id,version,title,content,change_note,operator_user_id,operator) VALUES(?,1,?,?,?,?,?)").bind(id, title, extractedContent, "上传并创建知识", ctx.userId, ctx.displayName),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'CREATE',?,?,?,?)").bind(id, deptId, ctx.userId, ctx.displayName, sourceName ? `上传文件 ${sourceName}` : "创建在线文档", rid),
      db.prepare("INSERT INTO ingestion_jobs(document_id,document_version,status,stage) VALUES(?,1,'QUEUED','EXTRACT')").bind(id),
    ]);
    const tagNames = safeText(value("tags"), 500).split(",").map(t => t.trim()).filter(Boolean).slice(0, 20);
    for (const name of tagNames) { await db.prepare("INSERT OR IGNORE INTO tags(name,dept_id) VALUES(?,?)").bind(name, deptId).run(); await db.prepare("INSERT OR IGNORE INTO document_tags(document_id,tag_id) SELECT ?,id FROM tags WHERE name=? AND dept_id=?").bind(id, name, deptId).run(); }
    if(sourceKey||extractedContent){const {processDocument}=await import("../../../lib/ingestion");await processDocument(id).catch(()=>undefined);}
    const document = await db.prepare("SELECT * FROM documents WHERE id=?").bind(id).first();
    return ok({ document }, rid, 201);
  } catch (error) {
    if (sourceKey) await (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES?.delete(sourceKey).catch(() => undefined);
    return fail(error, rid);
  }
}

export async function PATCH(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "workflow", 60, 60);
    const payload = await request.json() as { id?: number; action?: "submit" | "approve" | "reject" | "archive" | "void"; comment?: string };
    if (!payload.id || !payload.action) throw new ApiError(400, "VALIDATION_ERROR", "文档与操作不能为空");
    const db = getD1(); const doc = await db.prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(payload.id).first<Record<string, unknown>>();
    if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在"); const deptId = Number(doc.dept_id); const creatorId = Number(doc.create_user_id);
    const manager = canManageDepartment(ctx, deptId); if (payload.action === "submit" ? !(manager || creatorId === ctx.userId) : !manager) throw new ApiError(403, "FORBIDDEN", "无权执行该状态操作");
    const comment=safeText(payload.comment,1000);if(["reject","archive","void"].includes(payload.action)&&comment.length<2)throw new ApiError(400,"COMMENT_REQUIRED","驳回或作废必须填写原因");
    const target = resolveDocumentTransition(String(doc.status) as WorkflowStatus,payload.action as WorkflowAction);
    await db.batch([
      db.prepare("UPDATE documents SET status=?,published_version=CASE WHEN ?='ARCHIVED_ACTIVE' THEN version ELSE published_version END,published_title=CASE WHEN ?='ARCHIVED_ACTIVE' THEN title ELSE published_title END,published_content=CASE WHEN ?='ARCHIVED_ACTIVE' THEN content ELSE published_content END,verification_status=CASE WHEN ?='ARCHIVED_ACTIVE' THEN 'VERIFIED' ELSE verification_status END,verified_at=CASE WHEN ?='ARCHIVED_ACTIVE' THEN CURRENT_TIMESTAMP ELSE verified_at END,update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(target,target,target,target,target,target,ctx.userId,payload.id),
      db.prepare("INSERT INTO approval_records(document_id,applicant_user_id,approver_user_id,action,comment) VALUES(?,?,?,?,?)").bind(payload.id, creatorId, ctx.userId, payload.action.toUpperCase(), comment),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(payload.id, deptId, payload.action.toUpperCase(), ctx.userId, ctx.displayName, `状态更新为 ${target}`, rid),
      db.prepare("INSERT INTO notifications(user_id,type,title,content,document_id) VALUES(?,?,?,?,?)").bind(creatorId,payload.action.toUpperCase(),payload.action==="approve"?"资料已审批发布":payload.action==="reject"?"资料被驳回":"资料状态已更新",comment||String(doc.title),payload.id),
    ]);
    if (target === "ARCHIVED_ACTIVE") { const { processDocument }=await import("../../../lib/ingestion"); await processDocument(payload.id).catch(async error => {
      await db.prepare("UPDATE documents SET ai_index_status='FAILED' WHERE id=?").bind(payload.id).run();
      console.error(JSON.stringify({ level: "error", requestId: rid, action: "AI_INDEX", documentId: payload.id, message: error instanceof Error ? error.message : "索引失败" }));
    });
      await db.prepare("INSERT INTO notifications(user_id,type,title,content,document_id) SELECT user_id,'SUBSCRIPTION_UPDATE','订阅资料已发布',?,? FROM knowledge_subscriptions WHERE document_id=? AND is_active=1 AND user_id<>?").bind(String(doc.title),payload.id,payload.id,ctx.userId).run();
      const {dispatchWebhook}=await import("../../../lib/webhooks");await dispatchWebhook("DOCUMENT_PUBLISHED",{documentId:payload.id,deptId,title:doc.title,version:doc.version}).catch(()=>undefined);
    }
    return ok({ document: await db.prepare("SELECT * FROM documents WHERE id=?").bind(payload.id).first() }, rid);
  } catch (error) { return fail(error, rid); }
}
