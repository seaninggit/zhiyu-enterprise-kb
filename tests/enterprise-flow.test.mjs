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
  assert.match(page,/setDocuments\(\s*\(data\.data\?\.documents\s*\?\?\s*\[\]\)\.map\(normalizeDocument\),?\s*\)/);
  assert.doesNotMatch(page,/if \(data\.data\?\.documents\?\.length\) setDocuments/);
  assert.match(page,/PlatformView/);assert.match(page,/runSearch/);assert.match(page,/FAVORITE_TOGGLE/);
});

test("member onboarding supports enterprise single, bulk and directory flows",async()=>{
  const [admin,page,scim]=await Promise.all([readFile(new URL("../app/api/admin/users/route.ts",import.meta.url),"utf8"),readFile(new URL("../app/page.tsx",import.meta.url),"utf8"),readFile(new URL("../app/api/scim/v2/Users/route.ts",import.meta.url),"utf8")]);
  assert.match(admin,/Array\.isArray\(payload\.members\)/);assert.match(admin,/IMPORT_VALIDATION_ERROR/);assert.match(admin,/IMPORT_DUPLICATE/);assert.match(admin,/ACCOUNT_IMPORT/);assert.match(page,/添加并授权/);assert.match(page,/待首次登录/);assert.doesNotMatch(page,/预开通/);assert.match(scim,/SCIM_BEARER_TOKEN/);
  assert.match(admin,/findAssignableRole/);assert.doesNotMatch(admin,/\["SUPER_ADMIN","DEPT_ADMIN","EMPLOYEE"\]\.includes\(role\)/);
});

test("approval routing separates modifier, configured duty and assigned reviewer",async()=>{
  const [routing,documents,query,migration]=await Promise.all([readFile(new URL("../lib/approval-routing.ts",import.meta.url),"utf8"),readFile(new URL("../app/api/documents/route.ts",import.meta.url),"utf8"),readFile(new URL("../app/api/documents/query/route.ts",import.meta.url),"utf8"),readFile(new URL("../drizzle/0027_approval_routing.sql",import.meta.url),"utf8")]);
  for(const token of ["approval_duties","approval_instances","approval_steps","NO_\\$\\{duty\\}","SELF_APPROVAL_FORBIDDEN"])assert.match(`${routing}\n${migration}`,new RegExp(token));
  for(const token of ["BUSINESS_COMPLIANCE","DEPARTMENT_COMPLIANCE","DEPARTMENT_ENTERPRISE"])assert.match(routing,new RegExp(token));
  assert.match(documents,/createDepartmentApproval/);assert.match(documents,/assertCurrentReviewer/);assert.match(query,/approvalForMe/);assert.match(query,/assignee_user_id=\?/);
});
