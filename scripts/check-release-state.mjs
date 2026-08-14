#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harness = JSON.parse(readFileSync(resolve(root, "harness/config.json"), "utf8"));
const production = readFileSync(resolve(root, harness.release.config), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const failures = [];
for (const path of harness.release.forbiddenTrackedPaths || [])
  if (tracked.includes(path)) failures.push(`forbidden release artifact is tracked: ${path}`);
for (const prefix of harness.release.forbiddenTrackedPrefixes)
  if (tracked.some(path => path.startsWith(prefix))) failures.push(`forbidden release artifact is tracked: ${prefix}`);
for (const domain of harness.release.requiredDomains) if (!production.includes(domain)) failures.push(`production domain missing: ${domain}`);
for (const binding of harness.release.requiredBindings) if (!new RegExp(`binding["']?\\s*:\\s*["']${binding}["']`).test(production)) failures.push(`production binding missing: ${binding}`);
if (!production.includes('"triggers"') || !production.includes('"crons"')) failures.push("production Scheduled trigger is missing");
if (!production.includes('"observability"')) failures.push("production observability is missing");
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
console.log("Release state contract passed; this is configuration evidence, not deployment or production acceptance evidence.");
