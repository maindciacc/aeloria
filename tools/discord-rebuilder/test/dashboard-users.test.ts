import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDashboardServer } from "../src/dashboard.js";
import { localConfig } from "../src/local-services.js";

test("Cloudflare-bound workshop users can draft while operator controls remain restricted", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "aeloria-dashboard-users-"));
  const dashboard = createDashboardServer(
    {
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      workspacePath,
      repositoryRoot: workspacePath,
      requireCloudflareIdentity: true,
      users: [
        { id: "owner@example.com", token: "owner-token", operator: true },
        { id: "salty@example.com", token: "salty-token", operator: false },
      ],
    },
    new Set(["owner"]),
    { ...localConfig(workspacePath), workspacePath, ollamaStartupCheck: false },
    undefined,
    {
      smoke: async () => ["smoke"],
      lockdown: async () => ["lockdown"],
      setup: async () => ["setup"],
      setupChat: async () => ["chat"],
      restart: async () => ["restart"],
    },
  );
  const address = await dashboard.start();
  try {
    const headers = { "content-type": "application/json", "cf-access-authenticated-user-email": "salty@example.com" };
    const login = await fetch(`http://127.0.0.1:${address.port}/api/login`, { method: "POST", headers, body: JSON.stringify({ token: "salty-token" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);
    const draft = await fetch(`http://127.0.0.1:${address.port}/api/workspace`, { method: "POST", headers: { ...headers, cookie }, body: JSON.stringify({ kind: "lore", title: "A shared draft", content: "Review this together." }) });
    assert.equal(draft.status, 201);
    const setup = await fetch(`http://127.0.0.1:${address.port}/api/setup`, { method: "POST", headers: { ...headers, cookie }, body: JSON.stringify({ action: "preview" }) });
    assert.equal(setup.status, 403);
  } finally {
    await new Promise<void>((resolveClose) => dashboard.server.close(() => resolveClose()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});
