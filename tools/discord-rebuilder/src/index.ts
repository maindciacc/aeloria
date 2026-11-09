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
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { askOllama, askWarden, initializeLocalServices, initializeVault, loadProjectContext, localConfig, openVault } from "./local-services.js";
import { canManage as policyCanManage, chatAllowed as policyChatAllowed, containsExactName, parseIdSet, removeBotMention, wakeQuestion } from "./policy.js";
import { compareChannels, expectedChannelsFromManifest, formatChannelCheck, type LiveChannel } from "./channel-check.js";
import { compareServer, formatServerAnalysis, type LiveCategory, type LiveRole } from "./server-analysis.js";
import type { ContentChannelSpec } from "./channel-content.js";
import { channelContentLines } from "./channel-content-runtime.js";
import { roleForReaction, roleNamesMatch, separatorRoles, selfAssignableRoles, validateRoleManifest, type RoleSpec } from "./role-policy.js";
import { applyRoleManifest, assignSeparatorRoles, publishRolePanel, rolePreviewLines, ROLE_PANEL_MARKER } from "./role-runtime.js";
import { deletionProposalValid, isDeletionCancellation, isDeletionConfirmation, type ConversationDeletionProposal } from "./conversation-policy.js";
import { recordLoreApproval, writeLoreDraft } from "./lore-workflow.js";
import { createDashboardServer, dashboardConfig } from "./dashboard.js";
import { canAcceptRules, canRunSafetyWorkflow, createSmokeTestPlan, isBotAccount, LOCKDOWN_CATEGORY_NAME, LOCKDOWN_HOLDING_CHANNEL_NAME, LOCKDOWN_NOTICEBOARD_CHANNEL_NAME, LOCKDOWN_ROLE_NAME, LOCKDOWN_STAFF_CHANNEL_NAME, LOCKDOWN_STAFF_ROLE_NAMES, SMOKE_TEST_MARKER } from "./safety-workflows.js";
import { formatRolloutResults, runRollout } from "./rollout.js";
import { conversationIntent, explicitCancellation, explicitConfirmation, type ConversationIntent } from "./conversation-intent.js";
import { DEFAULT_SETUP_SETTINGS, loadSetupSettings, mergeSetupSettings, saveSetupSettings, setupSettingsHelp, type SetupSettings } from "./setup-settings.js";
import { bootstrapChannelId, bootstrapWelcomeMessage, isFirstRunBlankGuild } from "./bootstrap.js";
import { checkGameServer, DEFAULT_GAME_MONITOR_SETTINGS, type GameMonitorStatus } from "./game-monitor.js";
import { recoveryGameAlert, seriousGameAlert, shouldAnnounce } from "./alerting.js";
import { hubPermissionPolicy, isCommunicationHub } from "./hub-policy.js";

type ChannelSpec = ContentChannelSpec & { topic?: string };
type CategorySpec = {
  name: string;
  private?: boolean;
  staffRoleNames?: string[];
  channels: ChannelSpec[];
};
type DashboardControls = {
  smoke: (action: string, report?: (line: string) => void) => Promise<string[]>;
  lockdown: (action: string) => Promise<string[]>;
  setup: (action: string, update?: Partial<SetupSettings>) => Promise<string[]>;
  setupChat: (question: string, confirmation?: boolean, cancellation?: boolean) => Promise<string[]>;
  restart: () => Promise<string[]>;
};
type Manifest = {
  roles: RoleSpec[];
  categories: CategorySpec[];
  roleMenuChannelName?: string;
  onboarding?: { rulesChannelName: string; wandererRoleName: string; settlerRoleName: string; acceptancePhrases?: string[] };
};

const requiredEnv = ["DISCORD_TOKEN", "APPLICATION_ID", "GUILD_ID", "OPERATOR_IDS"] as const;
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing ${key}; copy .env.example to .env and fill it in.`);
}

async function protectCommunicationHub(guild: Guild): Promise<void> {
  const hub = communicationHub(guild);
  if (!hub || !client.user) return;
  const policy = hubPermissionPolicy(guild.id, ownerIds, client.user.id);
  try {
    const allowedUsers = (await Promise.all(policy.allowedUserIds.map(async (id) => {
      if (id === client.user?.id) return client.user;
      return guild.members.fetch(id).then((member) => member.user).catch(() => undefined);
    }))).filter((user): user is NonNullable<typeof user> => Boolean(user));
    await hub.permissionOverwrites.set([
      {
        id: guild.roles.everyone,
        deny: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageWebhooks,
        ],
      },
      ...allowedUsers.map((user) => ({ id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ], "Warden communication hub: owner and bot only");
  } catch (error) {
    console.error(`Unable to lock communication hub #${hub.name}:`, error);
  }
}

function blankGuildSnapshot(guild: Guild) {
  return {
    textChannelCount: guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).size,
    categoryCount: guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size,
    humanRoleCount: guild.roles.cache.filter((role) => !role.managed && role.id !== guild.id).size,
    botManagedRoleCount: guild.roles.cache.filter((role) => role.managed).size,
  };
}

async function initializeFirstRunBootstrap(guild: Guild): Promise<boolean> {
  const channel = [...guild.channels.cache.values()].find((item) => item.type === ChannelType.GuildText);
  if (!channel || !isFirstRunBlankGuild(blankGuildSnapshot(guild))) return false;
  setupSettings = mergeSetupSettings(setupSettings, { bootstrapChannelId: bootstrapChannelId(setupSettings.bootstrapChannelId, channel.id), communicationHubChannelId: channel.id, welcomeChannelName: channel.name, autoSetupOnReady: false });
  await saveSetupSettings(local.workspacePath, setupSettings);
  const messages = await channel.messages.fetch({ limit: 50 });
  if (![...messages.values()].some((message) => message.author.id === client.user?.id && message.content.includes("<!-- aeloria-warden-bootstrap:v1 -->"))) {
    await channel.send(bootstrapWelcomeMessage());
  }
    if (guild) {
      await monitorGameServer(guild);
      clearInterval(monitorTimer);
      const interval = setupSettings.gameMonitor?.intervalMs ?? DEFAULT_GAME_MONITOR_SETTINGS.intervalMs;
      monitorTimer = setInterval(() => void monitorGameServer(guild).catch((error) => console.error("Game-server monitoring failed:", error)), interval);
    }
  return true;
}

