import assert from "node:assert/strict";
import test from "node:test";
import { advanceStagedRollout, applyRolloutTweak, approveStagedRollout, describeStagedRollout, formatRolloutResults, nextRolloutStage, runRollout } from "../src/rollout.js";

test("rollout runs stages in dependency order", async () => {
  const stages: string[] = [];
  const results = await runRollout(async (stage) => {
    stages.push(stage);
    return [`${stage} complete`];
  });

test("staged rollout supports bounded tweaks and approval", () => {
  const session = { ownerId: "owner", guildId: "guild", channelId: "channel", nextStageIndex: 0, approved: false, tweaks: {}, expiresAt: Date.now() + 1000 };
  assert.equal(nextRolloutStage(session), "structure");
  assert.equal(applyRolloutTweak(session, "rollout tweak welcome off"), "welcome package off");
  assert.equal(session.tweaks.postWelcomePackage, false);
  assert.equal(session.approved, false);
  assert.match(approveStagedRollout(session), /Approved \*\*structure\*\*/);
  assert.equal(session.approved, true);
  assert.match(describeStagedRollout(session).join("\n"), /Welcome package: off/);
  advanceStagedRollout(session);
  assert.equal(nextRolloutStage(session), "roles");
  assert.equal(session.approved, false);
});
  assert.deepEqual(stages, ["structure", "roles", "content", "role-panel", "onboarding"]);
  assert.equal(results.every((result) => result.ok), true);
  assert.match(formatRolloutResults(results).at(-1) ?? "", /Rollout complete/);
});

test("rollout stops after a failed stage and reports it", async () => {
  const stages: string[] = [];
  const results = await runRollout(async (stage) => {
    stages.push(stage);
    if (stage === "roles") throw new Error("Manage Roles unavailable");
    return [];
  });
  assert.deepEqual(stages, ["structure", "roles"]);
  assert.equal(results[1]?.ok, false);
  assert.match(formatRolloutResults(results).at(-1) ?? "", /stopped after a failed stage/);
});
