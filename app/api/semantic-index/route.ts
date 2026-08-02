import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../lib/api";
import { canManageDepartment, enforceRateLimit, requireApiUser } from "../../../lib/authz";
import { chunkText, documentIndexText, isValidEmbedding, LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL } from "../../../lib/text-chunks";

async function editableDocument(documentId: number, ctx: Awaited<ReturnType<typeof requireApiUser>>) {
  const doc = await getD1().prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(documentId).first<Record<string, unknown>>();
  if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在");
  const canIndex = canManageDepartment(ctx, Number(doc.dept_id)) || Number(doc.create_user_id) === ctx.userId;
  if (!canIndex) throw new ApiError(403, "INDEX_FORBIDDEN", "无权为该资料建立语义索引");
  return doc;
}

function canonicalChunks(doc: Record<string, unknown>) {
  return chunkText(documentIndexText(doc));
}

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "semantic-index-read", 90, 60);
    const documentId = Number(new URL(request.url).searchParams.get("documentId"));
    if (!documentId) throw new ApiError(400, "VALIDATION_ERROR", "缺少文档编号");
    const doc = await editableDocument(documentId, ctx);
    if (String(doc.parse_status) !== "COMPLETED") throw new ApiError(422, "DOCUMENT_NOT_PARSED", "资料正文尚未解析完成，不能建立语义索引");
    const chunks = canonicalChunks(doc);
    return ok({ documentId, version: Number(doc.version), chunks, model: LOCAL_EMBEDDING_MODEL, dimensions: LOCAL_EMBEDDING_DIMENSIONS }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "semantic-index-write", 20, 60);
    const payload = await request.json() as { documentId?: number; version?: number; model?: string; vectors?: unknown[] };
    const documentId = Number(payload.documentId); if (!documentId) throw new ApiError(400, "VALIDATION_ERROR", "缺少文档编号");
    const doc = await editableDocument(documentId, ctx); const version = Number(doc.version);
    if (String(doc.parse_status) !== "COMPLETED") throw new ApiError(422, "DOCUMENT_NOT_PARSED", "资料正文尚未解析完成，不能写入语义索引");
    if (Number(payload.version) !== version) throw new ApiError(409, "DOCUMENT_VERSION_CHANGED", "资料版本已更新，请重新生成索引");
    const model = safeText(payload.model, 160); if (model !== LOCAL_EMBEDDING_MODEL) throw new ApiError(400, "MODEL_NOT_ALLOWED", "仅允许当前本地语义模型写入索引");
    const chunks = canonicalChunks(doc); const vectors = Array.isArray(payload.vectors) ? payload.vectors : [];
    if (!chunks.length) throw new ApiError(422, "NO_INDEXABLE_TEXT", "资料尚无可建立索引的正文");
    if (vectors.length !== chunks.length || vectors.length > 120 || !vectors.every(vector => isValidEmbedding(vector))) throw new ApiError(400, "INVALID_VECTORS", "语义向量数量或维度不正确");
    const db = getD1(); const statements = [db.prepare("DELETE FROM document_chunks WHERE document_id=?").bind(documentId)];
    chunks.forEach((content, index) => statements.push(db.prepare("INSERT INTO document_chunks(document_id,dept_id,document_version,chunk_index,content,embedding,embedding_model,is_active) VALUES(?,?,?,?,?,?,?,1)").bind(documentId, doc.dept_id, version, index, content, JSON.stringify(vectors[index]), model)));
    statements.push(db.prepare("UPDATE documents SET ai_index_status='INDEXED_LOCAL',ai_indexed_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(documentId));
    statements.push(db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?,?)").bind(documentId, doc.dept_id, "SEMANTIC_INDEX", ctx.userId, ctx.displayName, `${chunks.length} 个切片 · ${model}`, rid));
    await db.batch(statements);
    return ok({ documentId, version, chunks: chunks.length, dimensions: LOCAL_EMBEDDING_DIMENSIONS, status: "INDEXED_LOCAL" }, rid);
  } catch (error) { return fail(error, rid); }
}
