#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(resolve(root, "harness/rag-evaluation-contract.json"), "utf8"));
const failures = [];
for (const category of ["multi_turn_scope_change", "version_isolation", "no_evidence", "permission_denial", "model_degradation", "embedding_degradation"])
  if (!contract.requiredCategories.includes(category)) failures.push(`missing RAG category: ${category}`);
for (const metric of ["recall_at_k", "citation_precision", "claim_support_rate", "refusal_accuracy", "permission_leakage_rate", "critical_number_error_rate"])
  if (!contract.requiredMetrics.includes(metric)) failures.push(`missing RAG metric: ${metric}`);
if (contract.blockingGates.permission_leakage_rate?.max !== 0) failures.push("permission leakage must be a zero-tolerance release gate");
if (contract.blockingGates.critical_number_error_rate?.max !== 0) failures.push("critical number errors must be a zero-tolerance release gate");
const raw = JSON.stringify(contract);
if (/expectedAnswer|expected_answer|固定答案/.test(raw)) failures.push("evaluation contract must not encode enterprise answers");
if (failures.length) { console.error(failures.map(item => `- ${item}`).join("\n")); process.exit(1); }
console.log("RAG evaluation contract passed.");
