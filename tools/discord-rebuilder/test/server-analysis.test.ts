import assert from "node:assert/strict";
import test from "node:test";
import { compareServer, formatServerAnalysis } from "../src/server-analysis.js";

test("server analysis reports category and role drift", () => {
  const report = compareServer(
    [{ name: "Gateway" }, { name: "Staff" }],
    [{ name: "Gateway" }, { name: "Archive" }],
    [{ name: "Member" }, { name: "Lore Writer", legacyNames: ["Lorekeeper"] }],
    [{ name: "Member" }, { name: "Unmanaged" }],
    { channelMissing: ["Staff/#planning"], channelUnexpected: [], channelMisplaced: [], channelTypeMismatches: [], duplicateChannels: [] },
  );
  assert.deepEqual(report.categoryMissing, ["Staff"]);
  assert.deepEqual(report.categoryUnexpected, ["Archive"]);
  assert.deepEqual(report.roleMissing, ["Lore Writer"]);
  assert.deepEqual(report.roleUnexpected, ["Unmanaged"]);
});

test("clean server analysis is clearly read-only and matches", () => {
  const lines = formatServerAnalysis(compareServer(
    [{ name: "Gateway" }],
    [{ name: "Gateway" }],
    [{ name: "Member" }],
    [{ name: "Member" }],
    { channelMissing: [], channelUnexpected: [], channelMisplaced: [], channelTypeMismatches: [], duplicateChannels: [] },
  ));
  assert.equal(lines[0], "Repository/server analysis: MATCH");
  assert.equal(lines.at(-1), "Read-only report: no Discord resources were changed. Only visible resources were analyzed.");
});