function manifestTextChannels(guild: Guild): GuildBasedChannel[] {
  const result: GuildBasedChannel[] = [];
  for (const category of manifest.categories) {
    const parent = [...guild.channels.cache.values()].find((channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(category.name));
    if (!parent) continue;
    for (const spec of category.channels.filter((item) => item.type === "text")) {
      const channel = [...guild.channels.cache.values()].find((item) => item.parentId === parent.id && item.type === ChannelType.GuildText && [spec.name, ...(spec.legacyNames ?? [])].some((name) => normalize(name) === normalize(item.name)));
      if (channel) result.push(channel);
    }
  }
  return result;
}

async function runSmokeTest(guild: Guild, action: string, report?: (line: string) => void): Promise<string[]> {
  const channels = manifestTextChannels(guild);
  const roleNames = manifest.roles.filter((role) => role.kind === "self-selectable" || role.kind === "onboarding").map((role) => role.name);
  report?.(`Smoke test started: ${action}. Found ${channels.length} manifest text channel(s).`);
  if (action === "preview") {
    const lines = createSmokeTestPlan(channels.map((channel) => `#${channel.name}`), roleNames).map((step) => `${step.destructive ? "!" : "✓"} ${step.name} -> ${step.target}`);
    report?.("Smoke preview complete; no Discord changes were made.");
    return lines;
  }
  if (action === "cleanup") {
    let removed = 0;
    for (const channel of channels) {
      if (!channel.isTextBased() || !("messages" in channel)) continue;
      const messages = await channel.messages.fetch({ limit: 100 });
      for (const message of messages.values()) {
        if (message.author.id === client.user?.id && message.content.includes(SMOKE_TEST_MARKER)) {
          await message.delete();
          removed += 1;
        }
      }
    }
    smokeTestMessages.clear();
    report?.(`Smoke cleanup complete: removed ${removed} marked message(s).`);
    return [`Removed ${removed} marked smoke-test message(s).`];
  }
  const timestamp = new Date().toISOString();
  let posted = 0;
  const failures: string[] = [];
  for (const channel of channels) {
    report?.(`Testing ${channel.name} (${posted + failures.length + 1}/${channels.length})...`);
    try {
      if (!channel.isTextBased() || !("send" in channel) || typeof channel.send !== "function") continue;
      const message = await channel.send(`${SMOKE_TEST_MARKER}\n**Warden smoke test** — diagnostic post only. Target: #${channel.name}. Timestamp: ${timestamp}`);
      smokeTestMessages.add(message.id);
      posted += 1;
    } catch (error) {
      failures.push(`#${channel.name}: ${error instanceof Error ? error.message : "send failed"}`);
    }
  report?.(`Smoke post phase complete: ${posted} posted, ${failures.length} failed.`);
  }
  return [`Posted marked smoke-test messages to ${posted}/${channels.length} manifest text channel(s).`, ...(failures.length > 0 ? ["Failures:", ...failures] : []), "Run smoke cleanup after review to remove only marked diagnostic posts."];
}

async function setLockdown(guild: Guild, enabled: boolean): Promise<string[]> {
  const everyone = guild.roles.everyone;
  let changed = 0;
  const failures: string[] = [];
  let lockdownRole = [...guild.roles.cache.values()].find((role) => normalize(role.name) === normalize(LOCKDOWN_ROLE_NAME));
  if (enabled && !lockdownRole) {
    lockdownRole = await guild.roles.create({ name: LOCKDOWN_ROLE_NAME, color: "#d32f2f", hoist: false, mentionable: false, permissions: [], reason: "Warden emergency lockdown role" });
  }
  const staffRoles = LOCKDOWN_STAFF_ROLE_NAMES.map((name) => sameNamed(guild.roles.cache.values(), name)).filter((role): role is NonNullable<typeof role> => Boolean(role));
  const staffRoleOverwrites = staffRoles.map((role) => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.MentionEveryone] }));
  const protocolCategory = enabled
    ? ([...guild.channels.cache.values()].find((channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(LOCKDOWN_CATEGORY_NAME)) ?? await guild.channels.create({ name: LOCKDOWN_CATEGORY_NAME, type: ChannelType.GuildCategory, reason: "Warden emergency lockdown protocol category" }))
    : [...guild.channels.cache.values()].find((channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(LOCKDOWN_CATEGORY_NAME));
  const protocolChannels = new Map<string, import("discord.js").TextChannel>();
  if (enabled && protocolCategory?.type === ChannelType.GuildCategory && lockdownRole) {
    for (const name of [LOCKDOWN_STAFF_CHANNEL_NAME, LOCKDOWN_NOTICEBOARD_CHANNEL_NAME, LOCKDOWN_HOLDING_CHANNEL_NAME]) {
      const channel = [...guild.channels.cache.values()].find((item) => item.type === ChannelType.GuildText && item.parentId === protocolCategory.id && normalize(item.name) === normalize(name));
      const textChannel = channel?.type === ChannelType.GuildText ? channel : await guild.channels.create({ name, type: ChannelType.GuildText, parent: protocolCategory.id, reason: "Warden emergency lockdown protocol channel" });
      protocolChannels.set(name, textChannel);
    }
  }
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    if (isCommunicationHub(channel.id, setupSettings.communicationHubChannelId)) continue;
    const protocol = enabled && channel.parentId === protocolCategory?.id;
    const holding = protocol && channel.name === LOCKDOWN_HOLDING_CHANNEL_NAME;
    try {
      if (enabled && lockdownRole) {
        const overwrites = [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.MentionEveryone] },
          { id: lockdownRole.id, ...(holding ? { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.AddReactions, PermissionFlagsBits.UseExternalEmojis, PermissionFlagsBits.MentionEveryone] } : { deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.MentionEveryone] }) },
          ...(!protocol ? staffRoleOverwrites : []),
          ...(protocol && !holding ? staffRoleOverwrites : []),
        ];
        if (protocol && holding) overwrites.push(...staffRoleOverwrites as typeof overwrites);
        await channel.permissionOverwrites.set(overwrites, "Warden emergency lockdown protocol permissions");
      } else if (!enabled) {
        const protocol = channel.parentId === protocolCategory?.id;
        if (protocol) {
          await channel.permissionOverwrites.set([], "Warden emergency lockdown protocol closed");
        } else {
          const managedIds = new Set([
            everyone.id,
            lockdownRole?.id,
            ...staffRoles.map((role) => role.id),
          ].filter((id): id is string => Boolean(id)));
          for (const overwrite of channel.permissionOverwrites.cache.values()) {
            if (managedIds.has(overwrite.id)) await channel.permissionOverwrites.delete(overwrite.id, "Warden emergency lockdown lifted");
          }
        }
      }
      changed += 1;
    } catch (error) {
      failures.push(`#${channel.name}: ${error instanceof Error ? error.message : "permission update failed"}`);
    }
  }
  if (!enabled && protocolCategory?.type === ChannelType.GuildCategory) {
    try {
      await protocolCategory.permissionOverwrites.set([], "Warden emergency lockdown protocol closed");
      await protocolCategory.edit({ permissionOverwrites: [{ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] }], reason: "Warden emergency lockdown protocol hidden" });
    } catch (error) {
      failures.push(`Lockdown protocol category cleanup: ${error instanceof Error ? error.message : "cleanup failed"}`);
    }
  }
  if (!enabled && lockdownRole) {
    try {
      const members = await guild.members.fetch();
      for (const member of members.values()) {
        if (member.roles.cache.has(lockdownRole.id)) await member.roles.remove(lockdownRole, "Warden emergency lockdown lifted");
      }
      await lockdownRole.delete("Warden emergency lockdown lifted");
    } catch (error) {
      failures.push(`Lockdown role cleanup: ${error instanceof Error ? error.message : "cleanup failed"}`);
    }
  }
  if (enabled && lockdownRole) {
    try {
      const members = await guild.members.fetch();
      for (const member of members.values()) {
        const isStaff = member.roles.cache.some((role) => staffRoles.some((staff) => staff.id === role.id));
        if (!member.user.bot && !ownerIds.has(member.id) && !isStaff) await member.roles.add(lockdownRole, "Warden emergency lockdown role");
      }
      const noticeboard = protocolChannels.get(LOCKDOWN_NOTICEBOARD_CHANNEL_NAME);
      const holding = protocolChannels.get(LOCKDOWN_HOLDING_CHANNEL_NAME);
      const notice = "🚨 **Lockdown protocol active**\n\nThere has been an issue and the team is investigating. Regular updates will be posted here. Please do not share sensitive information, credentials, private logs, or unverified claims. Members may use the holding area for text-only questions while work is underway.";
      if (noticeboard) {
        const existing = await noticeboard.messages.fetch({ limit: 50 });
        const pinned = [...existing.values()].find((message) => message.author.id === client.user?.id && message.content.includes("Lockdown protocol active"));
        if (!pinned) {
          const message = await noticeboard.send(notice);
          await message.pin("Warden emergency lockdown notice");
        }
      }
      if (holding) {
        const existing = await holding.messages.fetch({ limit: 50 });
        if (![...existing.values()].some((message) => message.author.id === client.user?.id && message.content.includes("Holding area open"))) {
          await holding.send("**Holding area open.** Keep discussion text-only and do not post secrets. Warden and staff will provide safe updates in the red-alert noticeboard.");
        }
      }
    } catch (error) {
      failures.push(`Lockdown role/protocol setup: ${error instanceof Error ? error.message : "setup failed"}`);
    }
  }
  lockdownEnabled = enabled;
  return [`Emergency lockdown ${enabled ? "enabled" : "disabled"}; ${enabled ? "members are restricted to the text holding area and staff protocol channels" : "managed lockdown overwrites were removed"}.`, `${changed} text channel(s) reconciled.`, ...(failures.length > 0 ? ["Failures:", ...failures] : [])];
}

