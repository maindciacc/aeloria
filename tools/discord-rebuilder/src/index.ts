import "dotenv/config";
import {
  ChannelType,
  Client,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type Guild,
  type GuildBasedChannel,
  type ColorResolvable,
  type PermissionResolvable,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { askOllama, initializeLocalServices, initializeVault, loadProjectContext, localConfig, openVault } from "./local-services.js";
import { canManage as policyCanManage, chatAllowed as policyChatAllowed, parseIdSet, removeBotMention, wakeQuestion } from "./policy.js";
import { compareChannels, expectedChannelsFromManifest, formatChannelCheck, type LiveChannel } from "./channel-check.js";
import type { ContentChannelSpec } from "./channel-content.js";
import { channelContentLines } from "./channel-content-runtime.js";
import { roleForReaction, roleNamesMatch, separatorRoles, selfAssignableRoles, validateRoleManifest, type RoleSpec } from "./role-policy.js";
import { applyRoleManifest, assignSeparatorRoles, publishRolePanel, rolePreviewLines, ROLE_PANEL_MARKER } from "./role-runtime.js";

type ChannelSpec = ContentChannelSpec & { topic?: string };
type CategorySpec = {
  name: string;
  private?: boolean;
  staffRoleNames?: string[];
  channels: ChannelSpec[];
};
type Manifest = { roles: RoleSpec[]; categories: CategorySpec[]; roleMenuChannelName?: string };

const requiredEnv = ["DISCORD_TOKEN", "APPLICATION_ID", "GUILD_ID", "OPERATOR_IDS"] as const;
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing ${key}; copy .env.example to .env and fill it in.`);
}

const token = process.env.DISCORD_TOKEN!;
const applicationId = process.env.APPLICATION_ID!;
const guildId = process.env.GUILD_ID!;
const operatorIds = parseIdSet(process.env.OPERATOR_IDS);
const ownerIds = parseIdSet(process.env.OWNER_IDS ?? process.env.OWNER_ID);
let adminMode = process.env.ADMIN_MODE === "true";
let godMode = process.env.GOD_MODE === "true";
let pendingReset: { code: string; expiresAt: number } | undefined;
const mentionChatEnabled = process.env.ENABLE_MENTION_CHAT === "true";
const chatChannelIds = parseIdSet(process.env.CHAT_CHANNEL_IDS);
const ambientTextEnabled = process.env.ENABLE_AMBIENT_TEXT === "true";
const ambientChannelIds = parseIdSet(process.env.AMBIENT_CHANNEL_IDS);
const auditChannelIds = parseIdSet(process.env.AUDIT_CHANNEL_IDS);
const auditMessageLimit = Math.min(100, Math.max(1, Number.parseInt(process.env.AUDIT_MESSAGE_LIMIT ?? "50", 10) || 50));
const autoRoleSeparators = process.env.ENABLE_AUTO_ROLE_SEPARATORS === "true";
const roleMenuChannelId = process.env.ROLE_MENU_CHANNEL_ID?.trim();
if (operatorIds.size === 0) throw new Error("OPERATOR_IDS must contain at least one Discord user ID.");
if (ownerIds.size === 0) throw new Error("OWNER_IDS or OWNER_ID must contain at least one Discord user ID.");
const manifestPath = resolve(process.cwd(), "config/aeloria-server.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const manifestErrors = validateRoleManifest(manifest.roles);
if (manifestErrors.length > 0) throw new Error(`Invalid role manifest:\n${manifestErrors.join("\n")}`);
const repositoryRoot = resolve(process.cwd(), "..", "..");
const local = localConfig(repositoryRoot);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    ...((mentionChatEnabled || ambientTextEnabled || auditChannelIds.size > 0 || roleMenuChannelId) ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : []),
    GatewayIntentBits.GuildMessageReactions,
    ...(autoRoleSeparators ? [GatewayIntentBits.GuildMembers] : []),
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});
const command = new SlashCommandBuilder()
  .setName("aeloria")
  .setDescription("Preview, create, or reconcile the Aeloria Discord structure")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("ask")
      .setDescription("Ask the local Warden assistant about Aeloria")
      .addStringOption((option) => option.setName("question").setDescription("Your question").setRequired(true)),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("vault")
      .setDescription("Initialize or open the Warden's local Obsidian vault")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Vault action")
          .setRequired(true)
          .addChoices({ name: "initialize", value: "initialize" }, { name: "open", value: "open" }),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("roles")
      .setDescription("Manage role sections, self-selectable roles, and the role panel")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Role action")
          .setRequired(true)
          .addChoices(
            { name: "preview", value: "preview" },
            { name: "apply", value: "apply" },
            { name: "publish", value: "publish" },
            { name: "assign-separators", value: "assign-separators" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reset")
      .setDescription("Preview or confirm deletion of manifest-managed resources")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Reset action")
          .setRequired(true)
          .addChoices({ name: "preview", value: "preview" }, { name: "confirm", value: "confirm" }),
      )
      .addStringOption((option) => option.setName("code").setDescription("Confirmation code from reset preview")),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("inventory")
      .setDescription("Inspect visible server structure and flag duplicate channels"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("check")
      .setDescription("Compare visible channels with the repository manifest"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("content")
      .setDescription("Preview or apply channel descriptions and starter posts")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Preview is read-only; apply posts missing starters")
          .setRequired(true)
          .addChoices({ name: "preview", value: "preview" }, { name: "apply", value: "apply" }),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("audit")
      .setDescription("Compare recent configured channel posts with repository guidance"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("god")
      .setDescription("Enable, disable, or inspect owner-only Warden God Mode")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("God Mode action")
          .setRequired(true)
          .addChoices(
            { name: "status", value: "status" },
            { name: "enable", value: "enable" },
            { name: "disable", value: "disable" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("admin")
      .setDescription("Enable, disable, or inspect owner-only Warden admin mode")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Admin mode action")
          .setRequired(true)
          .addChoices(
            { name: "status", value: "status" },
            { name: "enable", value: "enable" },
            { name: "disable", value: "disable" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
       .setDescription("Preview or manage the checked-in setup manifest")
      .addStringOption((option) =>
        option
          .setName("action")
           .setDescription("Preview is read-only; reconcile updates matching resources")
          .setRequired(true)
          .addChoices(
            { name: "preview", value: "preview" },
            { name: "apply", value: "apply" },
             { name: "reconcile", value: "reconcile" },
          ),
      ),
  );

function commandBody(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [command.toJSON()];
}

async function loadAuditPosts(guild: Guild): Promise<string> {
  if (auditChannelIds.size === 0) throw new Error("AUDIT_CHANNEL_IDS is not configured.");
  const sections: string[] = [];
  for (const channelId of auditChannelIds) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !("messages" in channel)) {
      sections.push(`\n--- channel ${channelId}: unavailable or not a text channel ---\n`);
      continue;
    }
    const messages = await channel.messages.fetch({ limit: auditMessageLimit });
    const posts = [...messages.values()]
      .filter((message) => message.content.trim().length > 0)
      .map((message) => `[${message.author.username}] ${message.content.slice(0, 1_000)}`)
      .join("\n");
    sections.push(`\n--- #${channel.name} (${messages.size} recent messages) ---\n${posts || "(no text posts)"}\n`);
  }
  return sections.join("").slice(0, 16_000);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function hasManageGuild(interaction: { memberPermissions: Readonly<{ has: (permission: PermissionResolvable) => boolean }> | null }): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function isOwnerId(id: string): boolean {
  return ownerIds.has(id);
}

