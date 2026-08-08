import { getD1 } from "../../../../db";
import { canManageDepartment, requireApiUser } from "../../../../lib/authz";
import { ApiError, fail, ok, requestId } from "../../../../lib/api";
import { runAgent } from "../../../../lib/agent";

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (ctx.role === "EMPLOYEE") throw new ApiError(403, "ADMIN_REQUIRED", "仅管理员可执行治理巡检");

    const db = getD1();
    const deptFilter = ctx.role === "SUPER_ADMIN" ? "1=1" : `d.dept_id IN (${ctx.deptIds.map(() => "?").join(",")})`;
    const binds: unknown[] = ctx.role === "SUPER_ADMIN" ? [] : [...ctx.deptIds];
    const url = new URL(request.url);
    const deepAnalysis = url.searchParams.get("agent") === "true";
    let agentTrace: Array<{tool:string;args:unknown;result:string}>|null=null;
    let agentSummary="";
    if(deepAnalysis){
      const result=await runAgent("巡检知识库质量：列出所有过期文档、重复文档、解析失败文档和空内容草稿，给出治理建议。",[],ctx);
      agentTrace=result.toolCalls;
      agentSummary=result.answer;
    }

    // 1. 过期文档（EXPIRED_VOID 状态或 review_due_at 已过）
    const expired = await db.prepare(
      `SELECT d.id,d.title,d.version,d.category,d.owner,d.review_due_at,d.status,d.update_time,dep.name as dept_name
       FROM documents d JOIN departments dep ON dep.id=d.dept_id
       WHERE d.is_deleted=0 AND ${deptFilter} AND (d.status='EXPIRED_VOID' OR (d.review_due_at<date('now') AND d.status='ARCHIVED_ACTIVE'))
       ORDER BY d.update_time DESC LIMIT 20`
    ).bind(...binds).all();

    // 2. 疑似重复（标题相似）
    const allTitles = await db.prepare(
      `SELECT d.id,d.title,d.category,d.owner,d.version,d.update_time,dep.name as dept_name
       FROM documents d JOIN departments dep ON dep.id=d.dept_id
       WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND ${deptFilter}
       ORDER BY d.update_time DESC LIMIT 200`
    ).bind(...binds).all();

    // Simple title similarity detection
    const duplicates: Array<{ docs: Record<string,unknown>[]; reason: string }> = [];
    const docs = allTitles.results as Record<string,unknown>[];
    const seen = new Set<number>();
    for (let i = 0; i < docs.length; i++) {
      if (seen.has(Number(docs[i].id))) continue;
      const group: Record<string,unknown>[] = [docs[i]];
      for (let j = i + 1; j < docs.length; j++) {
        if (seen.has(Number(docs[j].id))) continue;
        const t1 = String(docs[i].title || "").replace(/[Vv]\d+(\.\d+)*/g, "").replace(/[（(].*[）)]/g, "").trim();
        const t2 = String(docs[j].title || "").replace(/[Vv]\d+(\.\d+)*/g, "").replace(/[（(].*[）)]/g, "").trim();
        if (t1.length > 3 && t2.length > 3) {
          const common = t1.split("").filter(c => t2.includes(c)).length;
          const sim = common / Math.max(t1.length, t2.length);
          if (sim > 0.65) { group.push(docs[j]); seen.add(Number(docs[j].id)); }
        }
      }
      if (group.length > 1) { duplicates.push({ docs: group, reason: "标题高度相似" }); seen.add(Number(docs[i].id)); }
    }

    // 3. 解析失败
    const parseFails = await db.prepare(
      `SELECT d.id,d.title,d.version,d.category,d.owner,d.parse_status,d.source_name,d.mime_type,d.update_time,dep.name as dept_name
       FROM documents d JOIN departments dep ON dep.id=d.dept_id
       WHERE d.is_deleted=0 AND ${deptFilter} AND d.parse_status IN ('FAILED','OCR_FAILED','OCR_REQUIRED')
       ORDER BY d.update_time DESC LIMIT 20`
    ).bind(...binds).all();

    // 4. 空内容
    const empty = await db.prepare(
      `SELECT d.id,d.title,d.version,d.category,d.owner,d.status,d.update_time,dep.name as dept_name
       FROM documents d JOIN departments dep ON dep.id=d.dept_id
       WHERE d.is_deleted=0 AND ${deptFilter} AND d.status='DRAFT' AND (d.content='' OR d.content IS NULL OR length(d.content)<50)
       ORDER BY d.update_time DESC LIMIT 20`
    ).bind(...binds).all();

    // 5. 待审核
    const pending = await db.prepare(
      `SELECT d.id,d.title,d.version,d.category,d.owner,d.update_time,dep.name as dept_name
       FROM documents d JOIN departments dep ON dep.id=d.dept_id
       WHERE d.is_deleted=0 AND ${deptFilter} AND d.status='PENDING_DEPT_REVIEW'
       ORDER BY d.update_time DESC LIMIT 20`
    ).bind(...binds).all();

    // 6. 近30天搜索零结果
    const zeroSearch = await db.prepare(
      `SELECT query,COUNT(*) as cnt,MAX(create_time) as last_time FROM search_logs
       WHERE result_count=0 AND create_time>date('now','-30 days')
       GROUP BY query ORDER BY cnt DESC LIMIT 10`
    ).all();

    await db.prepare(
      "INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'GOVERNANCE_SCAN',?,?,?,?)"
    ).bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `治理巡检：${expired.results.length}过期 ${duplicates.length}重复 ${parseFails.results.length}解析失败`, rid).run();

    return ok({
      expired: expired.results,
      duplicates,
      parseFails: parseFails.results,
      empty: empty.results,
      pending: pending.results,
      zeroSearch: zeroSearch.results,
      agentTrace,
      agentSummary,
    }, rid);
  } catch (error) { return fail(error, rid); }
}