async function runLockdownAction(guild: Guild, action: string): Promise<string[]> {
  if (action === "status") return [`Emergency lockdown is **${lockdownEnabled ? "enabled" : "disabled"}** for this process.`];
  return setLockdown(guild, action === "enable");
}

function onboardingRole(guild: Guild, name: string): import("discord.js").Role | undefined {
  return [...guild.roles.cache.values()].find((role) => normalize(role.name) === normalize(name));
}

async function rollout(guild: Guild, execute: boolean): Promise<string[]> {
  if (!execute) {
    return ["**Aeloria rollout preview** — read-only; this command never wipes the server.", ...describePlan(guild), "Stages: structure → roles → content → role-panel → onboarding."];
  }
  const results = await runRollout(async (stage) => {
    if (stage === "structure") return applyManifest(guild, false);
    if (stage === "roles") return applyRoleManifest(guild, manifest);
    if (stage === "content") return channelContentLines(guild, manifest, true);
    if (stage === "role-panel") return [await publishRolePanel(guild, manifest, roleMenuChannelId, client.user?.id)];
    if (autoRoleSeparators) return assignSeparatorRoles(guild, manifest);
    return ["Separator assignment disabled; onboarding roles remain available for rules acceptance."];
  });
  return formatRolloutResults(results);
}

const token = process.env.DISCORD_TOKEN!;
const applicationId = process.env.APPLICATION_ID!;
const guildId = process.env.GUILD_ID!;
const operatorIds = parseIdSet(process.env.OPERATOR_IDS);
const ownerIds = parseIdSet(process.env.OWNER_IDS ?? process.env.OWNER_ID);
const alertUserIds = parseIdSet(process.env.ALERT_USER_IDS);
let adminMode = process.env.ADMIN_MODE === "true";
let godMode = process.env.GOD_MODE === "true";
let pendingReset: { code: string; expiresAt: number; resourceIds: string[] } | undefined;
let pendingConversationDeletion: ConversationDeletionProposal | undefined;
type PendingConversationAction = Extract<ConversationIntent, { kind: "rollout-request" | "lockdown-request" | "smoke-run" | "smoke-cleanup" }>;
let pendingConversationAction: { ownerId: string; guildId: string; channelId: string; intent: PendingConversationAction; expiresAt: number } | undefined;
let lockdownEnabled = false;
const smokeTestMessages = new Set<string>();
const mentionChatEnabled = process.env.ENABLE_MENTION_CHAT !== "false";
const conversationModeEnabled = process.env.ENABLE_CONVERSATION_MODE !== "false";
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
const dashboard = dashboardConfig(repositoryRoot);
let setupSettings: SetupSettings = { ...DEFAULT_SETUP_SETTINGS };
let pendingSetupSettings: { ownerId: string; guildId: string; channelId: string; update: Partial<SetupSettings>; expiresAt: number } | undefined;
let previousGameHealthy: boolean | undefined;
let monitorTimer: NodeJS.Timeout | undefined;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    ...((conversationModeEnabled || mentionChatEnabled || ambientTextEnabled || auditChannelIds.size > 0 || roleMenuChannelId) ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : []),
    GatewayIntentBits.GuildMessageReactions,
    ...(autoRoleSeparators ? [GatewayIntentBits.GuildMembers] : []),
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});
const command = new SlashCommandBuilder()
  .setName("aeloria")
  .setDescription("Preview, create, or reconcile the Aeloria Discord structure")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("ask")
      .setDescription("Ask the local Warden assistant about Aeloria")
      .addStringOption((option) => option.setName("question").setDescription("Your question").setRequired(true)),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("lore")
      .setDescription("Draft, review, or explicitly approve Aeloria lore")
      .addStringOption((option) => option.setName("action").setDescription("Lore action").setRequired(true).addChoices(
        { name: "draft", value: "draft" },
        { name: "review", value: "review" },
        { name: "approve", value: "approve" },
      ))
      .addStringOption((option) => option.setName("title").setDescription("Draft title or filename").setRequired(true))
      .addStringOption((option) => option.setName("content").setDescription("Lore proposal content for draft/approve").setRequired(false)),
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
      .setName("smoke")
      .setDescription("Run or clean up an owner-only marked full-system smoke test")
      .addStringOption((option) => option.setName("action").setDescription("Smoke test action").setRequired(true).addChoices(
        { name: "preview", value: "preview" },
        { name: "run", value: "run" },
        { name: "cleanup", value: "cleanup" },
      )),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("rollout")
      .setDescription("Preview or execute the owner-only clean-slate Aeloria deployment")
      .addStringOption((option) => option.setName("action").setDescription("Rollout action").setRequired(true).addChoices(
        { name: "preview", value: "preview" },
        { name: "execute", value: "execute" },
      )),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("lockdown")
      .setDescription("Enable, disable, or inspect owner-only emergency lockdown")
      .addStringOption((option) => option.setName("action").setDescription("Lockdown action").setRequired(true).addChoices(
        { name: "status", value: "status" },
        { name: "enable", value: "enable" },
        { name: "disable", value: "disable" },
      )),
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
      .setName("analyze")
      .setDescription("Analyze visible Discord categories, channels, and roles against the repository"),
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

