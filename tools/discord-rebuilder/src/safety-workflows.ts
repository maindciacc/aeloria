export type LockdownState = { enabled: boolean; reason: string; changedAt: string; changedBy: string };

export type SmokeTestStep = {
  name: string;
  target: string;
  action: "inspect" | "post" | "react" | "role" | "permission" | "service";
  destructive: boolean;
};

export const SMOKE_TEST_MARKER = "<!-- aeloria-warden-smoke-test:v1 -->";
export const LOCKDOWN_ROLE_NAME = "Warden Lockdown";
export const LOCKDOWN_CATEGORY_NAME = "🚨・Lockdown Protocol";
export const LOCKDOWN_STAFF_CHANNEL_NAME = "🛡️・lockdown-coordination";
export const LOCKDOWN_NOTICEBOARD_CHANNEL_NAME = "🚨・red-alert-noticeboard";
export const LOCKDOWN_HOLDING_CHANNEL_NAME = "🔒・holding-area";

export const LOCKDOWN_STAFF_ROLE_NAMES = ["Founder", "Project Lead", "Moderator"] as const;

export type LockdownProtocolChannel = "staff" | "noticeboard" | "holding";

export function lockdownStaffRoleNames(roleNames: readonly string[]): string[] {
  return roleNames.filter((name) => LOCKDOWN_STAFF_ROLE_NAMES.some((staffName) => staffName.toLocaleLowerCase() === name.toLocaleLowerCase()));
}

export function lockdownMemberPermissions() {
  return {
    allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
    deny: ["MentionEveryone", "MentionRoles", "MentionUsers", "EmbedLinks", "AttachFiles", "AddReactions", "UseExternalEmojis"],
  } as const;
}

export function lockdownStaffPermissions() {
  return {
    allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "MentionEveryone", "MentionRoles", "MentionUsers"],
  } as const;
}

export function lockdownProtocolChannelName(kind: LockdownProtocolChannel): string {
  return kind === "staff" ? LOCKDOWN_STAFF_CHANNEL_NAME : kind === "noticeboard" ? LOCKDOWN_NOTICEBOARD_CHANNEL_NAME : LOCKDOWN_HOLDING_CHANNEL_NAME;
}

export function canRunSafetyWorkflow(userId: string, ownerIds: ReadonlySet<string>): boolean {
  return ownerIds.has(userId);
}

export function isBotAccount(user: { bot?: boolean; system?: boolean }): boolean {
  return user.bot === true || user.system === true;
}

export function createSmokeTestPlan(channelNames: readonly string[], roleNames: readonly string[]): SmokeTestStep[] {
  return [
    { name: "Repository manifest", target: "config/aeloria-server.json", action: "inspect", destructive: false },
    { name: "Local services", target: "Obsidian/Ollama/workspace", action: "service", destructive: false },
    ...channelNames.map((name) => ({ name: `Channel content: ${name}`, target: name, action: "post" as const, destructive: false })),
    ...roleNames.map((name) => ({ name: `Role path: ${name}`, target: name, action: "role" as const, destructive: false })),
    { name: "Permission lockdown readiness", target: "configured guild", action: "permission", destructive: true },
  ];
}

export function canAcceptRules(content: string, rulesChannelId: string, messageChannelId: string): boolean {
  if (rulesChannelId !== messageChannelId) return false;
  return /\b(i\s+accept|i\s+agree|accept|agree)\b/i.test(content);
}

export function lockdownState(enabled: boolean, reason: string, changedBy: string, changedAt = new Date().toISOString()): LockdownState {
  return { enabled, reason: reason.trim() || "Emergency Warden lockdown", changedAt, changedBy };
}

export function lockdownPermissionChange(enabled: boolean): "deny-send" | "restore-send" {
  return enabled ? "deny-send" : "restore-send";
}
