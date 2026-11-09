# Aeloria Discord Warden

Warden is the self-hosted assistant for the Aeloria Discord server. It is a chatbot, local project helper, Discord server builder/manager, and general-purpose jack-of-all-trades driven by a checked-in manifest. The Discord community is Aeloria; the game server is The Forgotten Ring; Aeloria is the lore/world identity.

## Safety by design

- It is restricted to the single `GUILD_ID` configured in `.env`.
- `/aeloria setup preview` is read-only and shows what would be created.
- `/aeloria setup apply` creates only missing roles, categories, and channels from the manifest.
- `/aeloria setup reconcile` updates matching manifest roles, private permissions, channel parents, and text topics, while creating missing resources.
- `/aeloria admin status|enable|disable` is restricted to the comma-separated `OWNER_IDS` allowlist and controls an in-memory application admin mode for the current process.
- `/aeloria god status|enable|disable` is restricted to `OWNER_IDS` and controls the owner-only God Mode used by the text wake phrase.
- `/aeloria reset preview` lists exact manifest-managed resources that would be deleted; `/aeloria reset confirm` requires the one-time code from that preview and is owner-only.
- `/aeloria inventory` produces a read-only inventory of every visible category/channel, labels manifest matches, and flags duplicate channel names within the same category.
- `/aeloria check` compares visible channels with `config/aeloria-server.json` and reports missing, unexpected, misplaced, wrong-type, and duplicate channels without changing anything.
- `/aeloria content preview` previews descriptions and the generated first post for every manifest text channel; `/aeloria content apply` sets text-channel topics and posts only missing Warden starter messages.
- `/aeloria roles preview|apply` manages the manifest role sections; `/aeloria roles publish` posts or refreshes the self-selectable role panel with both buttons and configured emoji reactions; `/aeloria roles assign-separators` applies section-header roles to existing members.
- Reacting to the managed role panel adds the mapped self-selectable role; removing the reaction removes it. Only roles marked `selfAssignable` can be reached this way.
- New members receive configured separator roles when `ENABLE_AUTO_ROLE_SEPARATORS=true`. Separator roles have no permissions; they visually group roles and are not staff access.
- `/aeloria audit` compares recent posts from `AUDIT_CHANNEL_IDS` with bounded repository context through local Ollama and reports possible alignment issues privately.
- `/aeloria vault initialize|open` creates the local Obsidian folder structure and opens it through `OBSIDIAN_OPEN_COMMAND`; both actions are owner-only.
- `/aeloria ask` sends a bounded repository and reviewed-memory context to the configured local Ollama model.
- Set `ENABLE_MENTION_CHAT=true` to answer direct Warden mentions. Set `CHAT_CHANNEL_IDS` to a comma-separated allowlist; message content intent must also be enabled in the Discord Developer Portal.
- Chat is disabled when `CHAT_CHANNEL_IDS` is empty; it never defaults to listening across the server.
- Channel and role names in the manifest use emoji prefixes. `legacyNames` lets `setup reconcile` recognize old names and explicitly rename them; ordinary `apply` does not rename existing resources.
- Set `ENABLE_AMBIENT_TEXT=true` and `AMBIENT_CHANNEL_IDS` to allow the owner to say `hey warden ...` in selected text channels. This does not capture voice audio and does not listen outside the configured channels.
- Existing resources are left untouched by `apply`. `reconcile` changes only resources matched by case-insensitive manifest names. The bot does not delete resources, rename resources, assign roles to people, or post messages.
- Content apply is separate from setup and only posts messages containing a stable Warden marker; rerunning it does not duplicate or rewrite ordinary user messages. Voice channels receive manifest descriptions but cannot receive text posts.
- Inventory can only see channels the bot has permission to view; it does not read message history or inspect hidden channels.
- The repository check uses the same visibility boundary: inaccessible or hidden Discord channels are not treated as confirmed missing.
- Audit requires `AUDIT_CHANNEL_IDS`, **Read Message History**, and **Message Content Intent**. `AUDIT_MESSAGE_LIMIT` is capped at 100. Posts are reference input only, are not stored by this feature, and never directly trigger edits or deletions.
- Reset is separate from ordinary setup: it never deletes the Discord guild or unrelated resources, but deleting a channel also deletes its Discord contents. Run `setup reconcile` afterward to rebuild the manifest structure.
- Staff channels are created with access limited to the configured staff role names. Those roles are not granted Discord permissions by the bot.
- The bot token belongs in `.env`, never in the manifest, source code, GitHub, or a Discord message.
- `OWNER_IDS` identifies the accounts allowed to toggle Warden admin mode. `OWNER_ID` remains supported for backward compatibility. `ADMIN_MODE=true` only sets the startup state; it does not grant Discord Administrator.
- `GOD_MODE=true` only enables the owner-only application mode at startup. It does not grant Discord Administrator and does not permit arbitrary model-directed server actions.
- `OBSIDIAN_VAULT_PATH` is local-only storage. The bot creates `Aeloria/Canon`, `Aeloria/Decisions`, `Aeloria/Project Memory`, and `Aeloria/Review Queue`; it does not archive ordinary chat automatically.
- Ollama is contacted at `OLLAMA_URL` using `OLLAMA_MODEL`; no project context is sent to a hosted AI service by this tool.
- On Discord startup, the bot initializes the local vault by default, loads bounded repository/project-memory context, and checks Ollama/model availability. With `OLLAMA_AUTO_START=true`, it launches the local `OLLAMA_COMMAND` (`ollama serve` by default) and waits up to `OLLAMA_STARTUP_TIMEOUT_MS` milliseconds. If Ollama is not installed or does not become ready, the bot remains usable in degraded mode; setup and local repository operations still work. Set `AUTO_OPEN_OBSIDIAN=true` only if you want startup to launch the Obsidian UI.
- Public Discord application links are documented in [`docs/server/discord-application-links.md`](../../docs/server/discord-application-links.md); the legal source files are [`Terms of Service`](../../docs/legal/terms-of-service.md) and [`Privacy Policy`](../../docs/legal/privacy-policy.md).

