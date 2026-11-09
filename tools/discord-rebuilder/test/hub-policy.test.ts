import test from "node:test";
import assert from "node:assert/strict";
import { hubChangeRejected, hubPermissionPolicy, isCommunicationHub } from "../src/hub-policy.js";

test("hub permissions allow configured owners and Warden only", () => {
  assert.deepEqual(hubPermissionPolicy("guild", ["owner", "owner"], "bot"), {
    everyoneId: "guild",
    allowedUserIds: ["owner", "bot"],
  });
});

test("hub identity is recognized by its persisted channel ID", () => {
  assert.equal(isCommunicationHub("hub", "hub"), true);
  assert.equal(isCommunicationHub("other", "hub"), false);
  assert.equal(hubChangeRejected("hub", "hub"), true);
  assert.equal(hubChangeRejected("other", "hub"), false);
});
