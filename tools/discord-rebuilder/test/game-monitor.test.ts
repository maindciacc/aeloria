import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GAME_MONITOR_SETTINGS, mergeGameMonitorSettings, validateGameMonitorSettings } from "../src/game-monitor.js";

test("game monitor settings are bounded and provider-neutral", () => {
  assert.deepEqual(validateGameMonitorSettings({ provider: "realm", intervalMs: 30_000, port: 19132, healthUrl: "https://example.test/health", unknown: true } as never), { provider: "realm", intervalMs: 30_000, port: 19132, healthUrl: "https://example.test/health" });
  assert.equal(mergeGameMonitorSettings(DEFAULT_GAME_MONITOR_SETTINGS, { enabled: true, provider: "powerupstack" }).enabled, true);
});

test("realm without an external signal fails clearly instead of guessing", async () => {
  const status = await (await import("../src/game-monitor.js")).checkGameServer({ ...DEFAULT_GAME_MONITOR_SETTINGS, provider: "realm" });
  assert.equal(status.healthy, false);
  assert.match(status.detail, /health signal|HTTP bridge/i);
});
