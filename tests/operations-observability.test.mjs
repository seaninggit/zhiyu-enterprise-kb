import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("..",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("notification delivery preserves retry payload and exposes audited retry",async()=>{
  const [migration,service,route,page]=await Promise.all([
    read("drizzle/0035_operations_delivery_runs.sql"),read("lib/notifications.ts"),
    read("app/api/admin/scheduled-tasks/route.ts"),read("app/page.tsx"),
  ]);
  assert.match(migration,/notification_deliveries.*subject/s);
  assert.match(migration,/notification_deliveries.*content/s);
  assert.match(service,/retryNotificationDelivery/);
  assert.match(service,/attempt=attempt\+1/);
  assert.match(service,/EMAIL_RETRY_SENT/);
  assert.match(route,/RETRY_NOTIFICATION/);
  assert.match(page,/通知投递/);
  assert.match(page,/重试邮件/);
});

test("scheduled tasks persist real success or failure runs and expose details",async()=>{
  const [migration,worker,route,page]=await Promise.all([
    read("drizzle/0035_operations_delivery_runs.sql"),read("worker/index.ts"),
    read("app/api/admin/scheduled-tasks/route.ts"),read("app/page.tsx"),
  ]);
  assert.match(migration,/scheduled_task_runs/);
  assert.match(worker,/status='SUCCESS'/);
  assert.match(worker,/status='FAILED'/);
  assert.match(worker,/CRON_TASK_FAILED/);
  assert.match(route,/last_status/);
  assert.match(page,/任务运行记录/);
  assert.match(page,/配置变更不等同于任务已经运行/);
});
