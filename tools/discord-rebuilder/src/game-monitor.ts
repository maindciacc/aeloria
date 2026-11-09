import { Socket } from "node:net";

export type GameMonitorProvider = "powerupstack" | "realm" | "custom";
export type GameMonitorSettings = {
  enabled: boolean;
  provider: GameMonitorProvider;
  label: string;
  healthUrl?: string;
  host?: string;
  port?: number;
  intervalMs: number;
};

export type GameMonitorStatus = {
  checkedAt: string;
  healthy: boolean;
  detail: string;
  provider: GameMonitorProvider;
  label: string;
};

export const DEFAULT_GAME_MONITOR_SETTINGS: GameMonitorSettings = {
  enabled: false,
  provider: "powerupstack",
  label: "The Forgotten Ring",
  intervalMs: 60_000,
};

export function validateGameMonitorSettings(value: Partial<GameMonitorSettings>): Partial<GameMonitorSettings> {
  const result: Partial<GameMonitorSettings> = {};
  if (typeof value.enabled === "boolean") result.enabled = value.enabled;
  if (value.provider === "powerupstack" || value.provider === "realm" || value.provider === "custom") result.provider = value.provider;
  if (typeof value.label === "string" && value.label.trim() && value.label.length <= 120) result.label = value.label.trim();
  if (typeof value.healthUrl === "string" && /^https?:\/\//i.test(value.healthUrl)) result.healthUrl = value.healthUrl.trim();
  if (typeof value.host === "string" && value.host.trim() && value.host.length <= 255) result.host = value.host.trim();
  if (Number.isInteger(value.port) && (value.port as number) > 0 && (value.port as number) <= 65535) result.port = value.port;
  if (Number.isInteger(value.intervalMs) && (value.intervalMs as number) >= 15_000 && (value.intervalMs as number) <= 86_400_000) result.intervalMs = value.intervalMs;
  return result;
}

export function mergeGameMonitorSettings(current: GameMonitorSettings, update: Partial<GameMonitorSettings>): GameMonitorSettings {
  return { ...current, ...validateGameMonitorSettings(update) };
}

export async function checkGameServer(settings: GameMonitorSettings): Promise<GameMonitorStatus> {
  const checkedAt = new Date().toISOString();
  if (settings.healthUrl) {
    try {
      const response = await fetch(settings.healthUrl, { signal: AbortSignal.timeout(10_000) });
      return { checkedAt, healthy: response.ok, detail: `${response.status} ${response.statusText}`, provider: settings.provider, label: settings.label };
    } catch (error) {
      return { checkedAt, healthy: false, detail: error instanceof Error ? error.message : "HTTP health check failed", provider: settings.provider, label: settings.label };
    }
  }
  if (settings.host && settings.port) {
    const host = settings.host;
    const port = settings.port;
    return new Promise((resolve) => {
      const socket = new Socket();
      const finish = (healthy: boolean, detail: string) => {
        socket.destroy();
        resolve({ checkedAt, healthy, detail, provider: settings.provider, label: settings.label });
      };
      socket.setTimeout(10_000);
      socket.once("connect", () => finish(true, `TCP ${host}:${port} reachable`));
      socket.once("timeout", () => finish(false, "TCP health check timed out"));
      socket.once("error", (error) => finish(false, error.message));
      socket.connect(port, host);
    });
  }
  return { checkedAt, healthy: false, detail: settings.provider === "realm" ? "Realm monitoring needs a provider health signal or HTTP bridge; direct public probing is not assumed." : "Configure healthUrl or host/port for monitoring.", provider: settings.provider, label: settings.label };
}
