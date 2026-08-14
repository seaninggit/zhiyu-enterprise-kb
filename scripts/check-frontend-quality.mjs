#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const contract=JSON.parse(readFileSync(resolve(root,"harness/frontend-quality-contract.json"),"utf8"));
const css=readFileSync(resolve(root,"app/globals.css"),"utf8");const failures=[];
for(const token of contract.requiredTokens)if(!css.includes(`${token}:`))failures.push(`missing design token: ${token}`);
const sizes=[...css.matchAll(/font-size\s*:\s*([0-9.]+)px/g)].map(x=>Number(x[1]));
const metrics={fontBelow12:sizes.filter(x=>x<12).length,fontBelow8:sizes.filter(x=>x<8).length,hardcodedHexColors:(css.match(/#[0-9a-fA-F]{3,8}\b/g)||[]).length,zIndexDeclarations:(css.match(/z-index\s*:/g)||[]).length,importantDeclarations:(css.match(/!important/g)||[]).length};
for(const [name,ceiling] of Object.entries(contract.legacyDebtCeilings))if(metrics[name]>ceiling)failures.push(`${name} increased to ${metrics[name]} (legacy ceiling ${ceiling})`);
for(const state of ["focus-visible",":disabled","prefers-reduced-motion","@media"])if(!css.includes(state))failures.push(`missing frontend state support: ${state}`);
if(failures.length){console.error(failures.map(x=>`- ${x}`).join("\n"));process.exit(1);}
console.log(`Frontend quality contract passed; legacy debt frozen, not cleared: ${JSON.stringify(metrics)}.`);
