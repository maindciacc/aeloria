import type { GameMonitorStatus } from "./game-monitor.js";
import type { SetupSettings } from "./setup-settings.js";

export function hubMentions(settings: SetupSettings): string {
  return settings.alertUserIds.length > 0 ? settings.alertUserIds.map((id) => `<@${id}>`).join(" ") : "";
}

export function seriousGameAlert(status: GameMonitorStatus, settings: SetupSettings): string {
  const mentions = hubMentions(settings);
  return [
    "🚨 **Serious game-server alert**",
    mentions,
    `**${status.label}** (${status.provider}) is unhealthy.`,
    `Checked: ${status.checkedAt}`,
    `Detail: ${status.detail}`,
    "Warden will keep monitoring and will announce recovery in the communication hub.",
  ].filter(Boolean).join("\n");
}

export function recoveryGameAlert(status: GameMonitorStatus, settings: SetupSettings): string {
  const mentions = hubMentions(settings);
  return ["✅ **Game-server recovered**", mentions, `**${status.label}** is healthy again.`, `Checked: ${status.checkedAt}`, `Detail: ${status.detail}`].filter(Boolean).join("\n");
}

export function shouldAnnounce(previous: boolean | undefined, current: boolean): boolean {
  return previous === undefined || previous !== current;
}
