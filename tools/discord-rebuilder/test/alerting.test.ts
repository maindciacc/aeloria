import assert from "node:assert/strict";
import test from "node:test";
import { hubMentions, recoveryGameAlert, seriousGameAlert, shouldAnnounce } from "../src/alerting.js";

test("serious alerts mention only configured Discord IDs", () => {
  const settings = { alertUserIds: ["111111111111111111", "222222222222222222"] } as never;
  assert.equal(hubMentions(settings), "<@111111111111111111> <@222222222222222222>");
  assert.match(seriousGameAlert({ healthy: false, checkedAt: "now", detail: "offline", provider: "powerupstack", label: "Ring" }, settings), /Serious game-server alert/);
  assert.match(recoveryGameAlert({ healthy: true, checkedAt: "now", detail: "ok", provider: "powerupstack", label: "Ring" }, settings), /recovered/);
});

test("alerts announce only state transitions", () => {
  assert.equal(shouldAnnounce(undefined, false), true);
  assert.equal(shouldAnnounce(false, false), false);
  assert.equal(shouldAnnounce(false, true), true);
});
