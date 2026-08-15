import test from "node:test";
import assert from "node:assert/strict";
import { runGovernanceAgent } from "../lib/governance-agent.ts";

// 本测试不调用真实模型、不访问远程 D1：
// - fetch 全局桩返回脚本化模型应答（含主服务 500 → 备服务成功）
// - D1 桩按 SQL 内容返回脚本化行，并记录全部语句用于断言
const CFG = { actorUserId: 1, maxIterations: 6, maxToolCalls: 20, maxDocuments: 50, departmentIds: [1, 2], allowedTools: ["list_expiring_documents", "inspect_document", "create_governance_task", "propose_high_risk_action"], citationWindowDays: 30, mediumCitationThreshold: 3, highCitationThreshold: 10 };
const DOC1 = { id: 1, title: "制度A", dept_id: 1, review_due_at: "2026-08-01", owner_user_id: 2, create_user_id: 2, risk_level: "NORMAL", citation_count: 5 };

function toolCall(name, args) { return { id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }; }

function chatResponse(calls) {
  return { choices: [{ message: { content: "", tool_calls: calls } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
}

// 脚本化模型应答队列（备服务使用）；主服务永远 500
function installModelMock(successQueue) {
  const attempts = { primary: 0, fallback: 0 };
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("svc-primary")) {
      attempts.primary++;
      return { ok: false, status: 500, async json() { return {}; } };
    }
    attempts.fallback++;
    calls++;
    const scripted = successQueue[calls - 1];
    if (!scripted) return { ok: true, status: 200, async json() { return { choices: [{ message: { content: "治理巡检完成" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }; } };
    return { ok: true, status: 200, async json() { return scripted; } };
  };
  return attempts;
}

function makeDb(rows) {
  const calls = [];
  const runInserts = new Map();
  let stepId = 0;
  const statement = (sql, args) => ({
    async first() { calls.push({ type: "first", sql, args }); const row = rows.first?.(sql, args); return row; },
    async all() { calls.push({ type: "all", sql, args }); return { results: rows.all?.(sql, args) || [] }; },
    async run() {
      calls.push({ type: "run", sql, args });
      if (sql.includes("INSERT OR IGNORE INTO agent_workflow_runs")) {
        const key = String(args[2]);
        if (runInserts.has(key)) return { meta: { changes: 0, last_row_id: 0 } };
        runInserts.set(key, true);
        return { meta: { changes: 1, last_row_id: 1 } };
      }
      if (sql.includes("INSERT INTO agent_workflow_steps")) return { meta: { changes: 1, last_row_id: ++stepId } };
      return { meta: rows.run?.(sql, args) || { changes: 1, last_row_id: 1 } };
    },
  });
  return {
    db: {
      prepare(sql) { const stmt = statement(sql, []); return { bind(...args) { return statement(sql, args); }, first: stmt.first, all: stmt.all, run: stmt.run }; },
      async batch(items) { calls.push({ type: "batch", items: items.map(item => ({ sql: item.sql, args: item.args })) }); },
    },
    calls,
  };
}

function defaultRows(overrides = {}) {
  const definitions = [{ id: 1, code: "EXPIRY_GOVERNANCE_V1", goal: "治理目标", config_json: JSON.stringify({ ...CFG, ...(overrides.config || {}) }), config_version: 1 }];
  const services = [
    { model_code: "primary-model", base_url: "http://svc-primary", secret_env_key: "PRIMARY_KEY", provider: "deepseek" },
    { model_code: "fallback-model", base_url: "http://svc-fallback", secret_env_key: "FALLBACK_KEY", provider: "deepseek" },
  ];
  return {
    first(sql, args) {
      if (sql.includes("FROM agent_workflow_definitions")) return definitions[0];
      if (sql.includes("u.status,MAX(CASE WHEN r.scope")) return { status: "ACTIVE", global_scope: 1, governance_permission: 1 };
      if (sql.includes("SELECT id,status,summary FROM agent_workflow_runs")) return { id: 1, status: "SUCCEEDED", summary: "" };
      if (sql.includes("FROM documents d WHERE d.id=?")) return Number(args[0]) === 1 ? DOC1 : undefined;
      if (sql.includes("SELECT id,title,dept_id,owner_user_id,create_user_id FROM documents")) return Number(args[0]) === 1 ? { ...DOC1 } : undefined;
      if (sql.includes("SELECT id FROM documents WHERE id=? AND is_deleted=0")) return Number(args[0]) === 1 ? { id: 1 } : undefined;
      if (sql.includes("SELECT id FROM knowledge_governance_tasks WHERE source_document_id")) return undefined;
      if (sql.includes("SELECT u.id FROM users u JOIN user_departments")) return undefined;
      return undefined;
    },
    all(sql) {
      if (sql.includes("SELECT id FROM departments WHERE is_active=1")) return [{ id: 1 }, { id: 2 }];
      if (sql.includes("SELECT s.model_code,s.base_url,s.secret_env_key,s.provider")) return services;
      if (sql.includes("FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE'")) return [{ ...DOC1, citation_count: 5 }];
      if (sql.includes("FROM knowledge_governance_tasks WHERE source_document_id=?")) return [];
      return [];
    },
  };
}

test("agent loop: cross-department writes are rejected, high risk pauses, fallback works, dedup is stable", async () => {
  const { db, calls } = makeDb(defaultRows());
  const attempts = installModelMock([
    chatResponse([toolCall("list_expiring_documents", {}), toolCall("inspect_document", { document_id: 1 })]),
    chatResponse([toolCall("create_governance_task", { document_id: 99, reason: "越权尝试", detail: "试图为跨部门文档建任务" }), toolCall("propose_high_risk_action", { action_type: "VOID", target_type: "DOCUMENT", target_id: 1, reason: "制度过期", evidence: ["复核日已过"] })]),
  ]);
  try {
    const env = { PRIMARY_KEY: "p", FALLBACK_KEY: "f" };
    const result = await runGovernanceAgent(db, env, { definitionCode: "EXPIRY_GOVERNANCE_V1", triggerType: "SCHEDULED", triggerKey: "cron:2026-08-15", requestId: "test-rid-1" });
    assert.equal(result.status, "WAITING_CONFIRMATION");
    assert.equal(result.stopReason, "HIGH_RISK_CONFIRMATION_REQUIRED");
    assert.equal(attempts.primary, 2, "每轮先试主服务，失败后走备服务");
    assert.equal(attempts.fallback, 2, "暂停后不得再发起新的模型请求");
    const taskInserts = calls.filter(call => call.sql.includes("INSERT INTO knowledge_governance_tasks"));
    assert.equal(taskInserts.length, 0, "跨部门建任务必须被拒绝，不应产生任何任务写入");
    const confirmations = calls.filter(call => call.sql.includes("INSERT INTO agent_action_confirmations"));
    assert.equal(confirmations.length, 1, "高风险动作只落确认表");
    const stepKinds = calls.filter(call => call.sql.includes("INSERT INTO agent_workflow_steps")).map(call => call.args[2]);
    assert.ok(stepKinds.includes("TOOL_CALL") && stepKinds.includes("TOOL_RESULT"));
    assert.ok(!calls.some(call => call.sql.includes("UPDATE documents")), "Agent 运行期间不得直改文档表");
    const runUpdates = calls.filter(call => call.sql.startsWith("UPDATE agent_workflow_runs"));
    assert.equal(runUpdates.at(-1).args[0], "WAITING_CONFIRMATION");
    assert.ok(Number(runUpdates.at(-1).args[4]) > 0, "成本必须写入运行表");
    // 同一 trigger key 重放必须去重
    const replay = await runGovernanceAgent(db, env, { definitionCode: "EXPIRY_GOVERNANCE_V1", triggerType: "SCHEDULED", triggerKey: "cron:2026-08-15", requestId: "test-rid-2" });
    assert.equal(replay.deduplicated, true);
    const runInserts = calls.filter(call => call.sql.includes("INSERT OR IGNORE INTO agent_workflow_runs"));
    assert.equal(runInserts.length, 2, "两次触发只有两条 INSERT OR IGNORE，第二次被忽略");
    assert.equal(runInserts[1].args[0] !== runInserts[0].args[0], false);
  } finally {
    globalThis.fetch = undefined;
  }
});

test("agent fails fast with MODEL_UNAVAILABLE when no route has a key", async () => {
  const { db, calls } = makeDb(defaultRows());
  globalThis.fetch = async () => { throw new Error("must not be called"); };
  try {
    const result = await runGovernanceAgent(db, {}, { definitionCode: "EXPIRY_GOVERNANCE_V1", triggerType: "SCHEDULED", triggerKey: "cron:2026-08-16", requestId: "test-rid-3" });
    assert.equal(result.status, "FAILED");
    assert.equal(result.stopReason, "MODEL_UNAVAILABLE");
    const finalUpdate = calls.filter(call => call.sql.startsWith("UPDATE agent_workflow_runs")).at(-1);
    assert.match(finalUpdate.sql, /status='FAILED'/);
  } finally {
    globalThis.fetch = undefined;
  }
});

test("tool budget produces PARTIAL instead of silent success", async () => {
  const { db, calls } = makeDb(defaultRows({ config: { maxToolCalls: 2 } }));
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const toolCount = (body.messages || []).filter(message => message.role === "assistant").reduce((sum, message) => sum + (message.tool_calls?.length || 0), 0);
    if (toolCount >= 2) return { ok: true, status: 200, async json() { return { choices: [{ message: { content: "", tool_calls: [toolCall("list_expiring_documents", {})] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
    return { ok: true, status: 200, async json() { return { choices: [{ message: { content: "", tool_calls: [toolCall("list_expiring_documents", {}), toolCall("inspect_document", { document_id: 1 })] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
  };
  try {
    const result = await runGovernanceAgent(db, { PRIMARY_KEY: "p", FALLBACK_KEY: "f" }, { definitionCode: "EXPIRY_GOVERNANCE_V1", triggerType: "SCHEDULED", triggerKey: "cron:2026-08-17", requestId: "test-rid-4" });
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.stopReason, "TOOL_BUDGET_EXCEEDED");
    const finalUpdate = calls.filter(call => call.sql.startsWith("UPDATE agent_workflow_runs")).at(-1);
    assert.equal(finalUpdate.args[0], "PARTIAL");
  } finally {
    globalThis.fetch = undefined;
  }
});