function isOwner(interaction: { user: { id: string } }): boolean {
  return isOwnerId(interaction.user.id);
}

function canManage(interaction: { user: { id: string }; memberPermissions: Readonly<{ has: (permission: PermissionResolvable) => boolean }> | null }): boolean {
  return policyCanManage(interaction.user.id, operatorIds, hasManageGuild(interaction), ownerIds, adminMode);
}

function chatAllowed(channelId: string): boolean {
  return policyChatAllowed(channelId, chatChannelIds);
}

function resetTargets(guild: Guild): { roles: typeof guild.roles.cache; categories: GuildBasedChannel[]; channels: GuildBasedChannel[] } {
  const categoryNames = new Set(manifest.categories.map((category) => normalize(category.name)));
  const channelNames = new Set(manifest.categories.flatMap((category) => category.channels.map((channel) => normalize(channel.name))));
  const categories = [...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory && categoryNames.has(normalize(channel.name))).values()];
  const categoryIds = new Set(categories.map((category) => category.id));
  const channels = [...guild.channels.cache.values()].filter((channel) => channelNames.has(normalize(channel.name)) && channel.parentId !== null && categoryIds.has(channel.parentId));
  const roles = guild.roles.cache.filter((role) => manifest.roles.some((spec) => normalize(spec.name) === normalize(role.name)));
  return { roles, categories, channels };
}

