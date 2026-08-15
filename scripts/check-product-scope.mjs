#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const config = JSON.parse(readFileSync(resolve(root, "harness/config.json"), "utf8"));
const product = readFileSync(resolve(root, "PRODUCT.md"), "utf8");
const charter = readFileSync(resolve(root, "AGENTS.md"), "utf8");
const failures = [];

const allowed = config.allowedCapabilities || [];
const excluded = config.excludedCapabilities || [];
for (const capability of ["controlled-agent-v1", "expiry-governance-agent"])
  if (!allowed.includes(capability)) failures.push(`missing allowed capability: ${capability}`);
if (!excluded.includes("high-risk-autonomous-agent-actions")) failures.push("high-risk autonomous Agent actions are not excluded");
const conflicts = allowed.filter(capability => excluded.includes(capability));
if (conflicts.length) failures.push(`capability conflict in both allowedCapabilities and excludedCapabilities: ${conflicts.join(", ")}`);
for (const phrase of ["制度到期治理", "高风险动作必须暂停", "模型不可用", "本地真实 UI、API 与 D1 验收"])
  if (!`${product}\n${charter}`.includes(phrase)) failures.push(`product boundary is missing: ${phrase}`);
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
console.log("Product scope passed (controlled Agent V1 allowed; high-risk autonomous actions excluded).");
