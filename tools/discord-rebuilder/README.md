# Aeloria Discord Warden

Warden is the self-hosted assistant for the Aeloria Discord server. It is a chatbot, local project helper, Discord server builder/manager, and general-purpose jack-of-all-trades driven by a checked-in manifest. The Discord community is Aeloria; the game server is The Forgotten Ring; Aeloria is the lore/world identity.

## Safety by design

- It is restricted to the single `GUILD_ID` configured in `.env`.
- `/aeloria setup preview` is read-only and shows what would be created.
- `/aeloria setup apply` creates only missing roles, categories, and channels from the manifest.
- `/aeloria setup reconcile` updates matching manifest roles, private permissions, channel parents, and text topics, while creating missing resources.
- `/aeloria rollout preview` is read-only. Full rollout execution is disabled; use the conversational staged workflow instead: `rollout plan`, discuss/tweak, `approve rollout`, then `run next rollout stage`.
- When Warden rejoins, startup is strictly read-only. It initializes local services and registers commands but does not create roles/channels, change permissions, or post welcome/setup content.
- On a true first join to a blank guild—one text channel, no categories, no human-created roles, and only Warden's managed role—Warden does **not** immediately build. It claims the sole channel as a temporary setup room, persists its ID, posts a bootstrap guide, and waits for the owner to discuss or confirm setup. `CHAT_CHANNEL_IDS` is not required for this first-run room.
- After the owner confirms the first setup, Warden promotes that original channel to the manifest `👋・welcome` channel, creates the remaining structure, publishes the welcome package and role panel, and marks future reconnects as safe to rerun.
- The original first-run channel is also persisted as the communication hub by channel ID. Renaming it or changing its topic does not move Warden's setup conversation or alerts to another channel.
- Set `ALERT_USER_IDS` to the Discord user IDs for you and Salty. Serious game-server health transitions mention only those IDs in the communication hub; display names are not used for alert targeting.
- Game monitoring is provider-neutral. Configure it through the hub conversation or authenticated dashboard with phrases such as `enable PowerUpStack monitoring at https://.../health` or `monitor 203.0.113.10:19132`. HTTP checks work with a provider health endpoint; TCP checks work when the host exposes the game port.
- Realm mode is supported as a provider setting, but Warden does not invent a direct public Realm endpoint. Use a provider/API health bridge or external webhook/HTTP health URL when switching to a Realm. Without one, Warden reports that monitoring needs an external health signal instead of claiming the Realm is offline.
- Emergency lockdown is owner-only and creates a temporary `Warden Lockdown` role plus a hidden `🚨・Lockdown Protocol` category. Normal channels are hidden and muted for members and configured staff roles; the Warden communication hub remains separately owner/bot-only.
- During lockdown, members can see and type only in `🔒・holding-area`. Embeds, attachments, reactions, external emojis, role mentions, user mentions, and `@everyone`/`@here` are denied there. Staff can coordinate in `🛡️・lockdown-coordination` and review the pinned `🚨・red-alert-noticeboard`; staff-and-above can use pings in protocol channels.
- The noticeboard contains a pinned safe incident message and Warden avoids credentials, private logs, exploit details, personal information, and unverified claims. Discord users with the native Administrator permission can still override channel overwrites; the bot does not grant or remove Discord Administrator.
- In the configured welcome channel, ask Warden about “setup settings”, “preview setup”, or “deploy the welcome package”. Owner-only changes require a separate `yes` or `cancel`; settings changes are persisted locally and never grant Administrator or delete resources.
- `/aeloria admin status|enable|disable` is restricted to the comma-separated `OWNER_IDS` allowlist and controls an in-memory application admin mode for the current process.
- `/aeloria god status|enable|disable` is restricted to `OWNER_IDS` and controls the owner-only God Mode used by the text wake phrase.
- `/aeloria reset preview` lists exact manifest-managed resources that would be deleted; `/aeloria reset confirm` requires the one-time code from that preview and is owner-only.
- `/aeloria inventory` produces a read-only inventory of every visible category/channel, labels manifest matches, and flags duplicate channel names within the same category.
- `/aeloria check` compares visible channels with `config/aeloria-server.json` and reports missing, unexpected, misplaced, wrong-type, and duplicate channels without changing anything.
- `/aeloria analyze` compares visible categories, channels, and roles with the repository manifest and reports what is missing, unexpected, misplaced, duplicated, or the wrong type. It is read-only and only analyzes resources visible to the bot.
- `/aeloria content preview` previews descriptions and the generated first post for every manifest text channel; `/aeloria content apply` sets text-channel topics and posts only missing Warden starter messages.
- `/aeloria roles preview|apply` manages the manifest role sections; `/aeloria roles publish` posts or refreshes the self-selectable role panel with both buttons and configured emoji reactions; `/aeloria roles assign-separators` applies section-header roles to existing members.
- Reacting to the managed role panel adds the mapped self-selectable role; removing the reaction removes it. Only roles marked `selfAssignable` can be reached this way.
- The manifest now defines `Wanderer` and `Settler` onboarding roles. New members can receive `Wanderer`; a human message containing `I accept`/`I agree` in the configured rules channel removes Wanderer and adds Settler. Bot and system accounts are ignored. This requires Manage Roles and the Warden role above both onboarding roles.
- New members receive configured separator roles when `ENABLE_AUTO_ROLE_SEPARATORS=true`. Separator roles have no permissions; they visually group roles and are not staff access.
- `/aeloria audit` compares recent posts from `AUDIT_CHANNEL_IDS` with bounded repository context through local Ollama and reports possible alignment issues privately.
- `/aeloria vault initialize|open` creates the local Obsidian folder structure and opens it through `OBSIDIAN_OPEN_COMMAND`; both actions are owner-only.
- `/aeloria ask` sends a bounded repository and reviewed-memory context to the configured local Ollama model.
- Set `ENABLE_DASHBOARD=true` to start the local owner-authenticated Aeloria workarea. It provides Markdown-backed sections for lore drafts, territory plans, build ideas, project tasks, and notes under `DASHBOARD_WORKSPACE_PATH` (default: `.warden-workspace`). Its chat uses the same Warden, bounded conversation, workspace, repository context, and reviewed Obsidian notes used by Discord. It does not silently change approved canon.
- The authenticated dashboard exposes setup status, preview, settings, execute, and setup-chat controls. Dashboard setup execution is the same idempotent welcome rollout used by Discord.
- Configure `DASHBOARD_ACCESS_USERS` as separate `email:token` entries and `DASHBOARD_OPERATOR_USERS` for identities allowed to perform live operations. With `DASHBOARD_REQUIRE_CLOUDFLARE_IDENTITY=true`, the dashboard requires the matching Cloudflare Access email header. Non-operators can workshop, draft, review, and submit code proposals without applying them.
- Authenticated dashboards receive live workspace and code-review events through `/api/events`; Ollama remains local and is never published through the tunnel.
- Conversation is the normal Warden interface when `ENABLE_CONVERSATION_MODE=true` (the default). Set `CHAT_CHANNEL_IDS` to an explicit comma-separated channel allowlist; Warden never listens server-wide. Mentions remain supported through `ENABLE_MENTION_CHAT=true`.
- In allowed channels, ordinary messages are treated as conversation. Read-only requests such as status, rollout preview, and smoke preview run immediately. Deployment, lockdown, smoke posting/cleanup, reset, deletion, and other mutations require the configured owner and a separate `yes` confirmation; `cancel` stops the pending action.
- Channel and role names in the manifest use emoji prefixes. `legacyNames` lets `setup reconcile` recognize old names and explicitly rename them; ordinary `apply` does not rename existing resources.
- Set `ENABLE_AMBIENT_TEXT=true` and `AMBIENT_CHANNEL_IDS` to allow the owner to say `hey warden ...` in selected text channels. This does not capture voice audio and does not listen outside the configured channels.
- Existing resources are left untouched by `apply`. `reconcile` changes only resources matched by case-insensitive manifest names. Content apply posts only managed starter messages, role commands assign only explicitly self-selectable roles or configured separator roles, and reset/deletion are separate owner-only workflows with confirmation.
- Content apply is separate from setup and only posts messages containing a stable Warden marker; rerunning it does not duplicate or rewrite ordinary user messages. Voice channels receive manifest descriptions but cannot receive text posts.
- Inventory can only see channels the bot has permission to view; it does not read message history or inspect hidden channels.
- The repository check uses the same visibility boundary: inaccessible or hidden Discord channels are not treated as confirmed missing.
- Audit requires `AUDIT_CHANNEL_IDS`, **Read Message History**, and **Message Content Intent**. `AUDIT_MESSAGE_LIMIT` is capped at 100. Posts are reference input only, are not stored by this feature, and never directly trigger edits or deletions.
- Reset is separate from ordinary setup: it never deletes the Discord guild or unrelated resources, but deleting a channel also deletes its Discord contents. Run `setup reconcile` afterward to rebuild the manifest structure.
- Natural chat is advisory: Warden may explain findings and propose `setup`, `reconcile`, or `reset preview` actions, but it does not apply, rename, reconcile, or delete resources from a message. Use the explicit slash commands, and require owner confirmation for destructive reset actions.
- `/aeloria smoke preview|run|cleanup` is owner-only. Preview lists the planned checks; run posts clearly marked diagnostics to every visible manifest text channel; cleanup removes only Warden-authored marked smoke posts. It does not simulate a real human or silently alter roles.
- Dashboard smoke operations stream phase and per-channel progress to connected clients so the operation is observable rather than appearing frozen.
- `/aeloria lockdown status|enable|disable` is owner-only. Enable denies `SendMessages` for `@everyone` in managed public text channels; disable removes that explicit overwrite. It is an application-level emergency protocol, not Discord Administrator, and permission failures are reported. Review channel-specific overrides after a real incident.
- Owners can also request a conversational deletion by mentioning Warden and naming exact manifest-managed resources, for example `@Warden delete #old-channel and the Archive category`. Warden lists the exact targets and asks for confirmation. Reply `yes, delete those` to confirm or `cancel` to stop; the proposal expires after five minutes. Unmanaged resources, ambiguous requests, and confirmations without a pending proposal do nothing.
- Staff channels are created with access limited to the configured staff role names. Those roles are not granted Discord permissions by the bot.
- The bot token belongs in `.env`, never in the manifest, source code, GitHub, or a Discord message.
- `OWNER_IDS` identifies the accounts allowed to toggle Warden admin mode. `OWNER_ID` remains supported for backward compatibility. `ADMIN_MODE=true` only sets the startup state; it does not grant Discord Administrator.
- `GOD_MODE=true` only enables the owner-only application mode at startup. It does not grant Discord Administrator and does not permit arbitrary model-directed server actions.
- `OBSIDIAN_VAULT_PATH` is local-only storage. The bot creates `Aeloria/Canon`, `Aeloria/Decisions`, `Aeloria/Project Memory`, and `Aeloria/Review Queue`; it does not archive ordinary chat automatically.
- Ollama is contacted at `OLLAMA_URL` using `OLLAMA_MODEL`; no project context is sent to a hosted AI service by this tool.
- On Discord startup, the bot initializes the local vault by default, loads bounded repository/project-memory context, and checks Ollama/model availability. With `OLLAMA_AUTO_START=true`, it launches the local `OLLAMA_COMMAND` (`ollama serve` by default) and waits up to `OLLAMA_STARTUP_TIMEOUT_MS` milliseconds. If Ollama is not installed or does not become ready, the bot remains usable in degraded mode; setup and local repository operations still work. Set `AUTO_OPEN_OBSIDIAN=true` only if you want startup to launch the Obsidian UI.
- Public Discord application links are documented in [`docs/server/discord-application-links.md`](../../docs/server/discord-application-links.md); the legal source files are [`Terms of Service`](../../docs/legal/terms-of-service.md) and [`Privacy Policy`](../../docs/legal/privacy-policy.md).
- A permanent secure dashboard tunnel uses the named Cloudflare configuration in [`ops/cloudflared/README.md`](ops/cloudflared/README.md). The dashboard stays on `127.0.0.1`; never tunnel Ollama port `11434`.

