#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryFiles } from "./project-files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv[2] || "quick";
const config = JSON.parse(readFileSync(resolve(root, "harness/config.json"), "utf8"));
const stepNames = config.profiles[profile];
if (!stepNames) throw new Error(`Unknown harness profile: ${profile}`);

const commands = {
  guardrails: ["node", ["scripts/check-engineering-guardrails.mjs", "."]],
  "product-scope": ["node", ["scripts/check-product-scope.mjs"]],
  "agent-architecture": ["node", ["scripts/check-agent-architecture.mjs"]],
  "control-matrix": ["node", ["scripts/check-control-matrix.mjs"]],
  "frontend-quality": ["node", ["scripts/check-frontend-quality.mjs"]],
  "migration-contract": ["node", ["scripts/check-migrations.mjs"]],
  "rag-evaluation-contract": ["node", ["scripts/check-rag-evaluation-contract.mjs"]],
  maintainability: ["node", ["scripts/check-maintainability.mjs"]],
  lint: ["npm", ["run", "lint"]],
  build: ["npm", ["run", "build"]],
  tests: ["node", ["--test", "tests/*.test.mjs"], { shell: true }],
  "diff-check": ["git", ["diff", "--check"]],
  "release-state": ["node", ["scripts/check-release-state.mjs"]],
  "deploy-dry-run": ["npx", ["wrangler", "deploy", "--config", "wrangler.production.jsonc", "--dry-run", "--outdir", "outputs/deploy-dry-run"]]
};

const startedAt = new Date();
const report = { schemaVersion: 2, profile, startedAt: startedAt.toISOString(), commit: "", branch: "", worktreeFingerprint: "", worktreeStatus: [], steps: [] };
report.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
report.branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
report.worktreeStatus = execFileSync("git", ["-c", "core.quotepath=false", "status", "--short"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const fingerprint = createHash("sha256");
for (const file of repositoryFiles(root).sort()) {
  fingerprint.update(file).update("\0").update(readFileSync(resolve(root, file))).update("\0");
}
report.worktreeFingerprint = fingerprint.digest("hex");

let failed = false;
for (const name of stepNames) {
  const [command, args, options = {}] = commands[name];
  const start = Date.now();
  process.stdout.write(`\n[harness] ${name}\n`);
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit", ...options });
  const step = { name, status: result.status === 0 ? "passed" : "failed", durationMs: Date.now() - start };
  report.steps.push(step);
  if (result.status !== 0) { failed = true; break; }
}

report.finishedAt = new Date().toISOString();
report.status = failed ? "failed" : "passed";
const reportDir = resolve(root, "harness/reports");
mkdirSync(reportDir, { recursive: true });
const reportPath = resolve(reportDir, `${startedAt.toISOString().replaceAll(":", "-")}-${profile}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n[harness] ${report.status}; evidence: ${reportPath}`);
process.exit(failed ? 1 : 0);
