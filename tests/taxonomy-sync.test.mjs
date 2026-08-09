import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("custom categories and groups persist and refresh every consuming interface",()=>{
  const page=read("app/page.tsx"),documents=read("app/api/documents/route.ts"),enterprise=read("app/api/enterprise/route.ts");
  assert.match(documents,/categoryOptions:categoryOptions\.results/);
  assert.match(page,/setKnowledgeCategories/);
  assert.match(page,/categories=\{knowledgeCategories\}/);
  assert.match(page,/action:"SAVE_GROUP"/);
  assert.match(page,/当前页面及业务表单已同步更新/);
  assert.match(enterprise,/category},rid/);
  assert.match(enterprise,/group},rid/);
});
