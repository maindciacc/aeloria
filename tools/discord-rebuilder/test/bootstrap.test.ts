import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapChannelId, bootstrapWelcomeMessage, isFirstRunBlankGuild } from "../src/bootstrap.js";

test("blank guild detection requires one text channel and no human roles", () => {
  assert.equal(isFirstRunBlankGuild({ textChannelCount: 1, categoryCount: 0, humanRoleCount: 0, botManagedRoleCount: 1 }), true);
  assert.equal(isFirstRunBlankGuild({ textChannelCount: 2, categoryCount: 0, humanRoleCount: 0, botManagedRoleCount: 1 }), false);
  assert.equal(isFirstRunBlankGuild({ textChannelCount: 1, categoryCount: 0, humanRoleCount: 1, botManagedRoleCount: 1 }), false);
});

test("bootstrap state keeps an existing binding and has an actionable welcome", () => {
  assert.equal(bootstrapChannelId(undefined, "channel"), "channel");
  assert.equal(bootstrapChannelId("existing", "channel"), "existing");
  assert.match(bootstrapWelcomeMessage(), /blank slate/);
  assert.equal(bootstrapWelcomeMessage().includes("<!--"), false);
});
