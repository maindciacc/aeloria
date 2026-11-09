import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_GAME_MONITOR_SETTINGS, mergeGameMonitorSettings, type GameMonitorSettings } from "./game-monitor.js";

export type SetupSettings = {
  autoSetupOnReady: boolean;
  postWelcomePackage: boolean;
  welcomeChannelName: string;
  setupConversationEnabled: boolean;
  bootstrapChannelId?: string;
  communicationHubChannelId?: string;
  alertUserIds: string[];
  gameMonitor: GameMonitorSettings;
};

export const DEFAULT_SETUP_SETTINGS: SetupSettings = {
  autoSetupOnReady: false,
  postWelcomePackage: true,
  welcomeChannelName: "👋・welcome",
  setupConversationEnabled: true,
  alertUserIds: [],
  gameMonitor: { ...DEFAULT_GAME_MONITOR_SETTINGS },
};

const booleanKeys = new Set<keyof SetupSettings>(["autoSetupOnReady", "postWelcomePackage", "setupConversationEnabled"]);

export function validateSetupSettings(value: Partial<SetupSettings>): Partial<SetupSettings> {
  const result: Partial<SetupSettings> = {};
  for (const key of booleanKeys) {
    if (typeof value[key] === "boolean") result[key] = value[key] as never;
  }
  if (typeof value.welcomeChannelName === "string" && value.welcomeChannelName.trim().length > 0 && value.welcomeChannelName.length <= 100) {
    result.welcomeChannelName = value.welcomeChannelName.trim();
  }
  if (typeof value.bootstrapChannelId === "string" && /^\d{10,30}$/.test(value.bootstrapChannelId.trim())) result.bootstrapChannelId = value.bootstrapChannelId.trim();
  if (Array.isArray(value.alertUserIds)) result.alertUserIds = value.alertUserIds.filter((id): id is string => typeof id === "string" && /^\d{10,30}$/.test(id.trim())).map((id) => id.trim()).slice(0, 10);
  if (typeof value.communicationHubChannelId === "string" && /^\d{10,30}$/.test(value.communicationHubChannelId.trim())) result.communicationHubChannelId = value.communicationHubChannelId.trim();
  if (value.gameMonitor && typeof value.gameMonitor === "object") result.gameMonitor = mergeGameMonitorSettings(DEFAULT_GAME_MONITOR_SETTINGS, value.gameMonitor);
  return result;
}

export function mergeSetupSettings(current: SetupSettings, update: Partial<SetupSettings>): SetupSettings {
  return { ...current, ...validateSetupSettings(update) };
}

export function setupSettingsPath(workspacePath: string): string {
  return join(workspacePath, "setup-settings.json");
}

export async function loadSetupSettings(workspacePath: string): Promise<SetupSettings> {
  try {
    const parsed = JSON.parse(await readFile(setupSettingsPath(workspacePath), "utf8")) as Partial<SetupSettings>;
    return mergeSetupSettings(DEFAULT_SETUP_SETTINGS, parsed);
  } catch {
    return { ...DEFAULT_SETUP_SETTINGS };
  }
}

export async function saveSetupSettings(workspacePath: string, settings: SetupSettings): Promise<void> {
  const path = setupSettingsPath(workspacePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function setupSettingsHelp(): string[] {
  return [
    "Safe setup settings:",
    "- autoSetupOnReady: run the idempotent setup when Warden connects",
    "- postWelcomePackage: post the managed welcome package after setup",
    "- welcomeChannelName: channel for setup reports and welcome discussion",
    "- setupConversationEnabled: accept natural-language setup requests in the welcome channel",
    "- alertUserIds: Discord IDs to mention for serious game-server failures",
    "- gameMonitor: provider, health URL or host/port, interval, and enabled state",
    "Dangerous deletion/reset operations are never enabled by these settings.",
  ];
}
