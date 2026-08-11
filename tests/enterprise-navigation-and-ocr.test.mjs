import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");

test("navigation is role-configurable and management duties are separated",()=>{
  const migration=read("drizzle/0026_configurable_navigation.sql"),page=read("app/page.tsx"),roles=read("app/api/admin/roles/route.ts");
  for(const token of ["page:library","page:contributions","page:approval_pending","page:document_admin","page:feedback_governance","page:lifecycle_governance"])assert.match(migration,new RegExp(token));
  assert.match(page,/hasPerm\("page:approval_pending"\)/);assert.match(page,/feedbackGovernance/);assert.match(page,/lifecycleGovernance/);assert.match(roles,/expandPermissionTree/);
});

test("OCR enhances images and blocks low-confidence text for human review",()=>{
  const client=read("lib/client-knowledge.ts"),page=read("app/page.tsx");
  assert.match(client,/preprocessImage/);assert.match(client,/normalizeOcrText/);assert.match(client,/needsReview:confidence<82/);assert.match(page,/请先校对“正文 \/ 解析补充”/);
});

test("external employees are not enrolled into every department",()=>{
  const auth=read("lib/authz.ts"),documents=read("app/api/documents/route.ts");
  assert.doesNotMatch(auth,/u CROSS JOIN departments d WHERE u\.email=\? AND d\.is_active=1/);
  assert.match(auth,/d\.code='GENERAL'/);assert.match(documents,/CATEGORY_FORBIDDEN/);
});

test("employee and administrator lists support scale controls",()=>{
  const page=read("app/page.tsx"),query=read("app/api/documents/query/route.ts");
  for(const token of ["搜索我的上传","最近更新优先","全部状态","上一页","搜索管理资料","全部分类","approvalHistory","全部审批动作"])assert.match(page,new RegExp(token));
  for(const token of ["pageSize","OFFSET","approvalAction","deptId","uploader","lifecycle"])assert.match(query,new RegExp(token));
});

test("department scope never grants department administrator capability",()=>{
  const auth=read("lib/authz.ts"),access=read("lib/document-access.ts"),detail=read("app/api/documents/[id]/route.ts");
  assert.doesNotMatch(auth,/hasScope\(ctx, "department"\) && ctx\.deptIds\.includes/);
  assert.match(auth,/hasPermission\(ctx,"governance:admin"\)/);assert.match(access,/ctx\.role==="DEPT_ADMIN"/);
  assert.match(detail,/const privileged=manager\|\|responsible/);assert.match(detail,/version<=\?/);assert.match(detail,/approvals=privileged/);
});

test("document responsibility is transferred instead of administrator editing",()=>{
  const access=read("lib/document-access.ts"),detail=read("app/api/documents/[id]/route.ts"),page=read("app/page.tsx");
  assert.match(access,/ownerId=Number\(doc\.owner_user_id\|\|doc\.create_user_id\)/);
  assert.match(detail,/TRANSFER_OWNER/);assert.match(detail,/OWNER_TRANSFER/);assert.match(detail,/SUCCESSOR_NOT_ELIGIBLE/);
  assert.doesNotMatch(detail,/ADMIN_OVERRIDE_EDIT/);assert.doesNotMatch(page,/代为修订原因/);
  assert.match(page,/责任转交/);assert.match(page,/原上传人、历史版本和审批记录保持不变/);
});

test("identity documents are forced into confidential traced department storage",()=>{
  const route=read("app/api/documents/route.ts"),page=read("app/page.tsx");
  assert.match(route,/sensitiveIdentity/);assert.match(route,/"CONFIDENTIAL"/);assert.match(route,/effectiveShareScope/);assert.match(route,/watermark_enabled/);
  assert.match(page,/需要人工校对后再提交/);assert.match(page,/身份资料将自动设为机密/);
});