function resetPreview(guild: Guild): { code: string; lines: string[] } {
  const targets = resetTargets(guild);
  const code = randomBytes(4).toString("hex").toUpperCase();
  pendingReset = { code, expiresAt: Date.now() + 10 * 60 * 1000 };
  const lines = [
    `Channels to delete: ${targets.channels.length}`,
    `Categories to delete: ${targets.categories.length}`,
    `Roles to delete: ${targets.roles.size}`,
    "Only exact manifest resources are targeted. Deleting a channel also deletes its Discord contents.",
    `Confirm within 10 minutes with code: ${code}`,
  ];
  return { code, lines };
}

async function resetManagedResources(guild: Guild): Promise<string[]> {
  const targets = resetTargets(guild);
  const results: string[] = [];
  for (const channel of targets.channels) {
    await channel.delete("Warden owner-confirmed manifest reset");
    results.push(`Deleted channel: ${channel.name}`);
  }
  for (const category of targets.categories) {
    await category.delete("Warden owner-confirmed manifest reset");
    results.push(`Deleted category: ${category.name}`);
  }
  for (const role of targets.roles.values()) {
    if (role.managed) continue;
    await role.delete("Warden owner-confirmed manifest reset");
    results.push(`Deleted role: ${role.name}`);
  }
  return results;
}

function inventoryLines(guild: Guild): string[] {
  const channelPosition = (channel: GuildBasedChannel): number => "position" in channel && typeof channel.position === "number" ? channel.position : 0;
  const manifestCategoryNames = new Set(manifest.categories.map((category) => normalize(category.name)));
  const manifestChannelNames = new Set(manifest.categories.flatMap((category) => category.channels.map((channel) => normalize(channel.name))));
  const categories = [...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).values()].sort((a, b) => a.position - b.position);
  const channels = [...guild.channels.cache.filter((channel) => channel.type !== ChannelType.GuildCategory).values()];
  const lines = [
    `Visible structure: ${categories.length} categories, ${channels.length} channels`,
    `Manifest matches: ${channels.filter((channel) => manifestChannelNames.has(normalize(channel.name))).length} channels, ${categories.filter((category) => manifestCategoryNames.has(normalize(category.name))).length} categories`,
    "",
  ];
  for (const category of categories) {
    const categoryChannels = channels.filter((channel) => channel.parentId === category.id).sort((a, b) => channelPosition(a) - channelPosition(b));
    lines.push(`${manifestCategoryNames.has(normalize(category.name)) ? "[managed]" : "[unmanaged]"} ${category.name} (${categoryChannels.length} channels)`);
    for (const channel of categoryChannels) {
      lines.push(`  ${manifestChannelNames.has(normalize(channel.name)) ? "[managed]" : "[unmanaged]"} ${channel.type === ChannelType.GuildVoice ? "voice" : "text"} #${channel.name}`);
    }
  }
  const uncategorized = channels.filter((channel) => channel.parentId === null).sort((a, b) => channelPosition(a) - channelPosition(b));
  if (uncategorized.length > 0) {
    lines.push("[uncategorized]");
    for (const channel of uncategorized) lines.push(`  ${channel.type === ChannelType.GuildVoice ? "voice" : "text"} #${channel.name}`);
  }
  const duplicateGroups = new Map<string, string[]>();
  for (const channel of channels) {
    const key = `${channel.parentId ?? "uncategorized"}:${normalize(channel.name)}`;
    const group = duplicateGroups.get(key) ?? [];
    group.push(channel.name);
    duplicateGroups.set(key, group);
  }
  const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1);
  lines.push("", duplicates.length === 0 ? "Duplicate channels: none detected" : `Duplicate channel groups: ${duplicates.length}`);
  for (const group of duplicates) lines.push(`  ${group.join(" | ")}`);
  return lines;
}

