# The Forgotten Ring Warden — Privacy Policy

_Last updated: 2026-11-09_

This policy describes the data handling of the self-hosted Warden of the First Lock bot for The Forgotten Ring and the Aeloria project.

## Data the bot receives

Discord sends the bot the information required for enabled features, which may include Discord user IDs, usernames, guild/channel/message IDs, role membership, reaction events, command inputs, and message content where the operator has enabled direct mentions, audits, or the role panel.

The bot is restricted to the configured guild. It does not intentionally monitor every channel or capture voice audio.

## How data is used

The bot uses Discord data only to:

- authorize configured operators and owners;
- add or remove explicitly self-selectable roles;
- maintain the configured server structure;
- answer explicitly requested project questions;
- compare selected channel posts with repository guidance when an operator runs an audit.

## Local processing

Project documents and configured local memory are read from the operator's repository and local Obsidian vault. When enabled, they are sent to the operator's configured local Ollama endpoint. The Warden does not send this material to a hosted AI provider by design.

The bot does not silently train a model, sell personal information, or automatically archive ordinary Discord conversation into project memory.

## Retention

The bot does not intentionally persist ordinary command or message content as a remote service. Local logs, Ollama logs, Discord retention, and Obsidian notes are controlled by the operator's machine and configuration. Curated memory is written only through explicit local workflows.

Discord itself may retain data under Discord's policies.

## Sharing

The project does not intentionally sell or share member data. Discord transmits data to the bot under Discord's platform operation. Local Ollama receives only the context sent by the operator's enabled local configuration.

## Your choices

Do not use the bot's optional chat or role features if you do not want to provide the corresponding Discord interaction. Ask the server maintainers to remove a self-selectable role or correct a project-memory note. Questions about server records should be directed to the project maintainers.

## Changes

This policy may be updated when bot features or data handling change. The effective date above identifies the current version.
