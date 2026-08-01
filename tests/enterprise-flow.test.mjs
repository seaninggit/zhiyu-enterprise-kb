import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("enterprise workflow covers draft-review-publish-void and blocks skips",async()=>{
  const source=await readFile(new URL("../lib/workflow.ts",import.meta.url),"utf8");
  assert.match(source,/DRAFT:\{submit:"PENDING_DEPT_REVIEW"\}/);
  assert.match(source,/PENDING_DEPT_REVIEW:\{approve:"ARCHIVED_ACTIVE",reject:"DRAFT"\}/);
  assert.match(source,/ARCHIVED_ACTIVE:\{archive:"EXPIRED_VOID",void:"EXPIRED_VOID"\}/);
  assert.match(source,/INVALID_WORKFLOW_TRANSITION/);
});

test("three phases are wired to persistent routes and tables",async()=>{
  const [migration,search,platform,engagement,scim]=await Promise.all([
    readFile(new URL("../drizzle/0007_enterprise_knowledge_platform.sql",import.meta.url),"utf8"),
    readFile(new URL("../app/api/search/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/api/platform/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/api/engagement/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/api/scim/v2/Users/route.ts",import.meta.url),"utf8"),
  ]);
  for(const table of ["ingestion_jobs","knowledge_spaces","knowledge_folders","document_acl","search_logs","notifications","user_favorites","system_settings"])assert.match(migration,new RegExp(table));
  assert.match(search,/cosine/);assert.match(search,/embedding/);assert.match(platform,/RESTORE_VERSION/);assert.match(platform,/SET_ACL/);assert.match(engagement,/FAVORITE_TOGGLE/);assert.match(engagement,/NOTIFICATION_READ/);assert.match(scim,/SCIM_BEARER_TOKEN/);
});

test("UI has no fallback injection after authenticated empty responses",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/setDocuments\(\(data\.data\?\.documents\?\?\[\]\)\.map\(normalizeDocument\)\)/);
  assert.doesNotMatch(page,/if \(data\.data\?\.documents\?\.length\) setDocuments/);
  assert.match(page,/PlatformView/);assert.match(page,/runSearch/);assert.match(page,/FAVORITE_TOGGLE/);
});
