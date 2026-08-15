import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 用 macOS 自带 sqlite3 在真实 SQLite（D1 兼容子集）上执行 Agent 的实际 SQL，
// 验证 json_each 引用统计、部门过滤、幂等插入与状态约束。不调用模型、不访问远程 D1。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = join(mkdtempSync(join(tmpdir(), "zhiyu-agent-sql-")), "agent.sqlite");
const sql = (input) => {
  const dedented = input.split("\n").map(line => line.trim()).join("\n");
  const result = spawnSync("sqlite3", [database], { input: dedented, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
};

test("agent SQL behaves correctly on a real D1-compatible SQLite", () => {
  const migrations = readdirSync(join(root, "drizzle")).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    sql(readFileSync(join(root, "drizzle", migration), "utf8"));
  }
  sql(`
    INSERT OR IGNORE INTO users(id,email,display_name,status) VALUES(1,'admin@test.local','管理员','ACTIVE');
    UPDATE users SET status='ACTIVE' WHERE id=1;
    UPDATE roles SET scope='global' WHERE id=1;
    INSERT OR IGNORE INTO departments(id,code,name) VALUES(1,'DEPT1','部门一'),(2,'DEPT2','部门二');
    INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,title,category,owner,uploader,status,version,published_version,review_due_at) VALUES
      (1,1,1,'制度A','制度','甲','甲','ARCHIVED_ACTIVE',1,1,date('now','-1 day')),
      (2,2,1,'制度B','制度','乙','乙','ARCHIVED_ACTIVE',1,1,date('now','-1 day'));
    UPDATE documents SET dept_id=1,status='ARCHIVED_ACTIVE',published_version=1,review_due_at=date('now','-1 day'),is_deleted=0 WHERE id=1;
    UPDATE documents SET dept_id=2,status='ARCHIVED_ACTIVE',published_version=1,review_due_at=date('now','-1 day'),is_deleted=0 WHERE id=2;
    INSERT INTO ai_query_logs(user_id,dept_id,question,answer,mode,source_document_ids,request_id) VALUES(1,1,'q','a','rag','[1]','rid-agent-sql-1');
  `);

  // 1) listExpiring 的 json_each 引用统计：doc1 被引用 1 次；部门过滤保证部门2文档不出现在候选
  const cited = sql(`
    .mode json
    SELECT d.id,(SELECT COUNT(*) FROM ai_query_logs q, json_each(q.source_document_ids) je WHERE q.create_time>date('now','-30 day') AND CAST(je.value AS INTEGER)=d.id) citation_count
    FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND d.published_version IS NOT NULL
    AND d.review_due_at IS NOT NULL AND date(d.review_due_at)<=date('now','+30 day') AND d.dept_id IN (1)
    ORDER BY date(d.review_due_at),d.id LIMIT 50;`);
  const rows = JSON.parse(cited);
  const byId = Object.fromEntries(rows.map(row => [Number(row.id), Number(row.citation_count)]));
  assert.equal(byId[1], 1, "json_each 引用统计精确计数");
  assert.equal(byId[2], undefined, "部门2的文档不得出现在部门1的候选里");

  // 2) inspectDocument / createGovernanceTask 的对象级部门过滤：部门2文档不可见
  const forbidden = JSON.parse(sql(`
    .mode json
    SELECT id FROM documents WHERE id=2 AND is_deleted=0 AND dept_id IN (1);`) || "[]");
  assert.equal(forbidden.length, 0, "跨部门文档必须不可见");

  // 3) INSERT OR IGNORE 幂等：同一 (definition_id, trigger_key) 第二次插入 changes=0
  const firstInsert = JSON.parse(sql(`
    .mode json
    INSERT OR IGNORE INTO agent_workflow_runs(definition_id,trigger_type,trigger_key,goal,status,actor_user_id,scope_json,request_id)
    VALUES(1,'SCHEDULED','cron:2026-08-15','g','PENDING',1,'{}','rid-1');
    SELECT changes() changed;`));
  assert.equal(Number(firstInsert[0].changed), 1);
  const secondInsert = JSON.parse(sql(`
    .mode json
    INSERT OR IGNORE INTO agent_workflow_runs(definition_id,trigger_type,trigger_key,goal,status,actor_user_id,scope_json,request_id)
    VALUES(1,'SCHEDULED','cron:2026-08-15','g','PENDING',1,'{}','rid-2');
    SELECT changes() changed;`));
  assert.equal(Number(secondInsert[0].changed), 0, "重复触发键必须被忽略");
  const runCount = JSON.parse(sql(`.mode json
    SELECT COUNT(*) cnt FROM agent_workflow_runs WHERE trigger_key='cron:2026-08-15';`));
  assert.equal(Number(runCount[0].cnt), 1);

  // 4) 状态约束：WAITING_CONFIRMATION 合法，非法状态必须被拒绝
  sql(`UPDATE agent_workflow_runs SET status='WAITING_CONFIRMATION',update_time=CURRENT_TIMESTAMP WHERE id=1;`);
  assert.throws(() => sql("UPDATE agent_workflow_runs SET status='BOGUS_STATUS' WHERE id=1;"), /CHECK|check/i);

  // 5) 0037 种子定义存在且含治理参数字段
  const seed = JSON.parse(sql(`.mode json
    SELECT config_json FROM agent_workflow_definitions WHERE code='EXPIRY_GOVERNANCE_V1';`));
  const config = JSON.parse(seed[0].config_json);
  assert.equal(config.citationWindowDays, 30);
  assert.equal(config.highCitationThreshold, 10);
  assert.ok(Array.isArray(config.allowedTools) && config.allowedTools.includes("propose_high_risk_action"));
});
