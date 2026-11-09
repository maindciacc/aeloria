# Discord application links and verification checklist

After the GitHub Pages workflow has deployed the `docs` folder, use these public HTTPS URLs in the Discord Developer Portal:

- Terms of Service: `https://maindciacc.github.io/aeloria/legal/terms-of-service.html`
- Privacy Policy: `https://maindciacc.github.io/aeloria/legal/privacy-policy.html`

In **Repository Settings → Pages**, select **GitHub Actions** if it is not already enabled. Confirm each URL opens in a private browser window without a GitHub login before entering it into Discord. If the repository owner uses a different GitHub Pages hostname, use the deployed workflow URL shown by GitHub instead.

## Install link

Use the Developer Portal's generated install link when possible. The equivalent bot/application-commands link is:

```text
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=268504144
```

Replace `APPLICATION_ID` with the Discord application ID. The permission value includes the current bot requirements: View Channel, Manage Channels, Send Messages, Read Message History, Add Reactions, and Manage Roles. The bot does not require Administrator.

## Portal checklist

1. Set the Terms of Service URL.
2. Set the Privacy Policy URL.
3. Set or copy the generated installation URL.
4. Enable the `Server Members Intent` when `ENABLE_AUTO_ROLE_SEPARATORS=true`.
5. Enable the `Message Content Intent` for direct mentions and `/aeloria audit`.
6. Invite the bot only to the configured The Forgotten Ring guild.
7. Place the bot's highest role above the roles it must create and manage.
8. Confirm the application owner completes Discord Identity Verification if Discord requires it.
9. Confirm every developer-team member has a verified email and 2FA.

## Adding a second human owner

Discord owner controls use the local `.env` setting:

```text
OWNER_IDS=your-discord-user-id,806272373761376288
```

The numeric Discord ID is not a GitHub account and does not grant repository access. Add the person's GitHub username separately under the repository's **Settings → Collaborators**. For true GitHub repository ownership, the repository must be transferred to an organization and the person added as an organization owner; do not put GitHub credentials in this repository or the bot's `.env`.
