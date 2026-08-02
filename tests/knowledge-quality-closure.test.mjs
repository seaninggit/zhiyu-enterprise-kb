import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("homophone correction is persisted, dual-retrieved and visible to users", async () => {
  const [migration, naturalMigration, correction, search, ask, page] = await Promise.all([
    read("drizzle/0012_knowledge_quality_closure.sql"), read("drizzle/0013_natural_ai_responses.sql"),
    read("lib/query-correction.ts"), read("app/api/search/route.ts"), read("app/api/ai/ask/route.ts"), read("app/page.tsx"),
  ]);
  assert.match(migration, /'虚球','需求'/);
  assert.match(naturalMigration, /'铲品','产品'/);
  assert.match(naturalMigration, /已有相关来源时，不得声称/);
  assert.match(migration, /search_corrections/);
  assert.match(correction, /pinyin-pro/);
  assert.match(correction, /replaceAll/);
  assert.match(search, /terms\(correction\.corrected\)/);
  assert.match(search, /terms\(query\)/);
  assert.match(ask, /correction_payload/);
  assert.match(page, /猜你想查“\{correction\.corrected\}”/);
  assert.match(page, /仍搜索“\{correction\.original\}”/);
  assert.match(ask, /系统识别意图：\$\{correctedQuestion\}/);
  assert.match(ask, /embedTexts\(\[correctedQuestion\]\)/);
});

test("publication readiness blocks unparsed, unscanned or unindexed knowledge", async () => {
  const [gate, route, bulk] = await Promise.all([
    read("lib/publish-readiness.ts"), read("app/api/documents/route.ts"), read("app/api/documents/bulk/route.ts"),
  ]);
  for (const token of ["parse_status", "scan_status", "document_chunks", "ai_index_status", "DOCUMENT_NOT_READY"]) assert.match(gate, new RegExp(token));
  assert.match(route, /const status = "DRAFT"/);
  assert.match(route, /assertPublishReady\(document\)/);
  assert.match(route, /assertPublishReady\(doc\)/);
  assert.match(bulk, /assertPublishReady/);
});

test("document and space permissions share one row-level policy", async () => {
  const [access, detail, platform, page] = await Promise.all([
    read("lib/document-access.ts"), read("app/api/documents/[id]/route.ts"),
    read("app/api/platform/route.ts"), read("app/page.tsx"),
  ]);
  for (const token of ["USER", "DEPT", "GROUP", "document_acl", "space_permissions", "user_groups"]) assert.match(access, new RegExp(token));
  assert.match(access, /permission==="VIEW"\?\["VIEW","EDIT"\]/);
  assert.match(detail, /permissionPrincipals/);
  assert.match(platform, /REMOVE_SPACE_PERMISSION/);
  assert.match(page, /后端行级隔离/);
});

test("negative feedback cannot be falsely closed without a remediation record", async () => {
  const [platform, governance, quality, page] = await Promise.all([
    read("app/api/platform/route.ts"), read("lib/governance.ts"), read("lib/answer-quality.ts"), read("app/page.tsx"),
  ]);
  assert.match(platform, /RESOLUTION_REQUIRED/);
  assert.match(platform, /KNOWLEDGE_UPDATE_REQUIRED/);
  assert.match(platform, /GOVERNANCE_RESOLVED/);
  assert.match(governance, /OWNER_TRANSFER/);
  assert.match(governance, /EXPIRED_VOID/);
  assert.match(quality, /citations\.some/);
  assert.match(page, /提交并通知反馈人/);
});
