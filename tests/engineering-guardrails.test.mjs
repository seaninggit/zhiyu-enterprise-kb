import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

test("repository preserves Zhiyu delivery and anti-hardcoding guardrails", () => {
  const output = execFileSync(
    "node",
    [new URL("../scripts/check-engineering-guardrails.mjs", import.meta.url).pathname, root],
    { encoding: "utf8" },
  );
  assert.match(output, /guardrails passed/);
});

test("guardrail rejects an enterprise-answer branch in production code", () => {
  const fixture = mkdtempSync(join(tmpdir(), "zhiyu-guardrail-negative-"));
  for (const path of ["app", "lib", "db", "drizzle", "tests", "worker", "harness", ".github/workflows", "scripts"]) mkdirSync(join(fixture, path), { recursive: true });
  for (const path of ["AGENTS.md", "package.json", "scripts/deploy.sh", "harness/config.json", "harness/rag-evaluation-contract.json", "harness/acceptance-template.json", ".github/workflows/engineering-harness.yml"])
    cpSync(new URL(`../${path}`, import.meta.url), join(fixture, path));
  writeFileSync(join(fixture, "worker/index.ts"), "export default {};\n");
  writeFileSync(join(fixture, "app/probe.ts"), 'export function probe(question) { if (question.includes("北京")) return "固定答案"; }\n');
  execFileSync("git", ["init", "-q"], { cwd: fixture });
  execFileSync("git", ["add", "."], { cwd: fixture });
  assert.throws(() => execFileSync("node", [new URL("../scripts/check-engineering-guardrails.mjs", import.meta.url).pathname, fixture], { encoding: "utf8", stdio: "pipe" }), /business example controls production behavior/);
});

test("project charter covers the full delivery lifecycle and current phase boundary", () => {
  const charter = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  for (const invariant of [
    "禁止业务答案写死",
    "数据、清洗、版本与文件",
    "RAG与AI质量",
    "权限、安全与审计",
    "数据库、任务与Cloudflare",
    "测试与真实运行证据",
    "部署与 GitHub",
    "0→1与1→N迭代",
    "本期明确不做",
    "Harness 自动化入口",
    "前端设计与体验合同",
    "全域控制矩阵",
  ]) assert.match(charter, new RegExp(invariant.replace(/[→+]/g, "\\$&")));
});
