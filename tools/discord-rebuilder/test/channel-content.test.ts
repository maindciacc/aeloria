import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { channelDescription, isManagedStarterMessage, starterMarker, starterMessage } from "../src/channel-content.js";

type Manifest = { categories: Array<{ name: string; channels: Array<{ name: string; type: "text" | "voice"; topic?: string; description?: string }> }> };
const manifest = JSON.parse(readFileSync(new URL("../config/aeloria-server.json", import.meta.url), "utf8")) as Manifest;

test("every manifest channel has a description", () => {
  for (const category of manifest.categories) {
    for (const channel of category.channels) {
      assert.ok(channelDescription(category.name, channel), `${category.name}/${channel.name} has no description`);
    }
  }
});

test("starter content has a stable marker and can be recognized on retry", () => {
  const channel = { name: "welcome", type: "text" as const, topic: "Welcome contributors." };
  const content = starterMessage("The Gateway", channel);
  assert.match(content, /Welcome to #welcome/);
  assert.match(content, /Welcome contributors\./);
  assert.equal(isManagedStarterMessage(content, "The Gateway", "welcome"), true);
  assert.equal(isManagedStarterMessage(content, "Other", "welcome"), false);
  assert.equal(content.includes(starterMarker("The Gateway", "welcome")), true);
});
