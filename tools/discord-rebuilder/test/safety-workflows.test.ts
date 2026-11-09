import assert from "node:assert/strict";
import test from "node:test";
import { canAcceptRules, canRunSafetyWorkflow, createSmokeTestPlan, isBotAccount, lockdownMemberPermissions, lockdownPermissionChange, lockdownProtocolChannelName, lockdownStaffPermissions, lockdownStaffRoleNames, lockdownState } from "../src/safety-workflows.js";

test("smoke test plan is explicit and marks permission mutation", () => {
  const plan = createSmokeTestPlan(["welcome", "rules"], ["Wanderer", "Settler"]);
  assert.equal(plan[0].action, "inspect");
  assert.equal(plan.at(-1)?.destructive, true);
  assert.equal(plan.filter((step) => step.action === "post").length, 2);
});

test("lockdown separates staff from ordinary member permissions", () => {
  assert.deepEqual(lockdownStaffRoleNames(["Member", "Moderator", "Project Lead"]), ["Moderator", "Project Lead"]);
  assert.ok(lockdownStaffPermissions().allow.includes("ViewChannel"));
  assert.ok(lockdownStaffPermissions().allow.includes("SendMessages"));
  assert.ok(lockdownStaffPermissions().allow.includes("MentionEveryone"));
  assert.deepEqual(lockdownMemberPermissions().allow, ["ViewChannel", "SendMessages", "ReadMessageHistory"]);
  assert.ok(lockdownMemberPermissions().deny.includes("MentionEveryone"));
  assert.ok(lockdownMemberPermissions().deny.includes("AttachFiles"));
  assert.equal(lockdownProtocolChannelName("holding"), "🔒・holding-area");
});

test("safety workflows are owner-only and detect automated accounts", () => {
  assert.equal(canRunSafetyWorkflow("owner", new Set(["owner"])), true);
  assert.equal(canRunSafetyWorkflow("operator", new Set(["owner"])), false);
  assert.equal(isBotAccount({ bot: true }), true);
  assert.equal(isBotAccount({ system: true }), true);
  assert.equal(isBotAccount({}), false);
});

test("rules acceptance is limited to the configured rules channel", () => {
  assert.equal(canAcceptRules("I accept the rules", "rules", "rules"), true);
  assert.equal(canAcceptRules("agree", "rules", "general"), false);
  assert.equal(canAcceptRules("maybe", "rules", "rules"), false);
});

test("lockdown state and permission transition are explicit", () => {
  assert.deepEqual(lockdownState(true, "Raid response", "owner", "2025-01-01T00:00:00.000Z"), { enabled: true, reason: "Raid response", changedAt: "2025-01-01T00:00:00.000Z", changedBy: "owner" });
  assert.equal(lockdownPermissionChange(true), "deny-send");
  assert.equal(lockdownPermissionChange(false), "restore-send");
});
