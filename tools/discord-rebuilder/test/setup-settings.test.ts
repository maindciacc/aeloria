import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETUP_SETTINGS, mergeSetupSettings, validateSetupSettings } from "../src/setup-settings.js";

test("setup settings accept only known bounded values", () => {
  assert.deepEqual(validateSetupSettings({ autoSetupOnReady: false, welcomeChannelName: " 📜・rules ", unknown: true } as never), { autoSetupOnReady: false, welcomeChannelName: "📜・rules" });
});

test("setup settings merge with safe defaults", () => {
  assert.deepEqual(mergeSetupSettings(DEFAULT_SETUP_SETTINGS, { postWelcomePackage: false }), { ...DEFAULT_SETUP_SETTINGS, postWelcomePackage: false });
});

test("startup setup is read-only by default", () => {
  assert.equal(DEFAULT_SETUP_SETTINGS.autoSetupOnReady, false);
});