This is a careful first version, not a one-click destructive reset. Review the manifest and preview output before applying. Back up or document your server settings before any live configuration work.

## Requirements

- Node.js 20 or newer
- A Discord application and bot created in the Discord Developer Portal
- The target server's ID
- Bot invited to that server with **Manage Roles**, **Manage Channels**, **View Channels**, **Send Messages**, **Read Message History**, and **Add Reactions**. Enable the privileged **Server Members Intent** when `ENABLE_AUTO_ROLE_SEPARATORS=true`; enable the **Message Content Intent** for mention/audit features. Place the bot's highest role above roles it needs to create/manage. It does not need Administrator.

## Setup

1. In the Discord Developer Portal, create an application and add a bot user.
2. Copy the bot token once and keep it private.
3. Enable the bot's server/guild installation and invite it only to your Aeloria server with the permissions above and the `applications.commands` scope.
4. Copy `.env.example` to `.env`. Fill in the token, application ID, Aeloria server ID, and a comma-separated list of authorized operator user IDs. The setup command requires both an allowlisted user ID and **Manage Server** permission.
5. Review `config/aeloria-server.json`. The initial manifest is based on the visible Discord screenshots; it is not a full export of the current server.
6. Install and start:

   ```sh
   npm install
   cp .env.example .env
   # Edit .env before continuing.
   npm run dev
   ```

   On Windows, copy `.env.example` to `.env` in File Explorer or use `Copy-Item .env.example .env` in PowerShell.

7. In your server, run `/aeloria setup preview`. If the plan is correct, run `/aeloria setup apply` as a member with **Manage Server** permission. Then run `/aeloria content preview` and review it before using `/aeloria content apply`.
8. Run `/aeloria roles preview`, then `/aeloria roles apply`. Run `/aeloria roles assign-separators` once for existing members if automatic separators are enabled, then `/aeloria roles publish` to publish the self-role panel.

Before connecting to Discord, validate the local build with `npm run typecheck` and `npm test`. These checks do not require Discord credentials or Ollama.

For a persistent host, use a private machine or reputable hosting provider, keep `.env` out of source control, and configure the process manager to restart the bot after a crash. Do not publish the token in logs or screenshots.

## Manifest behavior

- Resource names are matched exactly, case-insensitively.
- Existing matching roles/channels/categories are skipped by `apply`; `reconcile` edits only the supported manifest settings.
- `reconcile` edits matching role color/hoist settings, private category/channel permissions, channel parents, and text topics.
- God Mode only enables the owner-only ambient `hey warden ...` wake phrase; it does not authorize setup, reset, inventory, or audit commands.
- Categories are created before their channels. Roles are created before staff-channel permission overwrites.
- If a referenced staff role is missing, preview reports it. Apply creates roles listed in the manifest before creating channels.
- Channel and role ordering is not changed. Discord ordering can be adjusted manually after setup.
- The manifest can be edited before each run. Keep the bot stopped while changing the configuration.
- Role separators and self-selectable roles are explicit manifest entries. The bot never exposes staff roles through the self-role panel and never grants Discord Administrator through any role action.

## First run notes

The manifest is intentionally a starter structure, not a claim that the screenshots show every channel or that the role list is final. In particular, role names and private-channel access should be checked against the live server before applying. The bot does not auto-assign any roles, including staff roles.

## Troubleshooting

- **Command is not visible:** confirm `GUILD_ID` and `APPLICATION_ID`, restart the bot, and check its installation includes `applications.commands`.
- **Not authorized:** confirm your Discord user ID is listed in `OPERATOR_IDS` and that you have Manage Server permission in the configured guild.
- **Missing Access / Missing Permissions:** check the bot was invited to the configured guild and has Manage Roles/Manage Channels. Move its bot role above the roles it must create.
- **Role hierarchy error:** move the bot role higher, but only as high as necessary. Do not grant Administrator to work around it.
- **Wrong setup preview:** stop before `apply`; edit the JSON manifest, restart, and preview again.

## Future improvements

A later version may add a sanitized export/backup command, change detection, permission diff review, and explicit confirmation for narrowly scoped edits. Deletion should remain a separate, opt-in operation and is not part of this bot.
