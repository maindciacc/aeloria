import assert from "node:assert/strict";
import test from "node:test";
import { compareChannels, expectedChannelsFromManifest, formatChannelCheck } from "../src/channel-check.js";

test("manifest channels are flattened with their category", () => {
  assert.deepEqual(expectedChannelsFromManifest({
    categories: [{ name: "Gateway", channels: [{ name: "welcome", type: "text" }] }],
  }), [{ category: "Gateway", name: "welcome", type: "text" }]);
});

test("channel comparison reports missing, unexpected, misplaced, type, and duplicate drift", () => {
  const expected = [
    { category: "Gateway", name: "welcome", type: "text" as const },
    { category: "Voice", name: "Tavern", type: "voice" as const },
    { category: "Staff", name: "planning", type: "text" as const },
  ];
  const live = [
    { category: "Gateway", name: "welcome", type: "voice" as const },
    { category: "Gateway", name: "Tavern", type: "voice" as const },
    { category: "Staff", name: "planning", type: "text" as const },
    { category: "Staff", name: "planning", type: "text" as const },
    { category: "Gateway", name: "rules", type: "text" as const },
  ];

  const report = compareChannels(expected, live);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.unexpected, ["Gateway/#rules"]);
  assert.deepEqual(report.misplaced, ["Gateway/#Tavern should be Voice/#Tavern"]);
  assert.deepEqual(report.typeMismatches, ["Gateway/#welcome should be text, found voice"]);
  assert.deepEqual(report.duplicates, ["Staff/#planning (2 copies)"]);
});

test("comparison is case-insensitive and clean matches produce a clear result", () => {
  const report = compareChannels(
    [{ category: "The Gateway", name: "Welcome", type: "text" }],
    [{ category: "the gateway", name: "welcome", type: "text" }],
  );
  assert.equal(report.missing.length, 0);
  assert.equal(report.unexpected.length, 0);
  assert.equal(formatChannelCheck(report)[0], "Repository channel check: MATCH");
});
