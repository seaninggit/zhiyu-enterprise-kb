#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const file = process.argv[2];
if (!file) { console.error("Usage: npm run harness:acceptance -- <evidence.json>"); process.exit(2); }
const report = JSON.parse(readFileSync(resolve(file), "utf8"));
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const matrix=JSON.parse(readFileSync(resolve(root,"harness/control-matrix.json"),"utf8"));
const required=Object.values(matrix.domains).flat().filter(control=>["runtime","production"].includes(control.evidence)).map(control=>control.id);
const checks = new Map((report.checks || []).map(item => [item.id, item]));
const failures = [];
if (!/^[0-9a-f]{7,40}$/i.test(report.commit || "")) failures.push("tested commit is missing or invalid");
if (!report.environment || !report.createdAt) failures.push("environment and createdAt are required");
for (const id of required) {
  const check = checks.get(id);
  if (!check) failures.push(`missing acceptance check: ${id}`);
  else if (check.status !== "passed") failures.push(`${id} is not passed`);
  else if (!Array.isArray(check.evidence) || check.evidence.length === 0) failures.push(`${id} has no runtime evidence`);
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
console.log(`Acceptance evidence passed for ${report.commit}.`);
