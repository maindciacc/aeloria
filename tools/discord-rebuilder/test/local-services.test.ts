import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { checkOllama, initializeLocalServices, localConfig } from "../src/local-services.js";

test("local configuration enables vault initialization and Ollama startup checks by default", () => {
  const config = localConfig("C:\\aeloria");
  assert.equal(config.autoInitializeVault, true);
  assert.equal(config.autoOpenObsidian, false);
  assert.equal(config.ollamaStartupCheck, true);
  assert.equal(config.ollamaAutoStart, true);
  assert.equal(config.ollamaCommand, "ollama");
  assert.equal(config.ollamaStartupTimeoutMs, 15_000);
});

test("Ollama health reports model availability without sending project context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "http://ollama.test/api/tags");
    return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const health = await checkOllama({
      ...localConfig("C:\\aeloria"),
      ollamaUrl: "http://ollama.test",
      ollamaModel: "llama3.2",
    });
    assert.deepEqual(health, { available: true, modelAvailable: true, detail: "llama3.2 is available" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("startup initializes the vault and remains usable with Ollama checks disabled", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "aeloria-warden-test-"));
  const config = {
    ...localConfig("C:\\aeloria"),
    vaultPath,
    ollamaStartupCheck: false,
  };
  try {
    const services = await initializeLocalServices(config);
    assert.equal(services.vaultInitialized, true);
    assert.equal(services.ollama, undefined);
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
});
