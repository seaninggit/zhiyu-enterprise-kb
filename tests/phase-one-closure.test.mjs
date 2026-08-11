import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("assigned reviewers can see routed documents without content edit authority", async () => {
  const access = await source("lib/document-access.ts");
  assert.match(access, /approval_instances ai JOIN approval_steps aps/);
  assert.match(access, /aps\.assignee_user_id=\?/);
  assert.match(access, /if\(assigned\)return true/);
  assert.match(access, /if\(!hasPermission\(ctx,"knowledge:edit"\)\)return false/);
});

test("submission is owner or explicit EDIT ACL controlled and approval actors remain distinct", async () => {
  const [documents,routing] = await Promise.all([source("app/api/documents/route.ts"),source("lib/approval-routing.ts")]);
  assert.match(documents, /payload\.action === "submit" \? !await canEditDocument\(doc,ctx\)/);
  assert.match(documents, /approvalStep\?\.modifier_user_id/);
  assert.match(documents, /assertCurrentReviewer/);
  assert.match(routing, /SELF_APPROVAL_FORBIDDEN/);
});

test("member lifecycle blocks orphaning and performs explicit auditable bulk transfer", async () => {
  const [accounts, governance] = await Promise.all([
    source("app/api/admin/users/route.ts"),
    source("lib/governance.ts"),
  ]);
  for (const token of ["RESPONSIBILITY_TRANSFER_REQUIRED", "SUCCESSOR_NOT_ELIGIBLE", "TRANSFER_REASON_REQUIRED", "OWNER_TRANSFER"])
    assert.match(accounts, new RegExp(token));
  assert.match(accounts, /p\.code='knowledge:edit'/);
  assert.match(accounts, /UPDATE knowledge_governance_tasks SET assignee_user_id=\?/);
  assert.doesNotMatch(governance, /ORDER BY ud\.is_dept_admin DESC/);
  assert.match(governance, /ownerTransferRequired/);
});

test("feedback closes only after its revised document reaches approval publication", async () => {
  const feedback = await source("lib/governance-feedback.ts");
  assert.match(feedback, /type='DOCUMENT_FEEDBACK'/);
  assert.match(feedback, /workflow_stage='WAITING_APPROVAL'/);
  assert.match(feedback, /document\.status !== "ARCHIVED_ACTIVE"/);
  assert.match(feedback, /GOVERNANCE_RESOLVED/);
});

test("approval has one visible navigation entry with three business tabs", async () => {
  const page = await source("app/page.tsx");
  assert.equal((page.match(/>我的审批 /g) || []).length, 1);
  for (const label of ["待我处理", "我发起的", "已处理"])
    assert.match(page, new RegExp(label));
});

test("contextual questions re-retrieve globally and degrade without inventing regional policy", async () => {
  const ask = await source("app/api/ai/ask/route.ts");
  assert.match(ask, /const chunkScope=scope/);
  assert.doesNotMatch(ask, /const chunkScope=useContextFilter/);
  assert.match(ask, /不能把通用规定推定为特定地区/);
  assert.match(ask, /contextDocumentIds\.has\(Number\(row\.document_id\)\)/);
});
