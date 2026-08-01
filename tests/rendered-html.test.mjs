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
  assert.match(page, /附件已安全保存/);
  assert.match(page, /首次上传/);
  assert.doesNotMatch(page, /完成内容复核与格式修订/);
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

test("AI knowledge endpoint is permission-aware and grounded", async () => {
  const [route, rag, schema] = await Promise.all([
    readFile(new URL("../app/api/ai/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/rag.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiUser/);
  assert.match(route, /ARCHIVED_ACTIVE/);
  assert.match(route, /d\.dept_id IN/);
  assert.match(route, /ai_query_logs/);
  assert.match(rag, /v1\/embeddings/);
  assert.match(rag, /v1\/responses/);
  assert.match(rag, /没有足够依据/);
  assert.match(schema, /documentChunks/);
  assert.match(schema, /aiQueryLogs/);
  assert.match(route, /queryLogId/);
});

test("knowledge consumption actions are persisted", async () => {
  const [route, schema, page] = await Promise.all([
    readFile(new URL("../app/api/engagement/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /SUBSCRIBE/);
  assert.match(route, /AI_HELPFUL/);
  assert.match(route, /ROW_ACCESS_DENIED/);
  assert.match(schema, /knowledgeSubscriptions/);
  assert.match(page, /引用来源/);
  assert.match(page, /知识问答工作台/);
  assert.doesNotMatch(route, /START_WORKFLOW/);
  assert.doesNotMatch(schema, /workflowRequests/);
  assert.doesNotMatch(page, /发起差旅申请/);
});

test("enterprise demo corpus covers five departments and lifecycle states", async () => {
  const seed = await readFile(new URL("../drizzle/0004_enterprise_demo_corpus.sql", import.meta.url), "utf8");
  const ids = [...seed.matchAll(/\(91\d{2},\d,900\d/g)];
  assert.equal(ids.length, 20);
  for (const title of ["信息安全事件报告与处置规范", "产品需求评审与准入规范", "新员工入职与首月融入指南", "客户分级与经营管理办法", "员工费用报销管理制度"]) assert.match(seed, new RegExp(title));
  for (const status of ["ARCHIVED_ACTIVE", "PENDING_DEPT_REVIEW", "DRAFT", "EXPIRED_VOID"]) assert.match(seed, new RegExp(status));
  assert.match(seed, /document_chunks/);
});

test("AI workbench persists conversations and closes feedback loop", async () => {
  const [ask, conversations, engagement, schema, page, styles] = await Promise.all([
    readFile(new URL("../app/api/ai/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/conversations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/engagement/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(ask, /conversationId/);
  assert.match(ask, /ai_messages/);
  assert.match(conversations, /export async function DELETE/);
  assert.match(engagement, /knowledge_governance_tasks/);
  assert.match(schema, /aiConversations/);
  assert.match(schema, /knowledgeGovernanceTasks/);
  assert.match(page, /历史会话/);
  assert.match(page, /答案不准确/);
  assert.match(page, /提交改进/);
  assert.match(page, /document\.body\.style\.overflow = "hidden"/);
  assert.match(styles, /\.ai-workspace \{ min-width:0; min-height:0; overflow:hidden/);
  assert.match(styles, /\.ai-conversation \{[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/);
  assert.match(styles, /Airier enterprise palette/);
  assert.match(styles, /background:linear-gradient\(180deg,#f2f8fc/);
  assert.match(styles, /--sidebar-width:clamp\(196px,15\.5vw,224px\)/);
  assert.match(styles, /\.sidebar-collapsed \{ --sidebar-width:76px/);
  assert.match(page, /收起功能栏/);
  assert.match(page, /回答已生成/);
  assert.match(page, /搜制度 · 查流程 · 找负责人/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /@keyframes ai-breathe/);
});

test("enterprise identity lifecycle requires explicit authorization", async () => {
  const [authz, admin, schema, migration, page] = await Promise.all([
    readFile(new URL("../lib/authz.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_enterprise_identity_lifecycle.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(authz, /'PENDING'/);
  assert.match(authz, /ACCOUNT_PENDING/);
  assert.match(authz, /ACCOUNT_DISABLED/);
  assert.doesNotMatch(authz, /isFirst/);
  assert.match(admin, /requireSuper/);
  assert.match(admin, /OFFBOARDED/);
  assert.match(admin, /不能在当前会话中修改自己的权限或状态/);
  assert.match(schema, /identityProvider/);
  assert.match(migration, /last_login_time/);
  assert.match(page, /账号与权限/);
  assert.match(page, /离职权限已回收/);
  assert.doesNotMatch(page, /下午好，李然/);
});