function channelCheckLines(guild: Guild): string[] {
  const live: LiveChannel[] = [...guild.channels.cache.values()]
    .filter((channel) => channel.type !== ChannelType.GuildCategory)
    .map((channel) => ({
      name: channel.name,
      type: channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice
        ? "voice"
        : channel.isTextBased()
          ? "text"
          : "other",
      category: channel.parent?.name ?? null,
    }));
  return formatChannelCheck(compareChannels(expectedChannelsFromManifest(manifest), live));
}

function sameNamed<T extends { name: string }>(items: Iterable<T>, name: string): T | undefined {
  return [...items].find((item) => normalize(item.name) === normalize(name));
}

function sameRole<T extends { name: string }>(items: Iterable<T>, spec: RoleSpec): T | undefined {
  return [...items].find((item) => roleNamesMatch(spec, item.name));
}

function sameChannel<T extends { name: string }>(items: Iterable<T>, spec: ChannelSpec): T | undefined {
  const names = [spec.name, ...(spec.legacyNames ?? [])].map(normalize);
  return [...items].find((item) => names.includes(normalize(item.name)));
}

function privateOverwrites(guild: Guild, roleNames: string[]) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    ...roleNames.flatMap((roleName) => {
      const role = sameNamed(guild.roles.cache.values(), roleName);
      return role
        ? [{
            id: role.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          }]
        : [];
    }),
  ];
}

function describePlan(guild: Guild): string[] {
  const lines: string[] = [];
  for (const role of manifest.roles) {
    const existing = sameRole(guild.roles.cache.values(), role);
    lines.push(`${existing ? "✓ exists" : "+ create role"}: ${role.name}`);
  }
  for (const category of manifest.categories) {
    const existingCategory = sameNamed(
      guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).values(),
      category.name,
    );
    lines.push(`${existingCategory ? "✓ exists" : "+ create category"}: ${category.name}${category.private ? " (private)" : ""}`);
    for (const channel of category.channels) {
      const existing = sameChannel(guild.channels.cache.values(), channel);
      lines.push(`  ${existing ? "✓ exists" : "+ create"} ${channel.type}: #${channel.name}`);
    }
    if (category.private) {
      for (const roleName of category.staffRoleNames ?? []) {
        if (!sameNamed(guild.roles.cache.values(), roleName) && !manifest.roles.some((role) => normalize(role.name) === normalize(roleName))) {
          lines.push(`  ! private access role not defined: ${roleName}`);
        }
      }
    }
  }
  return lines;
}

