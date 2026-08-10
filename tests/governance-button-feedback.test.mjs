import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const platform = fs.readFileSync(new URL("../app/api/platform/route.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("governance task claim has visible progress, local state refresh and audit", () => {
  assert.match(page, /startingTaskId/);
  assert.match(page, /正在认领\.\.\./);
  assert.match(page, /onTaskStarted\(task\.id\)/);
  assert.doesNotMatch(
    page.match(/async function startGovernanceTask[\s\S]*?\n  }/)?.[0] ?? "",
    /window\.location\.reload/,
  );
  assert.match(platform, /GOVERNANCE_STARTED/);
});

test("all buttons expose press, focus, disabled and async loading feedback", () => {
  assert.match(styles, /button:not\(:disabled\):active/);
  assert.match(styles, /button:focus-visible/);
  assert.match(styles, /button:disabled/);
  assert.match(styles, /\.button-spinner/);
  assert.match(page, /aria-busy=\{startingTaskId === task\.id\}/);
  assert.match(page, /governanceSubmitting/);
});
