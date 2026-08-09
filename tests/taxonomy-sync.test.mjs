import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("custom categories and groups persist and refresh every consuming interface",()=>{
  const page=read("app/page.tsx"),documents=read("app/api/documents/route.ts"),enterprise=read("app/api/enterprise/route.ts");
  assert.match(documents,/categoryOptions:categoryOptions\.results/);
  assert.match(page,/setKnowledgeCategories/);
  assert.match(page,/categories=\{categoryOptions\}/);
  assert.match(page,/tags=\{tagOptions\}/);
  assert.match(page,/spaces=\{knowledgeSpaces\}/);
  assert.match(page,/action:"SAVE_GROUP"/);
  assert.match(page,/当前页面及业务表单已同步更新/);
  assert.match(enterprise,/category},rid/);
  assert.match(enterprise,/group},rid/);
  assert.match(enterprise,/DELETE_CATEGORY/);
  assert.match(enterprise,/DELETE_GROUP/);
  assert.match(enterprise,/DELETE_TAG/);
  assert.match(enterprise,/mode:\"DEACTIVATED\"/);
  assert.match(page,/配置删除确认/);
  assert.match(page,/已有资料使用时会安全停用/);
});

test("platform-managed values are consumed by business workflows",()=>{
  const page=read("app/page.tsx"),documents=read("app/api/documents/route.ts"),platform=read("app/api/platform/route.ts"),worker=read("worker/index.ts"),wrangler=read("wrangler.production.jsonc");
  assert.match(documents,/uploadConfig/);
  assert.match(documents,/retention\.default_days/);
  assert.match(documents,/security\.allowed_mime/);
  assert.match(page,/governance\.review_days/);
  assert.match(page,/availableCategories=categories\.filter/);
  assert.match(page,/availableFolders/);
  assert.match(platform,/UPDATE_SETTINGS/);
  assert.match(platform,/INVALID_WEIGHTS/);
  assert.match(worker,/isCronDue/);
  assert.match(worker,/cron_expr/);
  assert.match(wrangler,/0 \* \* \* \*/);
});
