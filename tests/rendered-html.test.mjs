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
  const route = await readFile(new URL("../app/api/documents/route.ts", import.meta.url), "utf8");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /auditLogs/);
  assert.match(route, /documentVersions/);
});