async function applyManifest(guild: Guild, reconcileExisting = false): Promise<string[]> {
  const results: string[] = [];

  for (const spec of manifest.roles) {
    const existingRole = sameRole(guild.roles.cache.values(), spec);
    if (existingRole) {
      if (reconcileExisting && !existingRole.managed) {
        const color = spec.color ?? "#99a4ad";
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid hex color for role ${spec.name}: ${color}`);
        await existingRole.edit({ color: color as ColorResolvable, hoist: spec.hoist ?? false, reason: "Aeloria setup manifest: reconcile role" });
        results.push(`Reconciled existing role: ${spec.name}`);
      } else {
        results.push(`Skipped existing role: ${spec.name}`);
      }
      continue;
    }
    const color = spec.color ?? "#99a4ad";
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid hex color for role ${spec.name}: ${color}`);
    const role = await guild.roles.create({
      name: spec.name,
      color: color as ColorResolvable,
      hoist: spec.hoist ?? false,
      mentionable: false,
      permissions: [],
      reason: "Aeloria setup manifest: create missing role",
    });
    results.push(`Created role: ${role.name}`);
  }

  for (const category of manifest.categories) {
    let categoryChannel = sameNamed(
      guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).values(),
      category.name,
    );
    if (!categoryChannel) {
      categoryChannel = await guild.channels.create({
        name: category.name,
        type: ChannelType.GuildCategory,
        reason: "Aeloria setup manifest: create missing category",
      });
      results.push(`Created category: ${category.name}`);
    } else if (reconcileExisting && categoryChannel.type === ChannelType.GuildCategory && category.private) {
      await categoryChannel.permissionOverwrites.set(
        privateOverwrites(guild, category.staffRoleNames ?? []),
        "Aeloria setup manifest: reconcile private category permissions",
      );
      results.push(`Reconciled existing category: ${category.name}`);
    } else {
      results.push(`Skipped existing category: ${category.name}`);
    }

    for (const spec of category.channels) {
      const existingChannel = sameChannel(guild.channels.cache.values(), spec);
      if (existingChannel) {
        if (reconcileExisting && "setParent" in existingChannel) {
          const editOptions = {
            name: spec.name,
            parent: categoryChannel.id,
            ...(spec.type === "text" && spec.topic ? { topic: spec.topic } : {}),
          };
          await existingChannel.edit(editOptions);
          if (category.private) {
            await existingChannel.permissionOverwrites.set(
              privateOverwrites(guild, category.staffRoleNames ?? []),
              "Aeloria setup manifest: reconcile private channel permissions",
            );
          }
          results.push(`Reconciled existing channel: #${spec.name}`);
        } else {
          results.push(`Skipped existing channel: #${spec.name}`);
        }
        continue;
      }
      const overwrites = category.private ? privateOverwrites(guild, category.staffRoleNames ?? []) : undefined;
      const channelType = spec.type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
      const created = await guild.channels.create({
        name: spec.name,
        type: channelType,
        parent: categoryChannel.id,
        ...(spec.type === "text" && spec.topic ? { topic: spec.topic } : {}),
        ...(overwrites ? { permissionOverwrites: overwrites } : {}),
        reason: "Aeloria setup manifest: create missing channel",
      });
      results.push(`Created ${spec.type} channel: ${created.name}`);
    }
  }
  return results;
}

client.once("ready", async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commandBody() });
  console.log(`Logged in as ${readyClient.user.tag}; setup command registered for guild ${guildId}.`);
  try {
    const services = await initializeLocalServices(local);
    console.log(`Local Warden services ready: vault=${services.vaultInitialized ? "initialized" : "skipped"}, context=${services.contextCharacters} chars, obsidian=${services.obsidianOpened ? "opened" : "not opened"}.`);
    if (services.ollama) console.log(`Ollama startup check: ${services.ollama.detail}.`);
  } catch (error) {
    console.error("Local Warden startup services degraded:", error);
  }
});

if (autoRoleSeparators) {
  client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== guildId) return;
    for (const spec of separatorRoles(manifest.roles)) {
      const role = [...member.guild.roles.cache.values()].find((item) => roleNamesMatch(spec, item.name));
      if (!role || member.roles.cache.has(role.id)) continue;
      try {
        await member.roles.add(role, "Aeloria role sections: assign separator on join");
      } catch (error) {
        console.error(`Could not assign separator role ${role.name} to ${member.user.tag}:`, error);
      }
    }
  });
}

async function handleRoleReaction(reaction: import("discord.js").MessageReaction | import("discord.js").PartialMessageReaction, user: import("discord.js").User | import("discord.js").PartialUser, add: boolean): Promise<void> {
  if (user.bot) return;
  try {
    const resolvedUser = user.partial ? await user.fetch() : user;
    const resolvedReaction = reaction.partial ? await reaction.fetch() : reaction;
    if (resolvedReaction.message.partial) await resolvedReaction.message.fetch();
    const message = resolvedReaction.message;
    if (message.guildId !== guildId || message.author?.id !== client.user?.id || !(message.content ?? "").includes(ROLE_PANEL_MARKER)) return;
    const emoji = resolvedReaction.emoji.name;
    if (!emoji) return;
    const spec = roleForReaction(manifest.roles, emoji);
    if (!spec) return;
    const role = [...message.guild!.roles.cache.values()].find((item) => roleNamesMatch(spec, item.name));
    if (!role) return;
    const member = await message.guild!.members.fetch(resolvedUser.id);
    if (add && !member.roles.cache.has(role.id)) await member.roles.add(role, "Aeloria reaction role assignment");
    if (!add && member.roles.cache.has(role.id)) await member.roles.remove(role, "Aeloria reaction role removal");
  } catch (error) {
    console.error("Warden reaction role operation failed:", error);
  }
}