function communicationHub(guild: Guild): import("discord.js").TextChannel | undefined {
  const byId = setupSettings.communicationHubChannelId ? guild.channels.cache.get(setupSettings.communicationHubChannelId) : undefined;
  if (byId?.type === ChannelType.GuildText) return byId;
  const byBootstrap = setupSettings.bootstrapChannelId ? guild.channels.cache.get(setupSettings.bootstrapChannelId) : undefined;
  if (byBootstrap?.type === ChannelType.GuildText) return byBootstrap;
  const byWelcome = welcomeChannel(guild);
  return byWelcome;
}

async function announceGameStatus(guild: Guild, status: GameMonitorStatus): Promise<void> {
  if (!shouldAnnounce(previousGameHealthy, status.healthy)) return;
  previousGameHealthy = status.healthy;
  const hub = communicationHub(guild);
  if (!hub) return;
  await hub.send(status.healthy ? recoveryGameAlert(status, setupSettings) : seriousGameAlert(status, setupSettings));
}

async function monitorGameServer(guild: Guild): Promise<void> {
  const settings = setupSettings.gameMonitor ?? DEFAULT_GAME_MONITOR_SETTINGS;
  if (!settings.enabled) return;
  await announceGameStatus(guild, await checkGameServer(settings));
}

function welcomeChannel(guild: Guild): import("discord.js").TextChannel | undefined {
  const channel = [...guild.channels.cache.values()].find((item) => item.type === ChannelType.GuildText && normalize(item.name) === normalize(setupSettings.welcomeChannelName));
  return channel?.type === ChannelType.GuildText ? channel : undefined;
}

async function postWelcomePackage(guild: Guild, lines: string[]): Promise<string[]> {
  if (!setupSettings.postWelcomePackage) return ["Welcome package posting is disabled in setup settings."];
  const channel = welcomeChannel(guild);
  if (!channel) return [`Welcome channel not found: ${setupSettings.welcomeChannelName}`];
  const existing = await channel.messages.fetch({ limit: 50 });
  if ([...existing.values()].some((message) => message.author.id === client.user?.id && message.content.includes("<!-- aeloria-warden-welcome-package:v1 -->"))) {
    return [`Welcome package already exists in #${channel.name}; skipped duplicate post.`];
  }
  await channel.send([
    "<!-- aeloria-warden-welcome-package:v1 -->",
    "**Welcome to Aeloria — The Forgotten Ring**",
    "Warden is online. Start with 📜・rules, accept them there, then use 🎭・choose-your-roles to choose your contribution paths.",
    "This setup is manifest-driven and safe to rerun. Discuss changes with Warden here; destructive actions always require explicit owner confirmation.",
    "",
    ...lines.slice(0, 12),
  ].join("\n"));
  return [`Posted the managed welcome package in #${channel.name}.`];
}

async function runWelcomeSetup(guild: Guild): Promise<string[]> {
  if (setupSettings.bootstrapChannelId) {
    const bootstrap = guild.channels.cache.get(setupSettings.bootstrapChannelId);
    const welcomeSpec = manifest.categories.flatMap((category) => category.channels).find((channel) => channel.name.includes("welcome") && channel.type === "text");
    if (bootstrap?.type === ChannelType.GuildText && welcomeSpec) {
      if (!isCommunicationHub(bootstrap.id, setupSettings.communicationHubChannelId)) {
        await bootstrap.edit({ name: welcomeSpec.name, topic: welcomeSpec.topic, reason: "Aeloria first-run bootstrap: promote setup channel to welcome channel" });
        setupSettings = mergeSetupSettings(setupSettings, { welcomeChannelName: welcomeSpec.name });
        await saveSetupSettings(local.workspacePath, setupSettings);
      }
    }
  }
  await protectCommunicationHub(guild);
  const lines = await rollout(guild, true);
  const welcomeLines = await postWelcomePackage(guild, lines);
  setupSettings = mergeSetupSettings(setupSettings, { autoSetupOnReady: true });
  await saveSetupSettings(local.workspacePath, setupSettings);
  return [...lines, ...welcomeLines, "First-run bootstrap is complete; future reconnects may safely rerun idempotent setup."];
}

