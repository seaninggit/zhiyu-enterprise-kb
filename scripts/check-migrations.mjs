#!/usr/bin/env node
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = readdirSync(resolve(root, "drizzle")).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
const failures = [];
const numbers = migrations.map(name => Number(name.slice(0, 4)));
for (let index = 1; index < numbers.length; index++) {
  if (numbers[index] !== numbers[index - 1] + 1) failures.push(`migration sequence gap or duplicate near ${migrations[index]}`);
}
const database = join(mkdtempSync(join(tmpdir(), "zhiyu-migrations-")), "schema.sqlite");
for (const migration of migrations) {
  const result = spawnSync("sqlite3", [database], { input: readFileSync(resolve(root, "drizzle", migration), "utf8"), encoding: "utf8" });
  if (result.status !== 0) { failures.push(`${migration}: ${result.stderr.trim()}`); break; }
}
if (!failures.length) {
  const required = ["documents", "document_versions", "document_chunks", "approval_records", "audit_logs", "notification_deliveries", "scheduled_task_runs"];
  const query = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${required.map(() => "?").join(",")}) ORDER BY name;`;
  const result = spawnSync("sqlite3", [database, "-cmd", `.parameter init`, ...required.flatMap((name, index) => ["-cmd", `.parameter set ?${index + 1} ${name}`]), query], { encoding: "utf8" });
  const found = new Set(result.stdout.trim().split("\n").filter(Boolean));
  for (const table of required) if (!found.has(table)) failures.push(`required table missing after migrations: ${table}`);
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
console.log(`Migration contract passed (${migrations.length} ordered migrations applied to an isolated D1-compatible SQLite database).`);
