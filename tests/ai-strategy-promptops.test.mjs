import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root=new URL("..",import.meta.url).pathname;
const read=path=>readFileSync(join(root,path),"utf8");
function sqlite(database,sql){const result=spawnSync("sqlite3",[database],{input:sql,encoding:"utf8"});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}

test("AI strategy center exposes governed PromptOps capabilities",()=>{
  const api=read("app/api/enterprise/route.ts"),page=read("app/page.tsx"),migration=read("drizzle/0025_ai_strategy_promptops.sql"),rag=read("lib/rag.ts");
  for(const action of ["SAVE_PROMPT","RUN_EVAL","SUBMIT_PROMPT","PUBLISH_PROMPT","ROLLBACK_PROMPT","TEST_PROMPT"])assert.match(api,new RegExp(action));
  for(const feature of ["AI 策略与评测","回答策略","版本发布","测试评测","运行监控","查看最终组装 Prompt"])assert.match(page,new RegExp(feature));
  for(const field of ["strategy_json","eval_score","approved_by","prompt_release_logs","prompt.release_min_score"])assert.match(migration,new RegExp(field.replace(".","\\.")));
  assert.match(rag,/status='PUBLISHED'/);
});

test("Prompt lifecycle persists evaluation, approval, publication and rollback audit",()=>{
  const directory=mkdtempSync(join(tmpdir(),"zhiyu-promptops-")),database=join(directory,"knowledge.db");
  for(const migration of readdirSync(join(root,"drizzle")).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort())sqlite(database,read(join("drizzle",migration)));
  const result=sqlite(database,`
    INSERT INTO prompt_templates(name,code,version,status,instructions,strategy_json,change_note,eval_score,evaluated_at,created_by)
    VALUES('企业知识问答','enterprise_rag',99,'TESTING','测试指令','{}','集成测试',92,CURRENT_TIMESTAMP,9001);
    UPDATE prompt_templates SET status='PENDING_APPROVAL',submitted_at=CURRENT_TIMESTAMP WHERE version=99 AND eval_score>=85;
    UPDATE prompt_templates SET status='RETIRED' WHERE code='enterprise_rag' AND status='PUBLISHED';
    UPDATE prompt_templates SET status='PUBLISHED',approved_by=9001,approved_at=CURRENT_TIMESTAMP,published_at=CURRENT_TIMESTAMP WHERE version=99 AND status='PENDING_APPROVAL';
    INSERT INTO prompt_release_logs(prompt_id,action,eval_score,actor_user_id,detail) SELECT id,'PUBLISHED',eval_score,9001,'测试发布' FROM prompt_templates WHERE version=99;
    SELECT status||'|'||CAST(eval_score AS INTEGER)||'|'||approved_by FROM prompt_templates WHERE version=99;
    SELECT action||'|'||CAST(eval_score AS INTEGER) FROM prompt_release_logs WHERE prompt_id=(SELECT id FROM prompt_templates WHERE version=99);
    PRAGMA foreign_key_check;
  `).split("\n");
  assert.deepEqual(result,["PUBLISHED|92|9001","PUBLISHED|92"]);
});
