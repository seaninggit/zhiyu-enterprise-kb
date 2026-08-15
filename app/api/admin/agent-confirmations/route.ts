import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId } from "../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../lib/authz";

export async function GET(_request: Request) {
  const rid = requestId(_request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权查看 Agent 待确认");
    const db = getD1();
    const confirmations = await db.prepare(`SELECT c.*,r.goal,r.status run_status,r.trigger_key,d.code definition_code,
      CASE WHEN c.target_type='DOCUMENT' THEN (SELECT title FROM documents doc WHERE doc.id=c.target_id) ELSE NULL END target_title
      FROM agent_action_confirmations c JOIN agent_workflow_runs r ON r.id=c.run_id JOIN agent_workflow_definitions d ON d.id=r.definition_id
      ORDER BY CASE WHEN c.status='PENDING' THEN 0 ELSE 1 END,c.id DESC LIMIT 50`).all();
    return ok({ confirmations: confirmations.results }, rid);
  } catch (error) { return fail(error, rid); }
}
