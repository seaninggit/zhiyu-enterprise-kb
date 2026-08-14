#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const matrix=JSON.parse(readFileSync(resolve(root,"harness/control-matrix.json"),"utf8"));
const required=["product-scope","workflow-integrity","frontend-ux","api-contract","data-lifecycle","permissions-security","privacy-compliance","ai-rag-quality","file-ingestion","background-jobs","notifications-integrations","performance-capacity","reliability-recovery","observability-operations","supply-chain-secrets","cost-governance","delivery-release","maintainability","documentation-handoff"];
const failures=[];const ids=new Set();
for(const domain of required){const controls=matrix.domains?.[domain];if(!Array.isArray(controls)||!controls.length){failures.push(`missing control domain: ${domain}`);continue;}for(const control of controls){if(!control.id||!control.owner||!control.gate||!control.evidence)failures.push(`incomplete control in ${domain}`);if(ids.has(control.id))failures.push(`duplicate control id: ${control.id}`);ids.add(control.id);}}
if(failures.length){console.error(failures.map(x=>`- ${x}`).join("\n"));process.exit(1);}
console.log(`Control matrix passed (${required.length} domains, ${ids.size} controls).`);
