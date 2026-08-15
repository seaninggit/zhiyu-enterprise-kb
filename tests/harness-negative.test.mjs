import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const script = name => join(new URL(`../scripts/${name}`, import.meta.url).pathname);
const runCheck = (name, args = []) => execFileSync("node", [script(name), ...args], { encoding: "utf8", stdio: "pipe" });

function guardrailsFixture() {
  const fixture = mkdtempSync(join(tmpdir(), "zhiyu-guardrails-negative-"));
  for (const path of ["app", "lib", "db", "drizzle", "tests", "worker", "harness", ".github/workflows", "scripts"])
    mkdirSync(join(fixture, path), { recursive: true });
  for (const path of [
    "AGENTS.md", "package.json", "scripts/deploy.sh",
    "scripts/check-maintainability.mjs", "scripts/check-control-matrix.mjs", "scripts/check-frontend-quality.mjs",
    "harness/config.json", "harness/control-matrix.json",
    "harness/rag-evaluation-contract.json", "harness/acceptance-template.json",
    "harness/frontend-quality-contract.json",
    ".github/workflows/engineering-harness.yml",
  ]) cpSync(new URL(`../${path}`, import.meta.url), join(fixture, path));
  writeFileSync(join(fixture, "worker/index.ts"), "export default {};\n");
  execFileSync("git", ["init", "-q"], { cwd: fixture });
  return fixture;
}

test("guardrails reject a hardcoded business branch in an untracked production file", () => {
  const fixture = guardrailsFixture();
  writeFileSync(join(fixture, "lib/untracked-bad.ts"), 'export function probe(question) { if (question === "材料") return "固定答案"; }\n');
  assert.throws(
    () => runCheck("check-engineering-guardrails.mjs", [fixture]),
    /business example controls production behavior/,
  );
});

test("guardrails never scan demo-files/ or .local-backups/, even with non-ASCII paths", () => {
  const fixture = guardrailsFixture();
  mkdirSync(join(fixture, "demo-files"), { recursive: true });
  mkdirSync(join(fixture, ".local-backups"), { recursive: true });
  writeFileSync(join(fixture, "demo-files", "2026年Q3市场拓展计划.ts"), 'export function probe(query) { return query.includes("北京") ? "固定答案" : null; }\n');
  writeFileSync(join(fixture, ".local-backups", "old-worker.ts"), 'export function probe(query) { return query.includes("深圳") ? "固定答案" : null; }\n');
  const output = runCheck("check-engineering-guardrails.mjs", [fixture]);
  assert.match(output, /guardrails passed/);
});

test("product scope rejects a capability in both allowed and excluded lists", () => {
  const fixture = mkdtempSync(join(tmpdir(), "zhiyu-product-scope-negative-"));
  mkdirSync(join(fixture, "harness"), { recursive: true });
  writeFileSync(join(fixture, "harness", "config.json"), JSON.stringify({
    version: 1,
    allowedCapabilities: ["governed-rag", "controlled-agent-v1", "expiry-governance-agent", "high-risk-autonomous-agent-actions"],
    excludedCapabilities: ["professional-vector-database", "high-risk-autonomous-agent-actions"],
  }));
  for (const path of ["PRODUCT.md", "AGENTS.md"]) cpSync(new URL(`../${path}`, import.meta.url), join(fixture, path));
  assert.throws(
    () => runCheck("check-product-scope.mjs", [fixture]),
    /capability conflict in both allowedCapabilities and excludedCapabilities: high-risk-autonomous-agent-actions/,
  );
});

function agentFixture(governanceAgentSource) {
  const fixture = mkdtempSync(join(tmpdir(), "zhiyu-agent-architecture-negative-"));
  for (const path of ["lib", "drizzle"]) mkdirSync(join(fixture, path), { recursive: true });
  writeFileSync(join(fixture, "lib", "governance-agent.ts"), governanceAgentSource);
  writeFileSync(join(fixture, "drizzle", "0037_controlled_governance_agent.sql"), "");
  return fixture;
}

const agentMarkers = "// agent_workflow_runs agent_workflow_steps agent_action_confirmations WAITING_CONFIRMATION\nconst toolPolicy = {};\n";

test("agent architecture rejects direct mutation of a high-risk document status", () => {
  const fixture = agentFixture(agentMarkers + `db.prepare("UPDATE documents SET status = 'EXPIRED_VOID' WHERE id = ?");\n`);
  assert.throws(
    () => runCheck("check-agent-architecture.mjs", [fixture]),
    /directly mutates a high-risk document status/,
  );
});

test("agent architecture rejects a fixed recipient or sender", () => {
  const fixture = agentFixture(agentMarkers + 'const notifyTo = "yangshanpm@example.com";\n');
  assert.throws(
    () => runCheck("check-agent-architecture.mjs", [fixture]),
    /fixed recipient or sender/,
  );
});

test("agent architecture rejects a runtime without persistence tables or pause state", () => {
  const fixture = agentFixture('export async function runAgent() { return "ok"; }\n');
  assert.throws(
    () => runCheck("check-agent-architecture.mjs", [fixture]),
    /missing marker/,
  );
});

test("control matrix requires agent-specific controls", () => {
  const fixture = mkdtempSync(join(tmpdir(), "zhiyu-control-matrix-negative-"));
  mkdirSync(join(fixture, "harness"), { recursive: true });
  const matrix = JSON.parse(readFileSync(new URL("../harness/control-matrix.json", import.meta.url), "utf8"));
  delete matrix.domains["agent-governance"];
  writeFileSync(join(fixture, "harness", "control-matrix.json"), JSON.stringify(matrix));
  assert.throws(
    () => runCheck("check-control-matrix.mjs", [fixture]),
    /missing control domain: agent-governance/,
  );
});

test("product scope and agent architecture checks pass on the real repository", () => {
  assert.match(runCheck("check-product-scope.mjs", [root]), /Product scope passed/);
  assert.match(runCheck("check-agent-architecture.mjs", [root]), /architecture guard passed/);
  assert.match(runCheck("check-control-matrix.mjs", [root]), /Control matrix passed/);
});
