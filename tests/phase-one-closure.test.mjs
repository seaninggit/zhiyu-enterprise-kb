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
  const [documents,routing,query,access] = await Promise.all([source("app/api/documents/route.ts"),source("lib/approval-routing.ts"),source("app/api/documents/query/route.ts"),source("lib/document-access.ts")]);
  assert.match(documents, /payload\.action === "submit" \? !await canEditDocument\(doc,ctx\)/);
  assert.match(documents, /approvalStep\?\.modifier_user_id/);
  assert.match(documents, /assertCurrentReviewer/);
  assert.match(routing, /SELF_APPROVAL_FORBIDDEN/);
  assert.match(query, /COALESCE\(d\.owner_user_id,d\.create_user_id\)=\?/);
  assert.match(access, /COALESCE\(\$\{alias\}\.owner_user_id,\$\{alias\}\.create_user_id\)=\?/);
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
  assert.match(ask, /已经明确的对象、地区、人群、部门、版本及其他适用范围/);
  assert.match(ask, /除非当前问题明确替换或否定/);
  assert.doesNotMatch(ask, /为什么\|怎么办\|时限\|材料\|步骤\|流程/);
});

test("file ingestion requires human confirmation for OCR and safe handling for empty or unsupported files", async () => {
  const [page, client] = await Promise.all([
    source("app/page.tsx"),
    source("lib/client-knowledge.ts"),
  ]);
  assert.match(client, /needsReview:true/);
  assert.match(client, /needsReview:result\.usedOcr/);
  assert.match(page, /file\.name && file\.size === 0/);
  assert.match(page, /extraction\.method === "NONE" && !hadManualContent/);
  assert.match(page, /const contentForSummary = String\(data\.get\("content"\)/);
  assert.doesNotMatch(page, /姓名、证件号码、签发机关和有效期限/);
});
