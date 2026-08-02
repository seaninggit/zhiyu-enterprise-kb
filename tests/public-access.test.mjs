import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("external access creates isolated employee sessions with normal business capabilities", async () => {
  const [migration, identity, auth, worker, conversations, ask, page, gateway] = await Promise.all([
    read("drizzle/0014_public_viewer_access.sql"),
    read("app/chatgpt-auth.ts"),
    read("lib/authz.ts"),
    read("worker/index.ts"),
    read("app/api/ai/conversations/route.ts"),
    read("app/api/ai/ask/route.ts"),
    read("app/page.tsx"),
    read("infrastructure/public-access/_worker.js"),
  ]);

  assert.match(migration, /visitor-shared@public\.zhiyu\.invalid/);
  assert.match(migration, /WHERE `code`='EMPLOYEE'/);
  assert.match(migration, /FROM `departments` WHERE `is_active`=1/);
  assert.match(identity, /zhiyu_public_session/);
  assert.match(identity, /visitor-\$\{suffix\}@\$\{PUBLIC_ACCESS_DOMAIN\}/);
  assert.match(auth, /identity_provider\) VALUES\(\?,\?,'ACTIVE','PUBLIC_ACCESS'\)/);
  assert.match(auth, /isPublicViewer:/);
  assert.doesNotMatch(worker, /PUBLIC_VIEWER_READ_ONLY/);
  assert.doesNotMatch(conversations, /公开访问不保存历史会话/);
  assert.doesNotMatch(ask, /persistConversation = !ctx\.isPublicViewer/);
  assert.match(page, /外部普通员工/);
  assert.match(page, /＋ 上传资料/);
  assert.match(gateway, /crypto\.randomUUID/);
  assert.match(gateway, /Max-Age=2592000/);
});
