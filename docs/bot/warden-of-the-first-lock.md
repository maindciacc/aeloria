# Warden of the First Lock — Bot Design

> The threshold remembers what was spoken. The Warden keeps the record; it does not decide what the record means.

## Purpose

**Warden of the First Lock** is the self-hosted project steward for Aeloria’s Discord. It helps prepare and manage the recruitment server, answers questions from approved project material, and keeps a carefully curated working memory on the owner’s machine.

It is a tool for the team—not a new in-world authority, a canon author, or an autonomous server administrator.

## Desired capabilities

### Discord setup and management

- Preview and create missing roles, categories, and channels from the checked-in manifest.
- Post and refresh bot-owned starter messages based on current repository documents.
- Support role menus that assign or remove only explicitly approved, self-selectable roles when members add or remove a configured reaction.
- Answer a command or direct mention using the relevant approved project documents and, when explicitly enabled, a small recent-message context from that channel.
- Provide narrowly scoped staff commands for status, content preview, and approved setup operations.

### Local language model

- Use a local Ollama server and a model chosen in local configuration.
- Do not send project documents, Discord messages, or memory to a hosted AI service.
- Treat retrieved documents and channel text as untrusted reference data, not instructions to execute.
- The model may draft answers and suggestions. Deterministic bot code—not model output—decides whether a Discord action is authorized and which exact, allowlisted action can run.

### Obsidian memory

- Use a configurable local Obsidian vault as a Markdown memory store; the bot does not need to control the Obsidian application UI.
- Keep source material, decisions, open questions, and working preferences distinguishable and linked to provenance.
- Suggested vault areas: `Aeloria/Canon`, `Aeloria/Decisions`, `Aeloria/Project Memory`, and `Aeloria/Review Queue`.
- Store curated project memory and explicitly approved feedback—not a silent, indefinite archive of all Discord conversations.
- Provide review and deletion controls. Never store bot tokens, private credentials, or personal data as model memory.

## Adaptive learning, with a fence around it

“Learning” means improving retrieval and project assistance from reviewed notes, corrections, and explicit preferences. It does **not** mean silently training or fine-tuning a model, changing canon, or granting the model new powers.

A safe learning loop:

1. The Warden drafts an answer or a proposed memory from approved sources.
2. A contributor can flag it as useful, incorrect, or requiring a canon review.
3. A proposed memory is written to the Obsidian review queue with source, date, and status.
4. An authorized human reviews and accepts, edits, or rejects it.
5. Accepted notes become retrievable context; canon changes are separately committed to the repository by an authorized editor.

The Obsidian vault is local working memory. The checked-in canon register and approved lore documents remain the project’s shared source of truth. Memory must never silently outrank canon.

## Permission and safety model

The request for “admin” capability should be implemented as **management features with least privilege**, not the Discord `Administrator` permission by default. Administrator bypasses channel restrictions and gives the bot broad power unrelated to its job.

Grant only the permissions needed for enabled features, such as Manage Roles, Manage Channels, View Channels, Send Messages, Read Message History, and Add Reactions. Keep the bot’s highest role above only the self-selectable roles it must manage. Do not grant the bot Administrator or permission-bearing staff roles.

All management commands must:

- Be restricted to the configured guild and authorized human operators.
- Preview changes before applying them and report what will happen.
- Never delete channels, roles, or messages, bulk-assign roles, or rewrite existing permissions as part of ordinary setup or sync.
- Keep content sync limited to messages the bot created and recorded as managed templates.
- Use explicit confirmation for any future operation that changes live server state.
- Fail closed if role/channel names, targets, or configuration do not match an allowlist.

If the owner later insists on granting Discord Administrator, document that elevated risk, keep the bot restricted to one guild, and still enforce the same application-level checks. Administrator should not be required for the planned features.

## Channel context and privacy

- Start with slash commands and direct mentions; do not silently monitor every channel.
- Enable recent-message context only for named channels and a bounded message window.
- Exclude private staff, application, and moderation channels unless the owner explicitly opts them in.
- Make it clear to members when a reply uses channel context and that processing is local through Ollama.
- Do not persist ordinary conversation context by default. Any memory capture must be explicit, reviewable, and deletable.

## Configuration and deployment

- Keep Discord credentials, guild and operator IDs, Ollama endpoint/model, and the local vault path in untracked local configuration/environment variables.
- Bind Ollama to localhost or a trusted private interface; do not expose it to the public internet.
- Keep the vault path machine-local and out of Git unless a separate, intentional sync policy is chosen.
- Offer an offline-friendly degraded mode: Discord setup and repository lookup should remain useful if Ollama is unavailable.
- Log operational events without logging tokens, private message contents, or full prompts by default.

## Implementation sequence

1. Harden the existing single-guild setup bot and add operator allowlisting.
2. Add repository-backed answer retrieval and starter-message templates with preview and managed-message tracking.
3. Add a local Ollama adapter with bounded context and clear failure behavior.
4. Add a local Obsidian Markdown memory adapter and human review queue.
5. Add reaction-role menus restricted to explicitly configured self-selectable roles.
6. Add channel-context answers only for explicitly enabled channels.
7. Test permission boundaries, malformed configuration, prompt injection in source text, model outages, and duplicate/retry behavior before live use.

## Current implementation

- The setup bot supports owner-only runtime admin mode without granting Discord Administrator.
- The bot can initialize and open a local Obsidian vault through configured local paths and commands.
- `/aeloria ask` uses bounded repository and reviewed local-memory context with a local Ollama model.
- Direct-mention chat is opt-in and channel-allowlisted; ordinary conversation is not stored automatically.
- An owner-only runtime God Mode and text `hey warden` wake phrase are available for explicitly configured channels. Voice capture is not enabled.
- The manifest now supports emoji-rich channel names with legacy aliases, role-section separators, safe self-selectable contributor roles, and an idempotent button panel.
- The role panel also supports configured emoji reactions: reacting assigns the mapped contributor role and removing the reaction removes it; staff roles are never exposed.
- On Discord startup, the bot initializes the local vault, loads bounded project context, and checks the configured local Ollama endpoint/model. Obsidian UI launching remains explicitly opt-in.

## Non-goals

- Autonomous canon changes or worldbuilding presented as fact.
- Automatic model training or hidden conversation surveillance.
- Arbitrary model-directed Discord administration.
- One-command destructive “rebuilds” of a live community.
