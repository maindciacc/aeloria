export type PermissionCheck = (permission: string) => boolean;

export function parseIdSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

export function isAuthorizedOperator(
  userId: string,
  operatorIds: ReadonlySet<string>,
  hasManageGuild: boolean,
): boolean {
  return hasManageGuild && operatorIds.has(userId);
}

export function canManage(
  userId: string,
  operatorIds: ReadonlySet<string>,
  hasManageGuild: boolean,
  ownerIds: ReadonlySet<string>,
  adminMode: boolean,
): boolean {
  return isAuthorizedOperator(userId, operatorIds, hasManageGuild) || (adminMode && ownerIds.has(userId));
}

export function chatAllowed(channelId: string, allowedChannelIds: ReadonlySet<string>): boolean {
  return allowedChannelIds.size > 0 && allowedChannelIds.has(channelId);
}

export function wakeQuestion(content: string): string | undefined {
  const match = content.match(/^\s*hey\s+warden\b[,:!?-]?\s*(.*)$/i);
  const question = match?.[1]?.trim();
  return question || undefined;
}

export function removeBotMention(content: string, botId: string): string {
  const mention = new RegExp(`<@!?${botId}>`, "g");
  return content.replace(mention, "").trim();
}
