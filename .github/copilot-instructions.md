# Copilot Instructions

## Project Guidelines
- Project security requirement: any elevated Warden/admin mode must be owner-only, configured locally, and application-level rather than granting Discord Administrator to the bot.
- The game server is named "The Forgotten Ring," and the world/lore identity is "Aeloria" unless specified otherwise.

## Development Instructions
- When asked to resume or build the project, implement the changes in the workspace and validate them instead of only describing the work.
- When the user provides a copied GitHub URL or username, treat it as authoritative and do not correct or alter the spelling based on assumptions.
- Warden must support a true first-join bootstrap into a blank Discord guild containing only one channel and the bot's own role, configuring the server interactively/on the fly rather than assuming the manifest structure already exists.- Interact with Warden through natural conversational messages rather than slash commands; commandless conversational UX should be the default where safe.

## Moderation Guidelines
- During lockdown, configured moderation staff must retain full access to all normal/public channels to handle incidents without the owner doing everything; only ordinary members are restricted to the holding area. Do not hide public areas from staff during lockdown.