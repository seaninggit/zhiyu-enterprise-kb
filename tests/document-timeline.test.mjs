import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/documents/route.ts", import.meta.url), "utf8");

test("document workflow history uses real versions and approval batches", () => {
  for (const alias of ["submitted_at", "approved_at", "rejected_at", "voided_at", "last_version_at", "ingested_at"])
    assert.match(route, new RegExp(`AS ${alias}`));
  for (const label of ["版本变更记录", "审批批次", "当前状态", "当前版本", "最近变更", "下次复核"])
    assert.match(page, new RegExp(label));
  assert.match(page, /按版本和审批批次记录资料的实际流转过程/);
  assert.doesNotMatch(page, /<h3>已发生操作<\/h3>/);
  assert.match(page, /时间记录/);
});

test("workflow refreshes lifecycle timestamps immediately after a state change", () => {
  assert.match(page, /setDocuments\(refreshed\.data\.documents\.map\(normalizeDocument\)\)/);
});
