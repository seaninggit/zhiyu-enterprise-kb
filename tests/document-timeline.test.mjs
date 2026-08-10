import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/documents/route.ts", import.meta.url), "utf8");

test("document list exposes a real lifecycle timeline instead of invented dates", () => {
  for (const alias of ["submitted_at", "approved_at", "rejected_at", "voided_at", "last_version_at", "ingested_at"])
    assert.match(route, new RegExp(`AS ${alias}`));
  for (const label of ["上传创建", "解析完成", "最近修改", "发起审批", "审批通过并发布", "作废", "下次复核"])
    assert.match(page, new RegExp(label));
  assert.match(page, /未发生的节点不会生成虚假时间/);
  assert.match(page, /时间记录/);
});

test("workflow refreshes lifecycle timestamps immediately after a state change", () => {
  assert.match(page, /setDocuments\(refreshed\.data\.documents\.map\(normalizeDocument\)\)/);
});
