import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ColorResolvable,
  type Guild,
  type GuildBasedChannel,
  type Role,
  type TextChannel,
  type PermissionResolvable,
} from "discord.js";
import { roleNamesMatch, separatorRoles, selfAssignableRoles, type RoleSpec } from "./role-policy.js";

type RoleManifest = { roles: RoleSpec[]; roleMenuChannelName?: string; categories?: Array<{ channels: Array<{ name: string; legacyNames?: string[] }> }> };

export const ROLE_PANEL_MARKER = "<!-- aeloria-role-panel:v1 -->";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function findRole(guild: Guild, spec: RoleSpec): Role | undefined {
  return [...guild.roles.cache.values()].find((role) => roleNamesMatch(spec, role.name));
}

function findRoleMenuChannel(guild: Guild, manifest: RoleManifest, channelId?: string): TextChannel | undefined {
  const configuredNames = [manifest.roleMenuChannelName ?? ""];
  for (const category of manifest.categories ?? []) {
    for (const channel of category.channels) {
      if (normalize(channel.name) === normalize(manifest.roleMenuChannelName ?? "") || (channel.legacyNames ?? []).some((name) => normalize(name) === normalize(manifest.roleMenuChannelName ?? ""))) {
        configuredNames.push(channel.name, ...(channel.legacyNames ?? []));
      }
    }
  }
  const channel = channelId
    ? guild.channels.cache.get(channelId)
    : [...guild.channels.cache.values()].find((item) => item.type !== ChannelType.GuildCategory && configuredNames.some((name) => normalize(item.name) === normalize(name)));
  return channel?.type === ChannelType.GuildText ? channel : undefined;
}

export function rolePreviewLines(guild: Guild, manifest: RoleManifest): string[] {
  const lines = ["Role manifest preview:"];
  for (const spec of manifest.roles) {
    const existing = findRole(guild, spec);
    const flags = [spec.kind ?? "member", spec.group ? `group:${spec.group}` : "", spec.selfAssignable ? "self-selectable" : "", spec.autoAssign ? "auto-assign" : "", spec.color ? `color:${spec.color}` : "", spec.permissions?.length ? `permissions:${spec.permissions.join(",")}` : "permissions:none"].filter(Boolean).join(", ");
    lines.push(`${existing ? "✓ exists" : "+ create"}: ${spec.name} [${flags}]`);
  }
  lines.push(`Self-selectable roles: ${selfAssignableRoles(manifest.roles).length}`);
  lines.push(`Auto-assigned separator roles: ${separatorRoles(manifest.roles).length}`);
  lines.push(`Role menu channel: ${manifest.roleMenuChannelName ?? "not configured"}`);
  return lines;
}

export async function applyRoleManifest(guild: Guild, manifest: RoleManifest): Promise<string[]> {
  const results: string[] = [];
  for (const spec of manifest.roles) {
    const existing = findRole(guild, spec);
    if (existing) {
      if (!existing.managed) {
        await existing.edit({ color: (spec.color ?? "#99a4ad") as ColorResolvable, hoist: spec.hoist ?? false, permissions: (spec.permissions ?? []) as PermissionResolvable[], reason: "Aeloria role manifest: reconcile role" });
      }
      results.push(`✓ role ready: ${spec.name}`);
      continue;
    }
    const role = await guild.roles.create({
      name: spec.name,
      color: (spec.color ?? "#99a4ad") as ColorResolvable,
      hoist: spec.hoist ?? false,
      mentionable: false,
      permissions: (spec.permissions ?? []) as PermissionResolvable[],
      reason: "Aeloria role manifest: create role",
    });
    results.push(`+ created role: ${role.name}`);
  }
  const botCeiling = Math.max(1, (guild.members.me?.roles.highest.position ?? guild.roles.highest.position) - 1);
  const positions = manifest.roles
    .map((spec, index) => {
      const role = findRole(guild, spec);
      return role && !role.managed ? { role: role.id, position: Math.max(1, botCeiling - index) } : undefined;
    })
    .filter((position): position is { role: string; position: number } => Boolean(position));
  if (positions.length > 0) {
    await guild.roles.setPositions(positions);
    results.push(`✓ ordered ${positions.length} managed role(s) into manifest sections below the bot role.`);
  }
  return results;
}

export async function assignSeparatorRoles(guild: Guild, manifest: RoleManifest): Promise<string[]> {
  const roles = separatorRoles(manifest.roles).map((spec) => findRole(guild, spec)).filter((role): role is Role => Boolean(role));
  if (roles.length === 0) return ["No auto-assigned separator roles are available."];
  const members = await guild.members.fetch();
  let assigned = 0;
  for (const member of members.values()) {
    for (const role of roles) {
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role, "Aeloria role sections: assign separator role");
        assigned += 1;
      }
    }
  }
  return [`Assigned ${assigned} separator role(s) across ${members.size} member(s).`];
}

export async function publishRolePanel(guild: Guild, manifest: RoleManifest, channelId?: string, botId?: string): Promise<string> {
  const channel = findRoleMenuChannel(guild, manifest, channelId);
  if (!channel) throw new Error("Role menu channel was not found or is not a text channel.");
  const roles = selfAssignableRoles(manifest.roles).map((spec, index) => ({ spec, index })).filter(({ spec }) => Boolean(findRole(guild, spec)));
  if (roles.length === 0) throw new Error("No self-selectable roles exist yet; apply the role manifest first.");
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < roles.length; index += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const { spec } of roles.slice(index, index + 5)) {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`aeloria-role:${manifest.roles.indexOf(spec)}`)
        .setLabel(`${spec.reactionEmoji ?? ""} ${spec.name}`.trim().slice(0, 80))
        .setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  }
  const content = `${ROLE_PANEL_MARKER}\n**Choose your Aeloria contribution roles**\nReact with the matching emoji or click a button to add/remove a role. Staff roles are assigned by the team.`;
  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = botId ? [...messages.values()].find((message) => message.author.id === botId && message.content.includes(ROLE_PANEL_MARKER)) : undefined;
  const panel = existing ? await existing.edit({ content, components: rows }) : await channel.send({ content, components: rows });
  for (const { spec } of roles) {
    if (spec.reactionEmoji) await panel.react(spec.reactionEmoji);
  }
  return `Published ${roles.length} self-selectable role button(s) and reaction(s) in #${channel.name}.`;
}
