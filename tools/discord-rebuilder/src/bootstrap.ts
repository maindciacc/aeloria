export type BootstrapSnapshot = {
  textChannelCount: number;
  categoryCount: number;
  humanRoleCount: number;
  botManagedRoleCount: number;
};

export function isFirstRunBlankGuild(snapshot: BootstrapSnapshot): boolean {
  return snapshot.textChannelCount === 1
    && snapshot.categoryCount === 0
    && snapshot.humanRoleCount === 0
    && snapshot.botManagedRoleCount >= 1;
}

export function bootstrapChannelId(current: string | undefined, channelId: string): string {
  return current?.trim() || channelId;
}

export function bootstrapWelcomeMessage(): string {
  return [
    "**Warden is here. This guild is currently a blank slate.**",
    "",
    "I can build Aeloria from the checked-in manifest: roles, categories, channels, tailored welcome posts, reaction roles, onboarding, and a setup conversation.",
    "",
    "Talk to me naturally in this channel. Try:",
    "- `show me the setup plan`",
    "- `what settings can we change?`",
    "- `deploy the full setup`",
    "",
    "I will preview first. Only the configured owner can confirm creation, and I will not delete anything or grant Administrator.",
  ].join("\n");
}
