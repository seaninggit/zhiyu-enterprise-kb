import { env } from "cloudflare:workers";
import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, requiredText, safeText } from "../../../lib/api";
import { canManageDepartment, enforceRateLimit, requireApiUser } from "../../../lib/authz";
import { indexPublishedDocument } from "../../../lib/rag";

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
      where += ` AND ((d.dept_id IN (${placeholders(ctx.deptIds)}) AND (d.status='ARCHIVED_ACTIVE' OR d.create_user_id=?)) OR (d.share_scope='CROSS_DEPT' AND d.status='ARCHIVED_ACTIVE'))`; binds.push(...ctx.deptIds, ctx.userId);
    }
    const result = await db.prepare(`SELECT d.*, u.display_name AS creator_name, dep.name AS department_name,
      COALESCE((SELECT GROUP_CONCAT(t.name) FROM document_tags dt JOIN tags t ON t.id=dt.tag_id WHERE dt.document_id=d.id),'') AS tags
      FROM documents d JOIN users u ON u.id=d.create_user_id JOIN departments dep ON dep.id=d.dept_id
      WHERE ${where} ORDER BY d.update_time DESC, d.id DESC LIMIT 500`).bind(...binds).all();
    const logs = ctx.role === "SUPER_ADMIN" ? await db.prepare("SELECT * FROM audit_logs ORDER BY create_time DESC LIMIT 50").all() : await db.prepare(`SELECT * FROM audit_logs WHERE dept_id IN (${placeholders(ctx.deptIds)}) ORDER BY create_time DESC LIMIT 50`).bind(...ctx.deptIds).all();
    const departmentWhere = ctx.role === "SUPER_ADMIN" ? "d.is_active=1" : `d.is_active=1 AND d.id IN (${placeholders(ctx.deptIds)})`;
    const departments = await db.prepare(`SELECT d.id,d.code,d.name,d.parent_id,
      COALESCE((SELECT u.display_name FROM users u WHERE u.id=d.manager_user_id),
        (SELECT u.display_name FROM user_departments ud JOIN users u ON u.id=ud.user_id WHERE ud.dept_id=d.id AND ud.is_dept_admin=1 AND u.status='ACTIVE' LIMIT 1), '待配置部门管理员') AS approver
      FROM departments d WHERE ${departmentWhere} ORDER BY d.id`).bind(...(ctx.role === "SUPER_ADMIN" ? [] : ctx.deptIds)).all();
    const members = await db.prepare(`SELECT ud.dept_id,u.id,u.display_name FROM user_departments ud JOIN users u ON u.id=ud.user_id
      WHERE u.status='ACTIVE' AND ud.dept_id IN (${placeholders(ctx.role === "SUPER_ADMIN" ? (departments.results as { id: number }[]).map(d => Number(d.id)) : ctx.deptIds)}) ORDER BY u.display_name`)
      .bind(...(ctx.role === "SUPER_ADMIN" ? (departments.results as { id: number }[]).map(d => Number(d.id)) : ctx.deptIds)).all();
    return ok({ documents: result.results, logs: logs.results, currentUser: ctx, uploadOptions: { departments: departments.results, members: members.results } }, rid);
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
    const db = getD1(); const id = crypto.getRandomValues(new Uint32Array(1))[0];
    await db.batch([
      db.prepare(`INSERT INTO documents(id,dept_id,create_user_id,update_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,source_name,source_key,mime_type,size,version,review_due_at,is_deleted)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).bind(id, deptId, ctx.userId, ctx.userId, title, safeText(value("summary"), 1000), safeText(value("content"), 50000), category, status, shareScope, safeText(value("securityLevel") || "INTERNAL", 30), owner, ctx.displayName, sourceName, sourceKey, mimeType, size, 1, safeText(value("reviewDueAt"), 30) || null),
      db.prepare("INSERT INTO document_versions(document_id,version,title,content,change_note,operator_user_id,operator) VALUES(?,1,?,?,?,?,?)").bind(id, title, safeText(value("content"), 50000), "上传并创建知识", ctx.userId, ctx.displayName),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'CREATE',?,?,?,?)").bind(id, deptId, ctx.userId, ctx.displayName, sourceName ? `上传文件 ${sourceName}` : "创建在线文档", rid),
    ]);
    const tagNames = safeText(value("tags"), 500).split(",").map(t => t.trim()).filter(Boolean).slice(0, 20);
    for (const name of tagNames) { await db.prepare("INSERT OR IGNORE INTO tags(name,dept_id) VALUES(?,?)").bind(name, deptId).run(); await db.prepare("INSERT OR IGNORE INTO document_tags(document_id,tag_id) SELECT ?,id FROM tags WHERE name=? AND dept_id=?").bind(id, name, deptId).run(); }
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
    const target = payload.action === "approve" ? "ARCHIVED_ACTIVE" : payload.action === "reject" ? "DRAFT" : payload.action === "void" || payload.action === "archive" ? "EXPIRED_VOID" : "PENDING_DEPT_REVIEW";
    await db.batch([
      db.prepare("UPDATE documents SET status=?,update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(target, ctx.userId, payload.id),
      db.prepare("INSERT INTO approval_records(document_id,applicant_user_id,approver_user_id,action,comment) VALUES(?,?,?,?,?)").bind(payload.id, creatorId, ctx.userId, payload.action.toUpperCase(), safeText(payload.comment, 1000)),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(payload.id, deptId, payload.action.toUpperCase(), ctx.userId, ctx.displayName, `状态更新为 ${target}`, rid),
    ]);
    if (target === "ARCHIVED_ACTIVE") await indexPublishedDocument(payload.id).catch(async error => {
      await db.prepare("UPDATE documents SET ai_index_status='FAILED' WHERE id=?").bind(payload.id).run();
      console.error(JSON.stringify({ level: "error", requestId: rid, action: "AI_INDEX", documentId: payload.id, message: error instanceof Error ? error.message : "索引失败" }));
    });
    return ok({ document: await db.prepare("SELECT * FROM documents WHERE id=?").bind(payload.id).first() }, rid);
  } catch (error) { return fail(error, rid); }
}