client.on("messageReactionAdd", (reaction, user) => handleRoleReaction(reaction, user, true));
client.on("messageReactionRemove", (reaction, user) => handleRoleReaction(reaction, user, false));

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("aeloria-role:")) {
    if (interaction.guildId !== guildId || !interaction.guild) {
      await interaction.reply({ content: "This role panel belongs to The Forgotten Ring server only.", ephemeral: true });
      return;
    }
    const index = Number.parseInt(interaction.customId.slice("aeloria-role:".length), 10);
    const spec = Number.isInteger(index) ? manifest.roles[index] : undefined;
    if (!spec || !spec.selfAssignable || spec.kind !== "self-selectable") {
      await interaction.reply({ content: "That role is not available for self-selection.", ephemeral: true });
      return;
    }
    const role = [...interaction.guild.roles.cache.values()].find((item) => roleNamesMatch(spec, item.name));
    if (!role) {
      await interaction.reply({ content: "That role has not been created yet. Ask an operator to apply the role manifest.", ephemeral: true });
      return;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, "Aeloria self-selectable role removal");
      await interaction.reply({ content: `Removed **${role.name}** from your roles.`, ephemeral: true });
    } else {
      await member.roles.add(role, "Aeloria self-selectable role assignment");
      await interaction.reply({ content: `Added **${role.name}** to your roles.`, ephemeral: true });
    }
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== "aeloria") return;
  if (interaction.guildId !== guildId || !interaction.guild) {
    await interaction.reply({ content: "This bot is configured for the Aeloria server only.", ephemeral: true });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "god") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can change God Mode.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action");
    if (!action) {
      await interaction.reply({ content: "Choose an action: status, enable, or disable.", ephemeral: true });
      return;
    }
    if (action === "enable") godMode = true;
    if (action === "disable") godMode = false;
    await interaction.reply({ content: `Warden God Mode is **${godMode ? "enabled" : "disabled"}** for this process.`, ephemeral: true });
    return;
  }
  if (subcommand === "reset") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can reset managed resources.", ephemeral: true });
      return;
    }
    const resetAction = interaction.options.getString("action");
    if (!resetAction) {
      await interaction.reply({ content: "Choose reset preview or confirm.", ephemeral: true });
      return;
    }
    if (resetAction === "preview") {
      const preview = resetPreview(interaction.guild);
      await interaction.reply({ content: ["**Managed reset preview** — no changes made.", ...preview.lines].join("\n"), ephemeral: true });
      return;
    }
    const code = interaction.options.getString("code")?.trim().toUpperCase();
    if (!pendingReset || pendingReset.expiresAt < Date.now() || code !== pendingReset.code) {
      await interaction.reply({ content: "Reset confirmation is missing, expired, or incorrect. Run reset preview again.", ephemeral: true });
      return;
    }
    pendingReset = undefined;
    await interaction.deferReply({ ephemeral: true });
    try {
      const results = await resetManagedResources(interaction.guild);
      await interaction.editReply(["**Managed reset complete.** Unrelated resources were left untouched.", ...results].join("\n").slice(0, 1900));
    } catch (error) {
      console.error("Managed reset failed:", error);
      await interaction.editReply("Reset stopped after an error. Review the server before retrying; some earlier resources may already have been deleted.");
    }
    return;
  }
  if (subcommand === "inventory") {
    if (!canManage(interaction)) {
      await interaction.reply({ content: "You are not authorized to inspect the server inventory.", ephemeral: true });
      return;
    }
    const chunks: string[] = [];
    let current = "**The Forgotten Ring server inventory** — visible structure only; no changes made.\n";
    for (const line of inventoryLines(interaction.guild)) {
      if (current.length + line.length + 1 > 1800) {
        chunks.push(current);
        current = "";
      }
      current += `${line}\n`;
    }
    if (current) chunks.push(current);
    await interaction.reply({ content: chunks.shift() ?? "No visible channels found.", ephemeral: true });
    for (const chunk of chunks) await interaction.followUp({ content: chunk, ephemeral: true });
    return;
  }
  if (subcommand === "check") {
    if (!canManage(interaction)) {
      await interaction.reply({ content: "You are not authorized to check the repository channel manifest.", ephemeral: true });
      return;
    }
    const chunks: string[] = [];
    let current = "**The Forgotten Ring repository channel check** — read-only; no changes made.\n";
    for (const line of channelCheckLines(interaction.guild)) {
      if (current.length + line.length + 1 > 1800) {
        chunks.push(current);
        current = "";
      }
      current += `${line}\n`;
    }
    if (current) chunks.push(current);
    await interaction.reply({ content: chunks.shift() ?? "No visible channels found.", ephemeral: true });
    for (const chunk of chunks) await interaction.followUp({ content: chunk, ephemeral: true });
    return;
  }
  if (subcommand === "content") {
    if (!canManage(interaction)) {
      await interaction.reply({ content: "You are not authorized to manage channel starter content.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action");
    if (!action) {
      await interaction.reply({ content: "Choose content preview or apply.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const lines = await channelContentLines(interaction.guild, manifest, action === "apply");
      const chunks: string[] = [];
      let current = "";
      for (const line of lines) {
        if (current.length + line.length + 1 > 1800) {
          chunks.push(current);
          current = "";
        }
        current += `${line}\n`;
      }
      if (current) chunks.push(current);
      await interaction.editReply(chunks.shift() ?? "No manifest channels found.");
      for (const chunk of chunks) await interaction.followUp({ content: chunk, ephemeral: true });
    } catch (error) {
      console.error("Warden channel content operation failed:", error);
      await interaction.editReply("Channel content operation failed. Check the bot's View Channel, Read Message History, Send Messages, and Manage Channel permissions.");
    }
    return;
  }
  if (subcommand === "roles") {
    if (!canManage(interaction)) {
      await interaction.reply({ content: "You are not authorized to manage community roles.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action");
    if (!action) {
      await interaction.reply({ content: "Choose role preview, apply, publish, or assign-separators.", ephemeral: true });
      return;
    }
    if (action === "preview") {
      await interaction.reply({ content: rolePreviewLines(interaction.guild, manifest).join("\n").slice(0, 1900), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      let results: string[];
      if (action === "apply") {
        results = await applyRoleManifest(interaction.guild, manifest);
        if (autoRoleSeparators) results.push(...await assignSeparatorRoles(interaction.guild, manifest));
      }
      else if (action === "assign-separators") results = await assignSeparatorRoles(interaction.guild, manifest);
      else results = [await publishRolePanel(interaction.guild, manifest, roleMenuChannelId, client.user?.id)];
      await interaction.editReply(results.join("\n").slice(0, 1900));
    } catch (error) {
      console.error("Warden role operation failed:", error);
      await interaction.editReply("Role operation failed. Check Manage Roles, role hierarchy, member intent, and ROLE_MENU_CHANNEL_ID.");
    }
    return;
  }
  if (subcommand === "audit") {
    if (!canManage(interaction)) {
      await interaction.reply({ content: "You are not authorized to audit server posts.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const posts = await loadAuditPosts(interaction.guild);
      const context = await loadProjectContext(local);
      const question = [
        "Compare the following recent Discord posts with the repository reference material.",
        "Return a concise audit with: aligned items, possible contradictions, unsupported claims, and recommended human review.",
        "Do not treat posts as canon. Do not edit or delete anything.",
        `Recent posts:\n${posts}`,
      ].join("\n\n");
      const answer = await askOllama(local, question, context);
      await interaction.editReply(answer.slice(0, 1900));
    } catch (error) {
      console.error("Warden content audit failed:", error);
      await interaction.editReply("The content audit failed. Check AUDIT_CHANNEL_IDS, Read Message History, Message Content Intent, and local Ollama.");
    }
    return;
  }
  if (subcommand === "admin") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can change admin mode.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action");
    if (!action) {
      await interaction.reply({ content: "Choose an action: status, enable, or disable.", ephemeral: true });
      return;
    }
    if (action === "enable") adminMode = true;
    if (action === "disable") adminMode = false;
    await interaction.reply({ content: `Warden admin mode is **${adminMode ? "enabled" : "disabled"}** for this process.`, ephemeral: true });
    return;
  }
  if (subcommand === "ask") {
    if (!chatAllowed(interaction.channelId)) {
      await interaction.reply({ content: "The Warden is not enabled for chat in this channel.", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    try {
      const context = await loadProjectContext(local);
      const answer = await askOllama(local, interaction.options.getString("question", true), context);
      await interaction.editReply(answer.slice(0, 1900));
    } catch (error) {
      console.error("Warden chat failed:", error);
      await interaction.editReply("The local Warden assistant is unavailable. Check that Ollama is running and the configured model is installed.");
    }
    return;
  }
  if (subcommand === "vault") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can manage the local vault.", ephemeral: true });
      return;
    }
    try {
      const action = interaction.options.getString("action");
      if (!action) {
        await interaction.reply({ content: "Choose an action: initialize or open.", ephemeral: true });
        return;
      }
      if (action === "initialize") {
        const folders = await initializeVault(local);
        await interaction.reply({ content: `Initialized the local Warden vault with ${folders.length} folders at ${local.vaultPath}.`, ephemeral: true });
      } else {
        await initializeVault(local);
        await openVault(local);
        await interaction.reply({ content: "Opened the local Warden vault.", ephemeral: true });
      }
    } catch (error) {
      console.error("Warden vault operation failed:", error);
      await interaction.reply({ content: "The local vault operation failed. Check OBSIDIAN_VAULT_PATH and OBSIDIAN_OPEN_COMMAND.", ephemeral: true });
    }
    return;
  }
  if (!canManage(interaction)) {
    await interaction.reply({ content: "You are not authorized to use this setup command.", ephemeral: true });
    return;
  }
  const action = interaction.options.getString("action");
  if (!action) {
    await interaction.reply({ content: "Choose an action: preview, apply, or reconcile.", ephemeral: true });
    return;
  }
  if (action === "preview") {
    const lines = describePlan(interaction.guild);
    const message = ["**Aeloria setup preview** — read-only; no changes made.", ...lines].join("\n");
    await interaction.reply({ content: message.slice(0, 1900), ephemeral: true });
    return;
  }
  if (action !== "apply" && action !== "reconcile") return;

  await interaction.deferReply({ ephemeral: true });
  try {
    const reconcile = action === "reconcile";
    const results = await applyManifest(interaction.guild, reconcile);
    const message = [reconcile ? "**Reconciliation complete.** Matching resources were updated; unrelated resources were left untouched." : "**Setup complete.** Existing resources were left untouched.", ...results].join("\n");
    await interaction.editReply(message.slice(0, 1900));
  } catch (error) {
    console.error("Aeloria setup failed:", error);
    await interaction.editReply("Setup stopped after an error. Some earlier missing resources may already have been created; review the server and run preview again before retrying.");
  }
});

if (mentionChatEnabled || ambientTextEnabled) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || message.guildId !== guildId) return;
    const mention = new RegExp(`<@!?${client.user?.id ?? "0"}>`, "g");
    const addressedByMention = mentionChatEnabled && chatAllowed(message.channelId) && mention.test(message.content);
    const questionFromWakePhrase = wakeQuestion(message.content);
    const addressedByWakePhrase = ambientTextEnabled && godMode && isOwnerId(message.author.id) && ambientChannelIds.has(message.channelId) && Boolean(questionFromWakePhrase);
    if (!addressedByMention && !addressedByWakePhrase) return;
    const question = addressedByWakePhrase ? questionFromWakePhrase! : removeBotMention(message.content, client.user?.id ?? "0");
    if (!question) return;
    try {
      const context = await loadProjectContext(local);
      const answer = await askOllama(local, question, context);
      await message.reply(answer.slice(0, 1900));
    } catch (error) {
      console.error("Warden mention chat failed:", error);
      await message.reply("The local Warden assistant is unavailable right now.");
    }
  });
}

client.login(token).catch((error: unknown) => {
  console.error("Could not log in to Discord:", error);
  process.exitCode = 1;
});
