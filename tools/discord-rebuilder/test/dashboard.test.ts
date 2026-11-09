import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDashboardServer } from "../src/dashboard.js";
import { localConfig } from "../src/local-services.js";

test("dashboard requires the configured owner token and serves the workspace", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "aeloria-dashboard-test-"));
  const dashboard = createDashboardServer(
    { enabled: true, host: "127.0.0.1", port: 0, accessToken: "test-token", workspacePath },
    new Set(["owner"]),
    { ...localConfig(workspacePath), workspacePath, ollamaStartupCheck: false },
    async () => ({ connected: true, guildId: "guild", guildName: "The Forgotten Ring", memberCount: 1, categoryCount: 1, channelCount: 2, roleCount: 3 }),
  );
  const address = await dashboard.start();
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/api/workspace`);
    assert.equal(unauthorized.status, 401);
    const login = await fetch(`http://127.0.0.1:${address.port}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "test-token" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);
    const created = await fetch(`http://127.0.0.1:${address.port}/api/workspace`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ kind: "build-idea", title: "Arrival route", content: "Connect the harbour to Ydrasil." }) });
    assert.equal(created.status, 201);
    const status = await fetch(`http://127.0.0.1:${address.port}/api/status`, { headers: { cookie } });
    assert.deepEqual(await status.json(), { connected: true, guildId: "guild", guildName: "The Forgotten Ring", memberCount: 1, categoryCount: 1, channelCount: 2, roleCount: 3 });
  } finally {
    await new Promise<void>((resolveClose) => dashboard.server.close(() => resolveClose()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});
