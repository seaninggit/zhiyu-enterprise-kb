import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("enterprise knowledge hub metadata and product copy are configured", async () => {
  const [page, layout, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /知域 · 企业知识库/);
  assert.match(page, /知识维护工作台/);
  assert.match(page, /上传并生成记录/);
  assert.match(page, /下载原件/);
  assert.match(page, /审计日志/);
  assert.doesNotMatch(page, /SkeletonPreview/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.equal(JSON.parse(hosting).r2, "KNOWLEDGE_FILES");
});

test("knowledge API implements lifecycle operations", async () => {
  const [route, detailRoute, authz, schema] = await Promise.all([
    readFile(new URL("../app/api/documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/documents/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/authz.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /requireApiUser/);
  assert.match(route, /d\.dept_id IN/);
  assert.match(detailRoute, /ROW_ACCESS_DENIED/);
  assert.match(detailRoute, /export async function DELETE/);
  assert.match(authz, /SUPER_ADMIN/);
  assert.match(authz, /DEPT_ADMIN/);
  assert.match(authz, /EMPLOYEE/);
  assert.match(schema, /documents_status_check/);
  assert.match(schema, /documentVisibility/);
  assert.match(schema, /userDepartments/);
});
