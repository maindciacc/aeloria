export type ContentChannelSpec = {
  name: string;
  type: "text" | "voice";
  topic?: string;
  description?: string;
  starterMessage?: string;
  legacyNames?: string[];
};

export const STARTER_MARKER_PREFIX = "<!-- aeloria-warden-starter:v1:";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function channelDescription(categoryName: string, channel: ContentChannelSpec): string | undefined {
  const description = channel.description?.trim() || channel.topic?.trim();
  return description || undefined;
}

export function starterMarker(categoryName: string, channelName: string): string {
  return `${STARTER_MARKER_PREFIX}${normalize(categoryName)}:${normalize(channelName)} -->`;
}

export function starterMessage(categoryName: string, channel: ContentChannelSpec): string {
  const description = channelDescription(categoryName, channel) ?? `A place for ${channel.name}.`;
  const customMessage = channel.starterMessage?.trim();
  return [
    starterMarker(categoryName, channel.name),
    customMessage || `**Welcome to #${channel.name}**\n\n${description}\n\nKeep contributions relevant to this channel so the project stays easy to follow.`,
  ].join("\n");
}

export function isManagedStarterMessage(content: string, categoryName: string, channelName: string): boolean {
  return content.includes(starterMarker(categoryName, channelName));
}
