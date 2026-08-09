import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../lib/authz";

export async function GET(_request: Request) {
  const rid = requestId(_request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权管理定时任务");
    const db = getD1();
    const tasks = await db.prepare("SELECT * FROM scheduled_tasks ORDER BY id").all();
    return ok({ tasks: tasks.results }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function PATCH(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权管理定时任务");

    const p = await request.json() as { id?: number; enabled?: boolean; name?: string; cron_expr?: string };
    const id = Number(p.id);
    if (!id) throw new ApiError(400, "VALIDATION_ERROR", "任务ID不能为空");

    const db = getD1();
    const task = await db.prepare("SELECT id FROM scheduled_tasks WHERE id=?").bind(id).first();
    if (!task) throw new ApiError(404, "NOT_FOUND", "任务不存在");

    if (typeof p.enabled === "boolean") {
      await db.prepare("UPDATE scheduled_tasks SET enabled=? WHERE id=?").bind(p.enabled ? 1 : 0, id).run();
    }
    const name = safeText(p.name, 60);
    const cronExpr = safeText(p.cron_expr, 40);
    if (name || cronExpr) {
      if (name) await db.prepare("UPDATE scheduled_tasks SET name=? WHERE id=?").bind(name, id).run();
      if (cronExpr) await db.prepare("UPDATE scheduled_tasks SET cron_expr=? WHERE id=?").bind(cronExpr, id).run();
    }
    await db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'UPDATE_SCHEDULED',?,'Admin',?,?)").bind(ctx.primaryDeptId, ctx.userId, `更新定时任务 #${id}`, rid).run();
    return ok({ updated: true, id }, rid);
  } catch (error) { return fail(error, rid); }
}
