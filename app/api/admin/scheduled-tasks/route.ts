import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../lib/authz";
import { parseExpiryGovernanceConfig, validateExpiryGovernanceConfig } from "../../../../lib/expiry-governance";
import { retryNotificationDelivery } from "../../../../lib/notifications";

export async function GET(_request: Request) {
  const rid = requestId(_request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权管理定时任务");
    const db = getD1();
    const [tasks,runs,deliveries,departments] = await Promise.all([
      db.prepare(`SELECT t.*,(SELECT status FROM scheduled_task_runs r WHERE r.task_code=t.code ORDER BY r.id DESC LIMIT 1) last_status,(SELECT detail FROM scheduled_task_runs r WHERE r.task_code=t.code ORDER BY r.id DESC LIMIT 1) last_detail FROM scheduled_tasks t ORDER BY t.id`).all(),
      db.prepare("SELECT * FROM scheduled_task_runs ORDER BY id DESC LIMIT 30").all(),
      db.prepare("SELECT nd.id,nd.event_type,nd.recipient,nd.status,nd.attempt,nd.error_message,nd.create_time,nd.update_time,d.title document_title FROM notification_deliveries nd LEFT JOIN documents d ON d.id=nd.document_id ORDER BY nd.id DESC LIMIT 30").all(),
      db.prepare("SELECT id,name FROM departments WHERE is_active=1 ORDER BY name").all(),
    ]);
    const taskRows=tasks.results.map(task=>{
      const row=task as Record<string,unknown>;
      return row.code==="archive_expired"?{...row,expiry_config:parseExpiryGovernanceConfig(row.config_json)}:row;
    });
    return ok({ tasks: taskRows, runs:runs.results, deliveries:deliveries.results, departments:departments.results }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function PATCH(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权管理定时任务");

    const p = await request.json() as { id?: number; enabled?: boolean; name?: string; cron_expr?: string; expiryConfig?: unknown };
    const id = Number(p.id);
    if (!id) throw new ApiError(400, "VALIDATION_ERROR", "任务ID不能为空");

    const db = getD1();
    const task = await db.prepare("SELECT id,code FROM scheduled_tasks WHERE id=?").bind(id).first<{id:number;code:string}>();
    if (!task) throw new ApiError(404, "NOT_FOUND", "任务不存在");

    if (typeof p.enabled === "boolean") {
      await db.prepare("UPDATE scheduled_tasks SET enabled=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(p.enabled ? 1 : 0, id).run();
    }
    const name = safeText(p.name, 60);
    const cronExpr = safeText(p.cron_expr, 40);
    if (name || cronExpr) {
      if (name) await db.prepare("UPDATE scheduled_tasks SET name=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(name, id).run();
      if (cronExpr) {
        if(!/^(\*|\d{1,2})(,(\d{1,2}))*\s+(\*|\d{1,2})(,(\d{1,2}))*\s+(\*|\d{1,2})\s+(\*|\d{1,2})\s+(\*|\d)$/.test(cronExpr))throw new ApiError(400,"CRON_INVALID","执行频率格式无效");
        await db.prepare("UPDATE scheduled_tasks SET cron_expr=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(cronExpr, id).run();
      }
    }
    if (p.expiryConfig !== undefined) {
      if (task.code !== "archive_expired") throw new ApiError(400,"CONFIG_NOT_SUPPORTED","该任务不支持制度到期治理配置");
      let config;
      try { config=validateExpiryGovernanceConfig(p.expiryConfig); }
      catch(error){ throw new ApiError(400,"CONFIG_INVALID",error instanceof Error?error.message:"制度到期治理配置无效"); }
      await db.prepare("UPDATE scheduled_tasks SET config_json=?,config_version=config_version+1,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(config),id).run();
    }
    const auditDetail=p.expiryConfig!==undefined?`更新制度到期治理策略 #${id}`:`更新定时任务 #${id}`;
    await db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'UPDATE_SCHEDULED',?,'Admin',?,?)").bind(ctx.primaryDeptId, ctx.userId, auditDetail, rid).run();
    return ok({ updated: true, id }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid=requestId(request);
  try{
    const ctx=await requireApiUser();
    if(!hasPermission(ctx,"governance:platform"))throw new ApiError(403,"FORBIDDEN","无权管理通知投递");
    const p=await request.json() as {action?:string;id?:number};
    if(p.action!=="RETRY_NOTIFICATION")throw new ApiError(400,"ACTION_INVALID","不支持的运维操作");
    const id=Number(p.id);if(!id)throw new ApiError(400,"VALIDATION_ERROR","投递记录ID不能为空");
    try{return ok(await retryNotificationDelivery(id,rid,ctx.userId,ctx.displayName),rid);}
    catch(error){throw new ApiError(409,"DELIVERY_RETRY_REJECTED",error instanceof Error?error.message:"邮件重试失败");}
  }catch(error){return fail(error,rid);}
}