This is a careful first version, not a one-click destructive reset. Review the manifest and preview output before applying. Back up or document your server settings before any live configuration work.

## Requirements

- Node.js 20 or newer
- A Discord application and bot created in the Discord Developer Portal
- The target server's ID
- Bot invited to that server with **Manage Roles**, **Manage Channels**, **View Channels**, **Send Messages**, **Read Message History**, and **Add Reactions**. Enable the privileged **Server Members Intent** when `ENABLE_AUTO_ROLE_SEPARATORS=true`; enable the **Message Content Intent** for mention/audit features. Place the bot's highest role above roles it needs to create/manage. It does not need Administrator.

## Setup

## Clean-slate rollout

After intentionally emptying the configured Aeloria server:

1. Confirm `.env` has the new Discord token, `GUILD_ID`, `OWNER_IDS`, and `OPERATOR_IDS`.
2. Ensure the bot has `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`, `Read Message History`, `Add Reactions`, and the required privileged intents enabled in the Discord Developer Portal. Do not grant Administrator.
3. Start Warden with `npm start` from `tools/discord-rebuilder`.
4. Run `/aeloria rollout preview` and inspect the planned manifest resources.
5. In the Warden conversation channel, say `rollout plan`, discuss any changes, then approve and run each stage individually.
6. Run `/aeloria analyze`, `/aeloria content preview`, and `/aeloria roles preview` to verify visible drift.
7. If the report stops at a stage, correct the reported permission or hierarchy issue and execute rollout again. The stages are idempotent and do not delete unrelated resources.

The rollout posts tailored messages to manifest text channels and publishes the self-selectable role panel. New members receive the configured onboarding path and can accept the rules in `📜・rules` to move from `Wanderer` to `Settler`.

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

## Controlled workshop changes

- Authenticated collaborators can submit unified-diff code proposals through the dashboard. Proposals are limited to repository source, test, documentation, and notes paths; secrets, environment files, Git internals, workspace data, dependencies, and traversal paths are rejected.
- Applying a proposal requires explicit operator confirmation, `git apply --check`, TypeScript validation, and the complete test suite. A failed validation attempts to reverse the patch. Warden does not execute arbitrary model-generated shell commands.
- The explicit dashboard restart operation starts the fixed `npm start` entry point and exits the current process. Dependency installation remains a separate deliberate maintenance action.
- Confidential work should use an explicitly scoped private project with named participants and review status. Warden must not silently monitor all chat or conceal administrative actions from owners; suspicious requests are refused and escalated to authorized owners.

## Future improvements

A later version may add a sanitized export/backup command, change detection, permission diff review, and richer integration tests. Destructive deletion remains a separate, opt-in, owner-confirmed operation and is never part of ordinary setup apply.
