import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public viewer is read-only, department-scoped and has private ephemeral AI sessions", async () => {
  const [migration, auth, worker, conversations, ask, page] = await Promise.all([
    read("drizzle/0014_public_viewer_access.sql"),
    read("lib/authz.ts"),
    read("worker/index.ts"),
    read("app/api/ai/conversations/route.ts"),
    read("app/api/ai/ask/route.ts"),
    read("app/page.tsx"),
  ]);

  assert.match(migration, /public\.viewer@zhiyu\.invalid/);
  assert.match(migration, /WHERE `code`='EMPLOYEE'/);
  assert.match(migration, /FROM `departments` WHERE `is_active`=1/);
  assert.match(auth, /isPublicViewer:/);
  assert.match(worker, /PUBLIC_VIEWER_READ_ONLY/);
  assert.match(worker, /url\.pathname === "\/api\/search" \|\| url\.pathname === "\/api\/ai\/ask"/);
  assert.match(conversations, /公开访问不保存历史会话/);
  assert.match(ask, /persistConversation = !ctx\.isPublicViewer/);
  assert.match(page, /公开只读 · 不保存历史/);
  assert.match(page, /publicViewer=\{Boolean\(currentUser\.isPublicViewer\)\}/);
});
