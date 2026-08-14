#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "harness/config.json"), "utf8")).maintainability;
const files = execFileSync("git", ["ls-files", "app", "lib", "worker", "db"], { cwd: root, encoding: "utf8" })
  .trim().split("\n").filter(file => /\.(?:ts|tsx|js|mjs)$/.test(file));
const failures = [];
const largest = [];
for (const file of files) {
  const lines = readFileSync(resolve(root, file), "utf8").split("\n").length;
  largest.push({ file, lines });
  const limit = config.grandfatheredMaxLines[file] || config.defaultMaxLines;
  if (lines > limit) failures.push(`${file} has ${lines} lines (budget ${limit}); extract a cohesive module instead of expanding it`);
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
largest.sort((a, b) => b.lines - a.lines);
console.log(`Maintainability budget passed (${files.length} production files; largest: ${largest.slice(0, 3).map(item => `${item.file}=${item.lines}`).join(", ")}).`);
