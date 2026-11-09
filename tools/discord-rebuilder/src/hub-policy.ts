export type HubPermissionPolicy = {
  everyoneId: string;
  allowedUserIds: string[];
};

export function hubPermissionPolicy(guildId: string, ownerIds: Iterable<string>, botId: string): HubPermissionPolicy {
  return {
    everyoneId: guildId,
    allowedUserIds: [...new Set([...ownerIds, botId])],
  };
}

export function isCommunicationHub(channelId: string | undefined, communicationHubChannelId: string | undefined): boolean {
  return Boolean(channelId && communicationHubChannelId && channelId === communicationHubChannelId);
}

export function hubChangeRejected(channelId: string | undefined, communicationHubChannelId: string | undefined): boolean {
  return isCommunicationHub(channelId, communicationHubChannelId);
}
