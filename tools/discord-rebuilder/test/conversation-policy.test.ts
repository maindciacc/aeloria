import assert from "node:assert/strict";
import test from "node:test";
import { deletionProposalValid, isDeletionCancellation, isDeletionConfirmation } from "../src/conversation-policy.js";

test("deletion confirmation requires an explicit affirmative phrase", () => {
  assert.equal(isDeletionConfirmation("yes, delete those"), true);
  assert.equal(isDeletionConfirmation("confirm deletion"), true);
  assert.equal(isDeletionConfirmation("go ahead"), false);
  assert.equal(isDeletionConfirmation("maybe later"), false);
  assert.equal(isDeletionConfirmation("no, do not delete those"), false);
  assert.equal(isDeletionConfirmation("yes, don't delete those"), false);
});

test("deletion cancellation is recognized", () => {
  assert.equal(isDeletionCancellation("cancel"), true);
  assert.equal(isDeletionCancellation("never mind"), true);
  assert.equal(isDeletionCancellation("yes"), false);
});

test("deletion proposals are bound to owner, guild, channel, and expiry", () => {
  const proposal = { ownerId: "owner", guildId: "guild", channelId: "channel", expiresAt: 1000, resourceIds: ["resource"] };
  assert.equal(deletionProposalValid(proposal, "owner", "guild", "channel", 1000), true);
  assert.equal(deletionProposalValid(proposal, "other", "guild", "channel", 1000), false);
  assert.equal(deletionProposalValid(proposal, "owner", "guild", "channel", 1001), false);
});
