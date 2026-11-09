import assert from "node:assert/strict";
import test from "node:test";
import { formatRolloutResults, runRollout } from "../src/rollout.js";

test("rollout runs stages in dependency order", async () => {
  const stages: string[] = [];
  const results = await runRollout(async (stage) => {
    stages.push(stage);
    return [`${stage} complete`];
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
