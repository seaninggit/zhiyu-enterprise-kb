import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("feedback and approval use one auditable station-and-email notification service", () => {
  const notifications = read("lib/notifications.ts");
  const feedback = read("app/api/documents/[id]/route.ts");
  const workflow = read("app/api/documents/route.ts");
  const closure = read("lib/governance-feedback.ts");
  const migration = read("drizzle/0023_notification_delivery_audit.sql");
  assert.match(notifications, /notification_deliveries/);
  assert.match(notifications, /EMAIL_SENT/);
  assert.match(notifications, /EMAIL_FAILED/);
  assert.match(notifications, /NON_DELIVERABLE_ACCOUNT/);
  assert.match(feedback, /notifyUser\([\s\S]*KNOWLEDGE_FEEDBACK/);
  assert.match(workflow, /resolvePublishedFeedback/);
  assert.match(closure, /GOVERNANCE_AUTO_RESOLVED/);
  assert.match(closure, /email: true/);
  assert.match(migration, /provider_message_id/);
  assert.doesNotMatch(read("app/page.tsx"), /action: "AUTO_RESOLVE_TASKS"/);
});

test("agent governance respects lifecycle scope, assigns owners and proposes high-risk changes", () => {
  const agent = read("lib/agent.ts");
  assert.match(agent, /documentListScope\(ctx, "d"\)/);
  assert.match(agent, /canReadDocument\(doc, ctx\)/);
  assert.match(agent, /assignee_user_id/);
  assert.match(agent, /AGENT_ARCHIVE_PROPOSED/);
  assert.match(agent, /待人工确认/);
  assert.doesNotMatch(agent, /UPDATE documents SET status = 'EXPIRED_VOID'/);
});
