import assert from "node:assert/strict";
import test from "node:test";
import { canManage, chatAllowed, isAuthorizedOperator, parseIdSet, removeBotMention, wakeQuestion } from "../src/policy.js";

test("parseIdSet trims values and ignores empty entries", () => {
  assert.deepEqual(parseIdSet(" 123, ,456,123 "), new Set(["123", "456"]));
  assert.deepEqual(parseIdSet(undefined), new Set());
});

test("operator management requires both allowlisting and Manage Server", () => {
  const operators = new Set(["operator"]);
  assert.equal(isAuthorizedOperator("operator", operators, true), true);
  assert.equal(isAuthorizedOperator("operator", operators, false), false);
  assert.equal(isAuthorizedOperator("other", operators, true), false);
});

test("God Mode does not grant management access", () => {
  const operators = new Set<string>();
  const owners = new Set(["owner", "co-owner"]);
  assert.equal(canManage("owner", operators, false, owners, false), false);
  assert.equal(canManage("co-owner", operators, false, owners, true), true);
  assert.equal(canManage("other", operators, true, owners, true), false);
});

test("chat requires an explicit configured channel allowlist", () => {
  assert.equal(chatAllowed("channel", new Set()), false);
  assert.equal(chatAllowed("channel", new Set(["channel"])), true);
  assert.equal(chatAllowed("other", new Set(["channel"])), false);
});

test("wake phrase parsing rejects empty prompts", () => {
  assert.equal(wakeQuestion("hey warden"), undefined);
  assert.equal(wakeQuestion("  Hey Warden, what is canon?  "), "what is canon?");
  assert.equal(wakeQuestion("hello there"), undefined);
});

test("bot mentions are removed without changing other text", () => {
  assert.equal(removeBotMention("<@123> what is Aeloria?", "123"), "what is Aeloria?");
  assert.equal(removeBotMention("<@!123> help <@123>", "123"), "help");
});
