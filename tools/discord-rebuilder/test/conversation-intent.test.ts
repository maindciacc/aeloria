import assert from "node:assert/strict";
import test from "node:test";
import { conversationIntent, explicitCancellation, explicitConfirmation } from "../src/conversation-intent.js";

test("conversation intent recognizes common operational language", () => {
  assert.deepEqual(conversationIntent("please deploy the server"), { kind: "rollout-request" });
  assert.deepEqual(conversationIntent("show me the lockdown status"), { kind: "lockdown-status" });
  assert.deepEqual(conversationIntent("run the smoke test"), { kind: "smoke-run" });
  assert.deepEqual(conversationIntent("what is the server status?"), { kind: "status" });
});

test("ambiguous conversation remains chat", () => {
  assert.deepEqual(conversationIntent("I have an idea for the guilds"), { kind: "chat", question: "I have an idea for the guilds" });
});

test("confirmation and cancellation are explicit", () => {
  assert.equal(explicitConfirmation("yes"), true);
  assert.equal(explicitConfirmation("go ahead"), true);
  assert.equal(explicitConfirmation("yes deploy it"), false);
  assert.equal(explicitCancellation("cancel"), true);
  assert.equal(explicitCancellation("no, not yet"), true);
});
