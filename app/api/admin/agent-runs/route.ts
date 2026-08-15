import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId } from "../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../lib/authz";

export async function GET(_request: Request) {
  const rid = requestId(_request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权查看 Agent 运行");
    const db = getD1();
    const runs = await db.prepare(`SELECT r.id,r.definition_id,d.code definition_code,d.name definition_name,r.trigger_type,r.trigger_key,r.goal,r.status,r.actor_user_id,r.scope_json,r.summary,r.stop_reason,r.model,r.input_tokens,r.output_tokens,r.estimated_cost,r.started_at,r.finished_at,r.create_time,r.update_time,
      (SELECT COUNT(*) FROM agent_workflow_steps s WHERE s.run_id=r.id) step_count,
      (SELECT COUNT(*) FROM agent_action_confirmations c WHERE c.run_id=r.id AND c.status='PENDING') pending_confirmations
      FROM agent_workflow_runs r JOIN agent_workflow_definitions d ON d.id=r.definition_id ORDER BY r.id DESC LIMIT 50`).all();
    return ok({ runs: runs.results }, rid);
  } catch (error) { return fail(error, rid); }
}
