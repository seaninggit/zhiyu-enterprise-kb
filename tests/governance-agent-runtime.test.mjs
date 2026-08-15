import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("..",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("governance agent runtime keeps the controlled-agent invariants",async()=>{
  const [agent,migration,schema]=await Promise.all([
    read("lib/governance-agent.ts"),
    read("drizzle/0037_controlled_governance_agent.sql"),
    read("db/schema.ts"),
  ]);
  // 幂等与去重：INSERT OR IGNORE 用 changes 判定，而不是残留的 last_row_id
  assert.match(agent,/meta\.changes===0/);
  assert.match(agent,/deduplicated:true/);
  // 引用统计用 JSON1 结构化展开，不再用 instr 字符串匹配
  assert.match(agent,/json_each/);
  assert.doesNotMatch(agent,/instr\(/);
  // 模型请求有超时，且主备候选都可尝试（fallback）
  assert.match(agent,/AbortSignal\.timeout/);
  assert.match(agent,/for\(const candidate of routes\)/);
  // 费用按既有 deepseek 口径写入运行表
  assert.match(agent,/estimated_cost=/);
  assert.match(agent,/0\.00000014/);
  // 高风险动作必须再次校验目标部门权限，且只落确认表
  assert.match(agent,/HIGH_RISK_TARGET_FORBIDDEN_OR_MISSING/);
  assert.match(agent,/INSERT INTO agent_action_confirmations/);
  // 工具分级覆盖 READ / LOW / HIGH
  assert.match(agent,/list_expiring_documents: "READ"/);
  assert.match(agent,/create_governance_task: "LOW"/);
  assert.match(agent,/propose_high_risk_action: "HIGH"/);
  // 到期治理配置作为单一来源传入并在 scope_json 快照版本
  assert.match(agent,/expiryConfig\?:ExpiryGovernanceConfig/);
  assert.match(agent,/expiryConfigVersion/);
  assert.match(agent,/taskCreationMode==="REPORT_ONLY"/);
  // 成本围栏：运行时累计成本超上限立即失败
  assert.match(agent,/COST_LIMIT_EXCEEDED/);
  assert.match(agent,/maxCostCny/);
  // 持久化四结构与暂停状态在迁移与 schema 中一致存在
  for (const table of ["agent_workflow_definitions","agent_workflow_runs","agent_workflow_steps","agent_action_confirmations"]) {
    assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema,new RegExp(`sqliteTable\\("${table}"`));
  }
  assert.match(migration,/WAITING_CONFIRMATION/);
  assert.match(migration,/UNIQUE\(definition_id, trigger_key\)/);
});

test("confirmation decisions never write business state directly",async()=>{
  const route=await read("app/api/admin/agent-confirmations/[id]/route.ts");
  // 批准作废必须委托现有正式业务服务，而不是直写 documents 状态
  assert.match(route,/documentsPatch/);
  assert.match(route,/action: "archive"/);
  // 正式服务拒绝或其它动作类型：停在 WAITING_EVENT，绝不回退为直接 SQL
  assert.match(route,/WAITING_EVENT/);
  assert.match(route,/HIGH_RISK_APPROVED_MANUAL_REQUIRED/);
  assert.match(route,/action === "VERIFY"/);
  assert.match(route,/import\("\.\.\/\.\.\/\.\.\/documents\/route"\)/);
  assert.doesNotMatch(route,/UPDATE\s+documents\s+SET\s+status/);
  // 拒绝后运行关闭而不是继续执行
  assert.match(route,/HIGH_RISK_REJECTED_BY_HUMAN/);
});
