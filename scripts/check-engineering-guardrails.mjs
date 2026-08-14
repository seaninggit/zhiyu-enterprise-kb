#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || process.cwd());
const failures = [];
const required = [
  "AGENTS.md", "drizzle", "tests", "app", "lib", "worker/index.ts",
  "harness/config.json", "harness/rag-evaluation-contract.json", "harness/acceptance-template.json",
  "harness/control-matrix.json", "harness/frontend-quality-contract.json",
  ".github/workflows/engineering-harness.yml",
];
for (const item of required) if (!existsSync(resolve(root, item))) failures.push(`missing required project path: ${item}`);

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
for (const path of tracked) {
  if (path === ".dev.vars" || path.startsWith(".local-backups/") || path.startsWith("demo-files/")) failures.push(`excluded local artifact is tracked: ${path}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const command of ["harness:quick", "harness:ci", "harness:release", "harness:acceptance"])
  if (!packageJson.scripts?.[command]) failures.push(`package.json is missing harness command: ${command}`);

const deployScript = existsSync(resolve(root, "scripts/deploy.sh")) ? readFileSync(resolve(root, "scripts/deploy.sh"), "utf8") : "";
if (/cd \/Users\//.test(deployScript)) failures.push("deployment script contains a workstation-specific absolute path");
if (!deployScript.includes("ZHIYU_DEPLOY_CONFIRM")) failures.push("deployment script lacks explicit production confirmation");
if (!deployScript.includes("harness:release")) failures.push("deployment script bypasses the release harness");
if (!existsSync(resolve(root, "scripts/check-maintainability.mjs"))) failures.push("maintainability budget check is missing");
if (!existsSync(resolve(root, "scripts/check-control-matrix.mjs"))) failures.push("control matrix check is missing");
if (!existsSync(resolve(root, "scripts/check-frontend-quality.mjs"))) failures.push("frontend quality check is missing");

const productionFiles = tracked.filter(path => /^(app|lib|worker|db)\/.+\.(ts|tsx|js|mjs)$/.test(path));
const businessExamples = "北京|上海|广州|深圳|材料|报销|差旅";
const inputName = "question|query|title|correctedQuestion|retrievalIntent";
const directBusinessBranch = new RegExp(
  `(?:${inputName})[^\\n;]{0,100}(?:===|==|includes\\(|startsWith\\(|endsWith\\(|match\\(|test\\()[^\\n;]{0,100}(?:${businessExamples})|(?:${businessExamples})[^\\n;]{0,100}(?:===|==|includes\\(|startsWith\\(|endsWith\\(|match\\(|test\\()[^\\n;]{0,100}(?:${inputName})`,
  "i",
);
for (const path of productionFiles) {
  const text = readFileSync(resolve(root, path), "utf8");
  if (directBusinessBranch.test(text)) failures.push(`business example controls production behavior: ${path}`);
}

const agentInstructions = existsSync(resolve(root, "AGENTS.md")) ? readFileSync(resolve(root, "AGENTS.md"), "utf8") : "";
for (const phrase of ["禁止业务答案写死", "真实运行证据", "部署与 GitHub", "本期明确不做", "Harness 自动化入口", "前端设计与体验合同", "全域控制矩阵"]) {
  if (!agentInstructions.includes(phrase)) failures.push(`AGENTS.md is missing invariant: ${phrase}`);
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Zhiyu repository guardrails passed (${tracked.length} tracked files checked).`);
