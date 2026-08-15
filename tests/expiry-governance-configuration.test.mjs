import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("..",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("expiry governance policy is persisted, validated and editable",async()=>{
  const [migration,policy,route,page]=await Promise.all([
    read("drizzle/0036_expiry_governance_configuration.sql"),
    read("lib/expiry-governance.ts"),
    read("app/api/admin/scheduled-tasks/route.ts"),
    read("app/ExpiryGovernanceSettings.tsx"),
  ]);
  assert.match(migration,/config_json/);
  assert.match(migration,/PROPOSE_ONLY/);
  assert.match(migration,/复核到期提醒（已并入制度到期治理）/);
  assert.match(migration,/`enabled`=0/);
  assert.match(policy,/highCitationThreshold <= config\.mediumCitationThreshold/);
  assert.match(policy,/SELECTED_DEPARTMENTS/);
  assert.match(policy,/maxDocumentsPerRun/);
  assert.match(policy,/maxCostCny/);
  assert.match(policy,/单次运行成本上限/);
  assert.match(migration,/maxCostCny/);
  assert.match(page,/单次运行成本上限/);
  assert.match(policy,/assigneeStrategy/);
  assert.match(policy,/当前不支持自动执行/);
  assert.match(route,/validateExpiryGovernanceConfig/);
  assert.match(route,/config_version=config_version\+1/);
  assert.match(page,/提前触发天数/);
  assert.match(page,/治理范围/);
  assert.match(page,/任务与分派/);
  assert.match(page,/自动执行边界/);
  assert.match(page,/不发送外部邮件/);
});

test("scheduled expiry governance delegates to the controlled agent instead of hardcoding business steps",async()=>{
  const worker=await read("worker/index.ts");
  const expiryBlock=worker.slice(worker.indexOf('if (dueTasks.has("archive_expired"))'),worker.indexOf('if (dueTasks.has("detect_duplicates"))'));
  assert.match(expiryBlock,/parseExpiryGovernanceConfig/);
  assert.match(expiryBlock,/runGovernanceAgent/);
  assert.match(expiryBlock,/EXPIRY_GOVERNANCE_V1/);
  assert.match(expiryBlock,/triggerKey/);
  assert.match(expiryBlock,/expiryConfigVersion/);
  assert.match(expiryBlock,/last_run_at/);
  assert.match(worker,/SELECT code,cron_expr,config_json,config_version FROM scheduled_tasks/);
  // 入口只提交目标：查询制度、风险判断、建任务都必须由 Agent 工具完成
  assert.doesNotMatch(expiryBlock,/SELECT d\.id,d\.title/);
  assert.doesNotMatch(expiryBlock,/knowledge_governance_tasks/);
  assert.doesNotMatch(expiryBlock,/EXPIRY_GOVERNANCE_PROPOSED/);
  assert.doesNotMatch(expiryBlock,/UPDATE documents SET status='EXPIRED_VOID'/);
});
