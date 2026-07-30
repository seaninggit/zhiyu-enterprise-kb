import { env } from "cloudflare:workers";
import { ApiError, fail, ok, requestId } from "../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../lib/authz";

export async function PUT(request: Request) {
  const rid = requestId(request);
  let sourceKey: string | null = null;
  try {
    const ctx = await requireApiUser();
    await enforceRateLimit(ctx, "file-upload", 20, 60);
    const deptId = Number(request.headers.get("x-dept-id") || ctx.primaryDeptId);
    if (!ctx.deptIds.includes(deptId) && ctx.role !== "SUPER_ADMIN") throw new ApiError(403, "DEPARTMENT_FORBIDDEN", "只能向所属部门上传文件");
    if (!request.body) throw new ApiError(400, "EMPTY_FILE", "请选择需要上传的文件");
    const encodedName = request.headers.get("x-file-name") || "document";
    let sourceName = "document";
    try { sourceName = decodeURIComponent(encodedName); } catch { sourceName = encodedName; }
    sourceName = sourceName.trim().slice(0, 240) || "document";
    const mimeType = request.headers.get("content-type") || "application/octet-stream";
    const declaredSize = Number(request.headers.get("content-length") || 0);
    sourceKey = `documents/${deptId}/${crypto.randomUUID()}-${sourceName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const bucket = (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES;
    if (!bucket) throw new ApiError(503, "STORAGE_UNAVAILABLE", "文件存储服务暂不可用");
    const stored = await bucket.put(sourceKey, request.body, { httpMetadata: { contentType: mimeType } });
    return ok({ sourceKey, sourceName, mimeType, size: stored.size || declaredSize }, rid, 201);
  } catch (error) {
    if (sourceKey) await (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES?.delete(sourceKey).catch(() => undefined);
    return fail(error, rid);
  }
}
