import { ChannelType, type Guild, type GuildBasedChannel } from "discord.js";
import { channelDescription, isManagedStarterMessage, starterMessage, type ContentChannelSpec } from "./channel-content.js";

type ContentManifest = { categories: Array<{ name: string; channels: ContentChannelSpec[] }> };

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function findChannel(guild: Guild, categoryId: string, spec: ContentChannelSpec): GuildBasedChannel | undefined {
  const names = [spec.name, ...(spec.legacyNames ?? [])].map(normalize);
  return [...guild.channels.cache.values()].find((channel) => channel.parentId === categoryId && names.includes(normalize(channel.name)));
}

export async function channelContentLines(guild: Guild, manifest: ContentManifest, apply: boolean): Promise<string[]> {
  const lines: string[] = [apply ? "Channel content apply:" : "Channel content preview:"];
  for (const category of manifest.categories) {
    const categoryChannel = [...guild.channels.cache.values()].find(
      (channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(category.name),
    );
    if (!categoryChannel) {
      lines.push(`! missing category: ${category.name}`);
      continue;
    }

    for (const spec of category.channels) {
      const description = channelDescription(category.name, spec);
      const channel = findChannel(guild, categoryChannel.id, spec);
      if (!channel) {
        lines.push(`! missing channel: ${category.name}/#${spec.name}`);
        continue;
      }
      if (!description) {
        lines.push(`! missing description in manifest: ${category.name}/#${spec.name}`);
        continue;
      }
      if (spec.type === "voice") {
        lines.push(`✓ described voice channel: ${category.name}/#${spec.name} (no text post possible)`);
        continue;
      }
      if (!channel.isTextBased() || !("messages" in channel) || !("send" in channel)) {
        lines.push(`! not a usable text channel: ${category.name}/#${spec.name}`);
        continue;
      }

      let messages;
      try {
        messages = await channel.messages.fetch({ limit: 100 });
      } catch {
        lines.push(`! cannot inspect message history: ${category.name}/#${spec.name}`);
        continue;
      }
      const hasStarter = [...messages.values()].some((message) => isManagedStarterMessage(message.content, category.name, spec.name));
      const currentTopic = "topic" in channel && typeof channel.topic === "string" ? channel.topic : undefined;
      const topicNeedsUpdate = currentTopic !== description && "setTopic" in channel && typeof channel.setTopic === "function";
      if (!apply) {
        lines.push(`${hasStarter ? "✓ starter exists" : "+ post starter"}: ${category.name}/#${spec.name}`);
        if (topicNeedsUpdate) lines.push(`  + set description: ${description}`);
        continue;
      }

      if (topicNeedsUpdate) await channel.setTopic(description);
      if (!hasStarter) {
        await channel.send(starterMessage(category.name, spec));
        lines.push(`+ posted starter and ${topicNeedsUpdate ? "set description" : "kept description"}: ${category.name}/#${spec.name}`);
      } else if (topicNeedsUpdate) {
        lines.push(`✓ starter exists; set description: ${category.name}/#${spec.name}`);
      } else {
        lines.push(`✓ starter and description already current: ${category.name}/#${spec.name}`);
      }
    }
  }
  return lines;
}
