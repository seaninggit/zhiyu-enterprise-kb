import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const quality=fs.readFileSync(new URL("../lib/answer-quality.ts",import.meta.url),"utf8");
const rag=fs.readFileSync(new URL("../lib/rag.ts",import.meta.url),"utf8");
const route=fs.readFileSync(new URL("../app/api/ai/ask/route.ts",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../drizzle/0024_knowledge_first_answer_prompt.sql",import.meta.url),"utf8");

test("knowledge answer separates grounded company facts from general advice",()=>{
  for(const text of [rag,migration]){
    assert.match(text,/公司知识依据/);
    assert.match(text,/通用建议/);
    assert.match(text,/待确认事项/);
    assert.match(text,/不得把通用建议写成公司事实/);
  }
});

test("used citations are normalized before persistence and response",()=>{
  assert.match(quality,/normalizeUsedCitations/);
  assert.match(quality,/numberMap/);
  assert.match(route,/normalizeUsedCitations\(answer,sources\)/);
  const normalizationPosition=route.indexOf("normalizeUsedCitations(answer,sources)");
  assert.ok(normalizationPosition>0);
  assert.ok(route.indexOf("INSERT INTO ai_query_logs",normalizationPosition)>normalizationPosition);
});
