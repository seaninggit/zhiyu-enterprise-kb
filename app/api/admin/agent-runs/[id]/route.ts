import { getD1 } from "../../../../../db";
import { ApiError, fail, ok, requestId } from "../../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../../lib/authz";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权查看 Agent 运行");
    const id = Number((await context.params).id);
    if (!id) throw new ApiError(400, "VALIDATION_ERROR", "运行ID不能为空");
    const db = getD1();
    const run = await db.prepare("SELECT r.*,d.code definition_code,d.name definition_name FROM agent_workflow_runs r JOIN agent_workflow_definitions d ON d.id=r.definition_id WHERE r.id=?").bind(id).first();
    if (!run) throw new ApiError(404, "NOT_FOUND", "运行不存在");
    const [steps, confirmations] = await Promise.all([
      db.prepare("SELECT * FROM agent_workflow_steps WHERE run_id=? ORDER BY sequence_no").bind(id).all(),
      db.prepare("SELECT * FROM agent_action_confirmations WHERE run_id=? ORDER BY id DESC").bind(id).all(),
    ]);
    // 不展示内部思维链：仅返回工具调用、结果摘要、业务证据与错误
    return ok({ run, steps: steps.results, confirmations: confirmations.results }, rid);
  } catch (error) { return fail(error, rid); }
}
