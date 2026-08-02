import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../lib/api";
import { enforceRateLimit, requireApiUser } from "../../../lib/authz";
import { cosine, embedTexts } from "../../../lib/rag";
import { isValidEmbedding } from "../../../lib/text-chunks";

function placeholders(values: number[]) { return values.map(() => "?").join(","); }
function terms(query: string) {
  return Array.from(new Set(query.toLowerCase().split(/[\s，。！？、,.!?：:；;]+/).flatMap(term => term.length > 2 ? [term, ...Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2))] : [term]).filter(Boolean)));
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); await enforceRateLimit(ctx, "search", 90, 60);
    const payload = await request.json() as { query?: string; queryEmbedding?: unknown; filters?: { category?: string; mimeType?: string; spaceId?: number } };
    const query = safeText(payload.query, 300); if (!query) throw new ApiError(400, "VALIDATION_ERROR", "请输入搜索内容");
    const db = getD1(); let scope = "d.is_deleted=0 AND (d.status='ARCHIVED_ACTIVE' OR d.published_version IS NOT NULL)"; const binds: unknown[] = [];
    if (ctx.role !== "SUPER_ADMIN") {
      scope += ` AND (d.dept_id IN (${placeholders(ctx.deptIds)}) OR d.share_scope='CROSS_DEPT' OR EXISTS(SELECT 1 FROM document_acl a WHERE a.document_id=d.id AND a.permission='VIEW' AND (a.expires_at IS NULL OR a.expires_at>CURRENT_TIMESTAMP) AND ((a.subject_type='USER' AND a.subject_id=?) OR (a.subject_type='DEPT' AND a.subject_id IN (${placeholders(ctx.deptIds)}))))`;
      binds.push(...ctx.deptIds, ctx.userId, ...ctx.deptIds);
    }
    if (payload.filters?.category) { scope += " AND d.category=?"; binds.push(payload.filters.category); }
    if (payload.filters?.mimeType) { scope += " AND d.mime_type LIKE ?"; binds.push(`%${safeText(payload.filters.mimeType, 80)}%`); }
    if (payload.filters?.spaceId) { scope += " AND d.space_id=?"; binds.push(payload.filters.spaceId); }
    const rows = await db.prepare(`SELECT d.id,
      CASE WHEN d.status='ARCHIVED_ACTIVE' THEN d.title ELSE COALESCE(d.published_title,d.title) END title,
      d.summary,d.category,d.owner,CASE WHEN d.status='ARCHIVED_ACTIVE' THEN d.version ELSE COALESCE(d.published_version,d.version) END version,
      d.mime_type,d.update_time,d.verification_status,s.name space_name,dep.name department_name,c.content,c.embedding
      FROM documents d JOIN departments dep ON dep.id=d.dept_id LEFT JOIN knowledge_spaces s ON s.id=d.space_id
      LEFT JOIN document_chunks c ON c.document_id=d.id AND c.is_active=1 WHERE ${scope} ORDER BY d.update_time DESC LIMIT 1500`).bind(...binds).all<Record<string, unknown>>();
    const localVector = isValidEmbedding(payload.queryEmbedding) ? payload.queryEmbedding : undefined; const vector = localVector || (await embedTexts([query]).catch(() => []))[0]; const queryTerms = terms(query); const byDocument = new Map<number, Record<string, unknown> & { score: number; excerpt: string }>();
    for (const row of rows.results) {
      const corpus = `${row.title} ${row.summary} ${row.content ?? ""}`.toLowerCase();
      const keyword = queryTerms.reduce((sum, term) => sum + (corpus.includes(term) ? 1 : 0), 0) / Math.max(1, queryTerms.length);
      let semantic = 0; try { if (vector && row.embedding) semantic = cosine(vector, JSON.parse(String(row.embedding))); } catch { /* ignore malformed legacy embedding */ }
      const authority = row.verification_status === "VERIFIED" ? .06 : 0; const titleBoost = queryTerms.some(term => String(row.title).toLowerCase().includes(term)) ? .16 : 0;
      const score = Math.min(1, keyword * (vector ? .34 : .78) + semantic * (vector ? .44 : 0) + authority + titleBoost);
      const id = Number(row.id); const previous = byDocument.get(id);
      if (!previous || score > previous.score) byDocument.set(id, { ...row, score, excerpt: String(row.content || row.summary || "").slice(0, 220) });
    }
    const ranked = [...byDocument.values()].filter(row => row.score > (vector ? .08 : .02)).sort((a, b) => b.score - a.score).slice(0, 50);
    const mode = localVector ? "HYBRID_LOCAL" : vector ? "HYBRID_API" : "KEYWORD"; const log = await db.prepare("INSERT INTO search_logs(user_id,dept_id,query,result_count,mode) VALUES(?,?,?,?,?)").bind(ctx.userId, ctx.primaryDeptId, query, ranked.length, mode).run();
    return ok({ searchLogId: log.meta.last_row_id, results: ranked.map(row => ({ id:row.id,title:row.title,summary:row.summary,category:row.category,owner:row.owner,version:row.version,mime_type:row.mime_type,update_time:row.update_time,verification_status:row.verification_status,space_name:row.space_name,department_name:row.department_name,excerpt:row.excerpt,score:Number(row.score.toFixed(3)) })), mode, suggestions: ranked.length ? [] : ["尝试更换关键词", "选择其他知识空间", "提交知识缺口"] }, rid);
  } catch (error) { return fail(error, rid); }
}
