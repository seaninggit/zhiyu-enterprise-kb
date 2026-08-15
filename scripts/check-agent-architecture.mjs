#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const failures = [];
const required = ["lib/governance-agent.ts", "drizzle/0037_controlled_governance_agent.sql"];
for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`controlled Agent architecture missing: ${path}`);
if (existsSync(resolve(root, "lib/governance-agent.ts"))) {
  const agent = readFileSync(resolve(root, "lib/governance-agent.ts"), "utf8");
  for (const marker of ["agent_workflow_runs", "agent_workflow_steps", "agent_action_confirmations", "WAITING_CONFIRMATION", "toolPolicy"])
    if (!agent.includes(marker)) failures.push(`controlled Agent runtime missing marker: ${marker}`);
  if (/yangshanpm@|onboarding@resend\.dev/.test(agent)) failures.push("controlled Agent contains a fixed recipient or sender");
  if (/UPDATE\s+documents\s+SET\s+status\s*=\s*['\"](?:EXPIRED_VOID|ARCHIVED_ACTIVE)/i.test(agent)) failures.push("controlled Agent directly mutates a high-risk document status");
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
console.log("Controlled Agent architecture guard passed.");