function setupUpdateFromText(text: string): Partial<SetupSettings> {
  const update: Partial<SetupSettings> = {};
  const normalized = text.toLocaleLowerCase();
  const gameMonitor = { ...(setupSettings.gameMonitor ?? DEFAULT_GAME_MONITOR_SETTINGS) };
  let monitorChanged = false;
  if (/\b(auto setup|setup on ready|automatic setup)\b.*\b(off|disable|false)\b/.test(normalized)) update.autoSetupOnReady = false;
  if (/\b(auto setup|setup on ready|automatic setup)\b.*\b(on|enable|true)\b/.test(normalized)) update.autoSetupOnReady = true;
  if (/\b(welcome package|welcome post)\b.*\b(off|disable|false)\b/.test(normalized)) update.postWelcomePackage = false;
  if (/\b(welcome package|welcome post)\b.*\b(on|enable|true)\b/.test(normalized)) update.postWelcomePackage = true;
  const channel = text.match(/\bwelcome channel\s+(?:to\s+)?([#\p{L}\p{N}・_ -]{2,100})$/iu)?.[1]?.trim();
  if (channel) update.welcomeChannelName = channel.replace(/^#/, "").trim();
  if (/\b(enable|turn on|start)\b.*\bmonitor(ing)?\b/.test(normalized)) { gameMonitor.enabled = true; monitorChanged = true; }
  if (/\b(disable|turn off|stop)\b.*\bmonitor(ing)?\b/.test(normalized)) { gameMonitor.enabled = false; monitorChanged = true; }
  if (/\b(powerupstack|power up stack)\b/.test(normalized)) { gameMonitor.provider = "powerupstack"; monitorChanged = true; }
  if (/\b(realm)\b/.test(normalized)) { gameMonitor.provider = "realm"; monitorChanged = true; }
  const healthUrl = text.match(/\bhttps?:\/\/[^\s]+/i)?.[0];
  if (healthUrl) { gameMonitor.healthUrl = healthUrl; monitorChanged = true; }
  const endpoint = text.match(/\b([a-z0-9.-]+)\s*:\s*(\d{2,5})\b/i);
  if (endpoint) { gameMonitor.host = endpoint[1]; gameMonitor.port = Number(endpoint[2]); monitorChanged = true; }
  if (monitorChanged) update.gameMonitor = gameMonitor;
  return update;
}

function namedDeletionTargets(guild: Guild, request: string): { roles: typeof guild.roles.cache; categories: GuildBasedChannel[]; channels: GuildBasedChannel[] } {
  const requested = normalize(request);
  const categoryNames = manifest.categories.map((category) => category.name).filter((name) => requested.includes(normalize(name)));
  const channelSpecs = manifest.categories.flatMap((category) => category.channels).filter((channel) => [channel.name, ...(channel.legacyNames ?? [])].some((name) => requested.includes(normalize(name))));
  const roleSpecs = manifest.roles.filter((role) => [role.name, ...(role.legacyNames ?? [])].some((name) => requested.includes(normalize(name))));
  const categoryIds = new Set([...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildCategory && categoryNames.some((name) => normalize(name) === normalize(channel.name))).map((channel) => channel.id));
  const categories = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildCategory && categoryIds.has(channel.id));
  const channels = [...guild.channels.cache.values()].filter((channel) => channel.parentId !== null && categoryIds.has(channel.parentId) && channelSpecs.some((spec) => [spec.name, ...(spec.legacyNames ?? [])].some((name) => normalize(name) === normalize(channel.name))));
  const roles = guild.roles.cache.filter((role) => !role.managed && roleSpecs.some((spec) => roleNamesMatch(spec, role.name)));
  return { roles, categories, channels };
}

function deletionProposalLines(targets: ReturnType<typeof namedDeletionTargets>): string[] {
  return [
    ...targets.channels.map((channel) => `Channel: #${channel.name}`),
    ...targets.categories.map((category) => `Category: ${category.name}`),
    ...[...targets.roles.values()].map((role) => `Role: ${role.name}`),
  ];
}

async function deleteConversationTargets(guild: Guild, resourceIds: readonly string[]): Promise<string[]> {
  const ids = new Set(resourceIds);
  const results: string[] = [];
  for (const id of ids) {
    const channel = guild.channels.cache.get(id);
    if (channel) {
      await channel.delete("Warden owner-confirmed conversational deletion");
      results.push(`Deleted ${channel.type === ChannelType.GuildCategory ? "category" : "channel"}: ${channel.name}`);
      continue;
    }
    const role = guild.roles.cache.get(id);
    if (role && !role.managed) {
      await role.delete("Warden owner-confirmed conversational deletion");
      results.push(`Deleted role: ${role.name}`);
    }
  }
  return results;
}

function serverAnalysisLines(guild: Guild): string[] {
  const liveChannels: LiveChannel[] = [...guild.channels.cache.values()]
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
  const channelReport = compareChannels(expectedChannelsFromManifest(manifest), liveChannels);
  const expectedCategories = manifest.categories.map((category) => ({ name: category.name }));
  const liveCategories: LiveCategory[] = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .map((category) => ({ name: category.name }));
  const liveRoles: LiveRole[] = [...guild.roles.cache.values()].map((role) => ({ name: role.name, managed: role.managed }));
  const report = compareServer(
    expectedCategories,
    liveCategories,
    manifest.roles,
    liveRoles,
    {
      channelMissing: channelReport.missing,
      channelUnexpected: channelReport.unexpected,
      channelMisplaced: channelReport.misplaced,
      channelTypeMismatches: channelReport.typeMismatches,
      duplicateChannels: channelReport.duplicates,
    },
  );
  return formatServerAnalysis(report);
}

async function loadAuditPosts(guild: Guild): Promise<string> {
  if (auditChannelIds.size === 0) throw new Error("AUDIT_CHANNEL_IDS is not configured.");
  const sections: string[] = [];
  for (const channelId of auditChannelIds) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || channel.guildId !== guild.id || !("messages" in channel)) {
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

function roleMenuChannelIds(guild: Guild): Set<string> {
  if (roleMenuChannelId) return new Set([roleMenuChannelId]);
  const configuredName = normalize(manifest.roleMenuChannelName ?? "");
  const names = new Set([configuredName]);
  for (const category of manifest.categories) {
    for (const channel of category.channels) {
      if ([channel.name, ...(channel.legacyNames ?? [])].some((name) => normalize(name) === configuredName)) {
        names.add(normalize(channel.name));
        for (const legacyName of channel.legacyNames ?? []) names.add(normalize(legacyName));
      }
    }
  }
  return new Set(
    [...guild.channels.cache.values()]
      .filter((channel) => channel.type === ChannelType.GuildText && names.has(normalize(channel.name)))
      .map((channel) => channel.id),
  );
}

function isManagedRolePanelMessage(message: { guildId: string | null; channelId: string; author?: { id: string } | null; content?: string | null }, guild: Guild): boolean {
  return message.guildId === guild.id
    && message.author?.id === client.user?.id
    && (message.content ?? "").includes(ROLE_PANEL_MARKER)
    && roleMenuChannelIds(guild).has(message.channelId);
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

function targetResourceIds(targets: ReturnType<typeof resetTargets>): string[] {
  return [...targets.channels, ...targets.categories, ...targets.roles.values()].map((resource) => resource.id).sort();
}

function resetPreview(guild: Guild): { code: string; lines: string[] } {
  const targets = resetTargets(guild);
  const code = randomBytes(4).toString("hex").toUpperCase();
  pendingReset = { code, expiresAt: Date.now() + 10 * 60 * 1000, resourceIds: targetResourceIds(targets) };
  const resources = [
    ...targets.channels.map((channel) => `Channel: #${channel.name} (${channel.id})`),
    ...targets.categories.map((category) => `Category: ${category.name} (${category.id})`),
    ...[...targets.roles.values()].map((role) => `Role: ${role.name} (${role.id})`),
  ];
  const lines = [
    `Channels to delete: ${targets.channels.length}`,
    `Categories to delete: ${targets.categories.length}`,
    `Roles to delete: ${targets.roles.size}`,
    "Exact resources:",
    ...(resources.length > 0 ? resources : ["(none)"]),
    "Only exact manifest resources are targeted. Deleting a channel also deletes its Discord contents.",
    `Confirm within 10 minutes with code: ${code}`,
  ];
  return { code, lines };
}

async function resetManagedResources(targets: ReturnType<typeof resetTargets>): Promise<string[]> {
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
        if (isCommunicationHub(existingChannel.id, setupSettings.communicationHubChannelId)) {
          results.push(`Preserved communication hub: #${existingChannel.name}`);
          continue;
        }
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
  try {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commandBody() });
    console.log(`Logged in as ${readyClient.user.tag}; setup command registered for guild ${guildId}.`);
  } catch (error) {
    console.error(`Logged in as ${readyClient.user.tag}, but could not register commands for guild ${guildId}. Dashboard and local workspace features will remain available.`, error);
  }
  try {
    setupSettings = await loadSetupSettings(local.workspacePath);
    if (setupSettings.alertUserIds.length === 0) {
      setupSettings = mergeSetupSettings(setupSettings, { alertUserIds: [...(alertUserIds.size > 0 ? alertUserIds : ownerIds)] });
      await saveSetupSettings(local.workspacePath, setupSettings);
    }
    const services = await initializeLocalServices(local);
    console.log(`Local Warden services ready: vault=${services.vaultInitialized ? "initialized" : "skipped"}, context=${services.contextCharacters} chars, obsidian=${services.obsidianOpened ? "opened" : "not opened"}.`);
    if (services.ollama) console.log(`Ollama startup check: ${services.ollama.detail}.`);
    const guild = client.guilds.cache.get(guildId);
    const firstRun = guild ? await initializeFirstRunBootstrap(guild) : false;
    if (guild) await protectCommunicationHub(guild);
    if (guild && setupSettings.autoSetupOnReady && !firstRun) {
      try {
        const setupLines = await runWelcomeSetup(guild);
        console.log(setupLines.join("\n"));
      } catch (error) {
        console.error("Automatic Warden welcome setup failed:", error);
      }
    }
    if (dashboard.enabled) {
      const liveStatus = async () => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { connected: false, detail: `Configured guild ${guildId} is not cached.` };
        return {
          connected: true,
          guildId: guild.id,
          guildName: guild.name,
          memberCount: guild.memberCount,
          categoryCount: guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size,
          channelCount: guild.channels.cache.filter((channel) => channel.type !== ChannelType.GuildCategory).size,
          roleCount: guild.roles.cache.size,
        };
      };
      const controls: DashboardControls = {
        smoke: (action) => runSmokeTest(client.guilds.cache.get(guildId)!, action),
        lockdown: (action) => runLockdownAction(client.guilds.cache.get(guildId)!, action),
        setup: async (action, update) => {
          const guild = client.guilds.cache.get(guildId);
          if (!guild) return [`Configured guild ${guildId} is not cached.`];
          if (action === "status") return [`Setup auto-run: ${setupSettings.autoSetupOnReady ? "on" : "off"}`, `Welcome package: ${setupSettings.postWelcomePackage ? "on" : "off"}`, `Welcome channel: #${setupSettings.welcomeChannelName}`, `Communication hub: ${setupSettings.communicationHubChannelId ?? "not bound"}`, `Alert recipients: ${setupSettings.alertUserIds.length}`, `Game monitor: ${setupSettings.gameMonitor?.enabled ? `${setupSettings.gameMonitor.provider}/${setupSettings.gameMonitor.label}` : "off"}`, `Setup conversation: ${setupSettings.setupConversationEnabled ? "on" : "off"}`];
          if (action === "settings") {
            const hubId = setupSettings.communicationHubChannelId;
            const hubName = hubId ? guild.channels.cache.get(hubId)?.name : undefined;
            setupSettings = mergeSetupSettings(setupSettings, update ?? {});
            if (hubId) setupSettings = mergeSetupSettings(setupSettings, { communicationHubChannelId: hubId, ...(hubName ? { welcomeChannelName: hubName } : {}) });
            await saveSetupSettings(local.workspacePath, setupSettings);
            await protectCommunicationHub(guild);
            previousGameHealthy = undefined;
            if (monitorTimer) clearInterval(monitorTimer);
            const interval = setupSettings.gameMonitor?.intervalMs ?? DEFAULT_GAME_MONITOR_SETTINGS.intervalMs;
            monitorTimer = setInterval(() => void monitorGameServer(guild).catch((error) => console.error("Game-server monitoring failed:", error)), interval);
            return ["Setup settings saved.", `Auto-run: ${setupSettings.autoSetupOnReady ? "on" : "off"}`, `Welcome package: ${setupSettings.postWelcomePackage ? "on" : "off"}`, `Welcome channel: #${setupSettings.welcomeChannelName}`, `Game monitor: ${setupSettings.gameMonitor?.enabled ? `${setupSettings.gameMonitor.provider} enabled` : "off"}`];
          }
          if (action === "preview") return rollout(guild, false);
          return runWelcomeSetup(guild);
        },
        setupChat: async (question, confirmation, cancellation) => {
          const guild = client.guilds.cache.get(guildId);
          if (!guild) return [`Configured guild ${guildId} is not cached.`];
          if (cancellation) return ["Cancelled. Nothing was changed."];
          if (/\b(help|settings|configure|configuration|setup options)\b/i.test(question)) return setupSettingsHelp();
          if (confirmation && /\b(setup|deploy|welcome|rollout)\b/i.test(question)) return runWelcomeSetup(guild);
          const update = setupUpdateFromText(question);
          if (Object.keys(update).length > 0) return ["Proposed setup settings change:", JSON.stringify(update), "Send the same request with dashboard confirmation to apply it."];
          if (/\b(preview|plan|status)\b/i.test(question)) return rollout(guild, false);
          if (/\b(setup|deploy|welcome|rollout)\b/i.test(question)) return ["I’m ready to run the idempotent welcome setup. Confirm the dashboard request to execute it."];
          return [await askWarden(local, question)];
        },
        restart: async () => {
          const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
          const child = spawn(npmCommand, ["start"], { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true });
          child.unref();
          setTimeout(() => process.exit(0), 250);
          return ["Warden restart requested. The current process will exit and a fresh npm start process will take over."];
        },
      };
      const dashboardServer = createDashboardServer(dashboard, ownerIds, local, liveStatus, controls);
      const address = await dashboardServer.start();
      console.log(`Warden dashboard available at http://${address.address}:${address.port}/ (local owner token required).`);
    }
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
    if (!message.guild || !isManagedRolePanelMessage(message, message.guild)) return;
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

client.on("messageCreate", async (message) => {
  if (!message.guild || message.guild.id !== guildId || isBotAccount(message.author) || !manifest.onboarding) return;
  const rulesChannel = [...message.guild.channels.cache.values()].find((channel) => channel.type === ChannelType.GuildText && normalize(channel.name) === normalize(manifest.onboarding!.rulesChannelName));
  if (!rulesChannel || message.channelId !== rulesChannel.id || !canAcceptRules(message.content, rulesChannel.id, message.channelId)) return;
  const wanderer = onboardingRole(message.guild, manifest.onboarding.wandererRoleName);
  const settler = onboardingRole(message.guild, manifest.onboarding.settlerRoleName);
  if (!settler) return;
  try {
    const member = await message.guild.members.fetch(message.author.id);
    if (wanderer && member.roles.cache.has(wanderer.id)) await member.roles.remove(wanderer, "Aeloria rules accepted");
    if (!member.roles.cache.has(settler.id)) await member.roles.add(settler, "Aeloria rules accepted");
    await message.reply({ content: `Welcome, **${message.author.username}**. You are now a Settler. The gates are open; try not to immediately anger the lore archivists.`, allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error("Warden onboarding role transition failed:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("aeloria-role:")) {
    if (interaction.guildId !== guildId || !interaction.guild) {
      await interaction.reply({ content: "This role panel belongs to The Forgotten Ring server only.", ephemeral: true });
      return;
    }
    if (!isManagedRolePanelMessage(interaction.message, interaction.guild)) {
      await interaction.reply({ content: "That role panel is not managed by this Warden.", ephemeral: true });
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
  if (subcommand === "smoke") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can run or clean up smoke tests.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action", true);
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply((await runSmokeTest(interaction.guild, action)).join("\n").slice(0, 1900));
    } catch (error) {
      console.error("Warden smoke test failed:", error);
      await interaction.editReply("Smoke test failed. Check channel permissions and review any marked posts before retrying.");
    }
    return;
  }
  if (subcommand === "lockdown") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can change emergency lockdown.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action", true);
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply((await runLockdownAction(interaction.guild, action)).join("\n").slice(0, 1900));
    } catch (error) {
      console.error("Warden lockdown operation failed:", error);
      await interaction.editReply("Lockdown operation failed. Review channel permission overwrites and the bot role hierarchy.");
    }
    return;
  }
  if (subcommand === "rollout") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only the configured Warden owner can execute a full rollout.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "preview") {
      await interaction.reply({ content: (await rollout(interaction.guild, false)).join("\n").slice(0, 1900), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply((await rollout(interaction.guild, true)).join("\n").slice(0, 1900));
    } catch (error) {
      console.error("Aeloria full rollout failed:", error);
      await interaction.editReply("Full rollout failed. Review the stage report and Discord permissions before retrying; no wipe was performed.");
    }
    return;
  }
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
    const targets = resetTargets(interaction.guild);
    if (JSON.stringify(targetResourceIds(targets)) !== JSON.stringify(pendingReset.resourceIds)) {
      pendingReset = undefined;
      await interaction.reply({ content: "The managed resources changed after the preview. Run reset preview again; nothing was changed.", ephemeral: true });
      return;
    }
    pendingReset = undefined;
    await interaction.deferReply({ ephemeral: true });
    try {
      const results = await resetManagedResources(targets);
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
  if (subcommand === "analyze") {
    if (!canManage(interaction)) {
      await interaction.reply({ content: "You are not authorized to analyze the repository and server.", ephemeral: true });
      return;
    }
    const chunks: string[] = [];
    let current = "**Aeloria repository/server analysis** — read-only; no changes made.\n";
    for (const line of serverAnalysisLines(interaction.guild)) {
      if (current.length + line.length + 1 > 1800) {
        chunks.push(current);
        current = "";
      }
      current += `${line}\n`;
    }
    if (current) chunks.push(current);
    await interaction.reply({ content: chunks.shift() ?? "No visible server resources found.", ephemeral: true });
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
      const answer = await askWarden(local, interaction.options.getString("question", true), `${context}\n\nThis /ask request does not include live Discord state. For current server drift, use /aeloria analyze.`);
      await interaction.editReply(answer.slice(0, 1900));
    } catch (error) {
      console.error("Warden chat failed:", error);
      await interaction.editReply("The local Warden assistant is unavailable. Check that Ollama is running and the configured model is installed.");
    }
    return;
  }
  if (subcommand === "lore") {
    if (!isOwner(interaction)) {
      await interaction.reply({ content: "Only a configured Warden owner can write or approve lore proposals.", ephemeral: true });
      return;
    }
    const action = interaction.options.getString("action", true);
    const title = interaction.options.getString("title", true).trim();
    const content = interaction.options.getString("content")?.trim();
    if (action === "review") {
      const context = await loadProjectContext(local);
      await interaction.reply({ content: `**Lore review context**\n${context.slice(0, 1800) || "No lore context was found."}\n\nDrafts are stored in docs/lore/drafts. Review them before approving canon.`, ephemeral: true });
      return;
    }
    if (!content) {
      await interaction.reply({ content: "Draft and approve require lore content. Nothing was changed.", ephemeral: true });
      return;
    }
    try {
      const draft = { title, content, authorId: interaction.user.id, authorName: interaction.user.username };
      if (action === "draft") {
        const path = await writeLoreDraft(repositoryRoot, draft);
        await interaction.reply({ content: `Saved a **Draft** lore proposal at \`${path}\`. It is not canon. Review it before approval.`, ephemeral: true });
      } else {
        const path = await recordLoreApproval(repositoryRoot, draft, interaction.user.id, interaction.user.username);
        await interaction.reply({ content: `Approved **${title}** into the canon register at \`${path}\`.`, ephemeral: true });
      }
    } catch (error) {
      console.error("Warden lore workflow failed:", error);
      await interaction.reply({ content: "The lore workflow failed. No canon change was confirmed.", ephemeral: true });
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

if (conversationModeEnabled || mentionChatEnabled || ambientTextEnabled) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || message.guildId !== guildId || !message.guild) return;
    const mention = new RegExp(`<@!?${client.user?.id ?? "0"}>`, "g");
    const addressedByMention = mentionChatEnabled && chatAllowed(message.channelId) && mention.test(message.content);
    const questionFromWakePhrase = wakeQuestion(message.content);
    const addressedByWakePhrase = ambientTextEnabled && godMode && isOwnerId(message.author.id) && ambientChannelIds.has(message.channelId) && Boolean(questionFromWakePhrase);
    const bootstrapChannel = setupSettings.bootstrapChannelId === message.channelId;
    const addressedByConversation = conversationModeEnabled && (chatAllowed(message.channelId) || bootstrapChannel);
    if (!addressedByMention && !addressedByWakePhrase && !addressedByConversation) return;
    const question = addressedByWakePhrase
      ? questionFromWakePhrase!
      : addressedByMention
        ? removeBotMention(message.content, client.user?.id ?? "0")
        : message.content.trim();
    if (!question) return;
    const channelName = "name" in message.channel ? message.channel.name : "";
    const isBootstrapChannel = setupSettings.bootstrapChannelId === message.channelId;
    if (setupSettings.setupConversationEnabled && (isBootstrapChannel || normalize(channelName) === normalize(setupSettings.welcomeChannelName))) {
      const lower = question.toLocaleLowerCase();
      if (/\b(help|settings|configure|configuration|setup options)\b/.test(lower)) {
        await message.reply(setupSettingsHelp().join("\n"));
        return;
      }
      if (isOwnerId(message.author.id) && pendingSetupSettings && pendingSetupSettings.expiresAt > Date.now() && pendingSetupSettings.guildId === message.guildId && pendingSetupSettings.channelId === message.channelId) {
        if (explicitCancellation(question)) {
          pendingSetupSettings = undefined;
          await message.reply("Cancelled the setup change. Nothing was changed.");
          return;
        }
        if (explicitConfirmation(question)) {
          setupSettings = mergeSetupSettings(setupSettings, pendingSetupSettings.update);
          await saveSetupSettings(local.workspacePath, setupSettings);
          pendingSetupSettings = undefined;
          await message.reply(`Setup settings saved. Auto setup: ${setupSettings.autoSetupOnReady ? "on" : "off"}; welcome package: ${setupSettings.postWelcomePackage ? "on" : "off"}; welcome channel: #${setupSettings.welcomeChannelName}.`);
          return;
        }
      }
      const update = setupUpdateFromText(question);
      if (Object.keys(update).length > 0) {
        if (!isOwnerId(message.author.id)) {
          await message.reply("I can explain setup settings here, but only the configured owner can change them.");
          return;
        }
        pendingSetupSettings = { ownerId: message.author.id, guildId: message.guildId, channelId: message.channelId, update, expiresAt: Date.now() + 5 * 60 * 1000 };
        await message.reply(`I’m ready to change setup settings to: ${JSON.stringify(update)}. Reply **yes** to save or **cancel**.`);
        return;
      }
      if (/\b(setup|deploy|welcome package|rebuild)\b/i.test(question)) {
        if (!isOwnerId(message.author.id)) {
          await message.reply("I can preview setup for you, but only the configured owner can execute the welcome rollout.");
          return;
        }
        pendingConversationAction = { ownerId: message.author.id, guildId: message.guildId, channelId: message.channelId, intent: { kind: "rollout-request" }, expiresAt: Date.now() + 5 * 60 * 1000 };
        await message.reply("I’m ready to run the full idempotent setup and post the welcome package. Reply **yes** to confirm or **cancel**.");
        return;
      }
    }
    if (isOwnerId(message.author.id) && pendingConversationAction && pendingConversationAction.expiresAt > Date.now() && pendingConversationAction.guildId === message.guildId && pendingConversationAction.channelId === message.channelId) {
      if (explicitCancellation(question)) {
        pendingConversationAction = undefined;
        await message.reply("Cancelled. Nothing was changed.");
        return;
      }
      if (explicitConfirmation(question)) {
        const pending = pendingConversationAction;
        pendingConversationAction = undefined;
        try {
          const result = pending.intent.kind === "rollout-request"
            ? await runWelcomeSetup(message.guild)
            : pending.intent.kind === "lockdown-request"
              ? await runLockdownAction(message.guild, pending.intent.enabled ? "enable" : "disable")
              : await runSmokeTest(message.guild, pending.intent.kind === "smoke-run" ? "run" : "cleanup");
          await message.reply(result.join("\n").slice(0, 1900));
        } catch (error) {
          console.error("Warden conversational operation failed:", error);
          await message.reply("That operation failed. I changed nothing beyond any stages already reported; check permissions and the server report.");
        }
        return;
      }
    }
    if (isOwnerId(message.author.id) && deletionProposalValid(pendingConversationDeletion, message.author.id, message.guildId, message.channelId)) {
      if (isDeletionCancellation(question)) {
        pendingConversationDeletion = undefined;
        await message.reply("Cancelled the pending deletion proposal. Nothing was changed.");
        return;
      }
      if (isDeletionConfirmation(question)) {
        const proposal = pendingConversationDeletion;
        if (!proposal) return;
        pendingConversationDeletion = undefined;
        try {
          const results = await deleteConversationTargets(message.guild!, proposal.resourceIds);
          await message.reply(results.length > 0 ? `Confirmed.\n${results.join("\n")}` : "The proposed resources were no longer present. Nothing was changed.");
        } catch (error) {
          console.error("Warden conversational deletion failed:", error);
          await message.reply("Deletion stopped after an error. Review the server before asking again.");
        }
        return;
      }
    }
    if (isOwnerId(message.author.id) && /\b(delete|remove|clean up|cleanup)\b/i.test(question)) {
      const targets = namedDeletionTargets(message.guild!, question);
      const lines = deletionProposalLines(targets);
      if (lines.length > 0) {
        pendingConversationDeletion = {
          ownerId: message.author.id,
          guildId: message.guildId,
          channelId: message.channelId,
          expiresAt: Date.now() + 5 * 60 * 1000,
          resourceIds: [...targets.channels, ...targets.categories, ...targets.roles.values()].map((resource) => resource.id),
        };
        await message.reply(["I found these exact manifest-managed resources:", ...lines, "", "Do you want me to delete exactly these? Reply **yes, delete those** to confirm or **cancel**. This proposal expires in 5 minutes."].join("\n"));
        return;
      }
      await message.reply("I can only propose deletion when you name existing manifest-managed channels, categories, or roles. Nothing was changed.");
      return;
    }
    const intent = conversationIntent(question);
    if (intent.kind === "rollout-preview") {
      await message.reply((await rollout(message.guild, false)).join("\n").slice(0, 1900));
      return;
    }
    if (intent.kind === "smoke-preview") {
      await message.reply((await runSmokeTest(message.guild, "preview")).join("\n").slice(0, 1900));
      return;
    }
    if (intent.kind === "status") {
      await message.reply(serverAnalysisLines(message.guild).join("\n").slice(0, 1900));
      return;
    }
    if (intent.kind === "lockdown-status") {
      await message.reply((await runLockdownAction(message.guild, "status")).join("\n"));
      return;
    }
    if (intent.kind === "rollout-request" || intent.kind === "lockdown-request" || intent.kind === "smoke-run" || intent.kind === "smoke-cleanup") {
      if (!isOwnerId(message.author.id)) {
        await message.reply("I can discuss that with you, but only the configured Warden owner can run deployment, lockdown, or smoke operations.");
        return;
      }
      pendingConversationAction = { ownerId: message.author.id, guildId: message.guildId, channelId: message.channelId, intent, expiresAt: Date.now() + 5 * 60 * 1000 };
      const description = intent.kind === "rollout-request"
        ? "execute the full rollout"
        : intent.kind === "lockdown-request"
          ? `${intent.enabled ? "enable" : "disable"} emergency lockdown`
          : intent.kind === "smoke-run" ? "post smoke-test messages" : "remove marked smoke-test messages";
      await message.reply(`I’m ready to ${description}. Reply **yes** to confirm or **cancel**. This confirmation expires in five minutes.`);
      return;
    }
    try {
      const context = await loadProjectContext(local);
      const serverState = serverAnalysisLines(message.guild!).join("\n");
      const answer = await askWarden(local, question, `${context}\n\nCurrent visible Discord/repository analysis:\n${serverState}`);
      await message.reply(answer.slice(0, 1900));
    } catch (error) {
      console.error("Warden conversation failed:", error);
      await message.reply("The local Warden assistant is unavailable right now.");
    }
  });
}

client.login(token).catch((error: unknown) => {
  console.error("Could not log in to Discord:", error);
  process.exitCode = 1;
});
