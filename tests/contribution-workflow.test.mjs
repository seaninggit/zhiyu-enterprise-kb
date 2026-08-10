import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("demo employee and department administrator share the product department", () => {
  const authz = read("lib/authz.ts");
  assert.match(authz, /DEPT_ADMIN:\s*\{ deptId: 2, code: "PRODUCT"/);
  assert.match(authz, /EMPLOYEE:\s*\{ deptId: 2, code: "PRODUCT"/);
  assert.match(authz, /DELETE FROM user_departments/);
  assert.match(authz, /UPDATE documents SET dept_id=\?/);
});

test("employees can trace their uploads, approvals and feedback", () => {
  const page = read("app/page.tsx");
  const documents = read("app/api/documents/route.ts");
  const uploads = read("app/api/uploads/route.ts");
  assert.match(page, /我的上传/);
  assert.match(page, /MY CONTRIBUTIONS/);
  assert.match(page, /收到待处理建议/);
  assert.match(page, /提交部门审核/);
  assert.match(page, /查看并补充/);
  assert.match(documents, /latest_approval_action/);
  assert.match(documents, /latest_approval_comment/);
  assert.match(documents, /open_feedback_count/);
  assert.match(documents, /knowledge:upload/);
  assert.match(uploads, /knowledge:upload/);
});
