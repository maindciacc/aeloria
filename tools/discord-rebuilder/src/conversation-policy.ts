export type ConversationDeletionProposal = {
  ownerId: string;
  guildId: string;
  channelId: string;
  expiresAt: number;
  resourceIds: string[];
};

const CONFIRMATION = /^(?:yes,?\s+delete\s+(?:those|them)|confirm(?:\s+deletion)?|delete\s+(?:those|them)|go ahead and delete\s+(?:those|them)|do it)$/i;
const CANCELLATION = /\b(?:no|not|don't|do not|cancel|stop|never mind|nevermind)\b/i;

export function isDeletionConfirmation(message: string): boolean {
  const normalized = message.trim().replace(/\s+/g, " ");
  return CONFIRMATION.test(normalized) && !CANCELLATION.test(normalized);
}

export function isDeletionCancellation(message: string): boolean {
  return CANCELLATION.test(message);
}

export function deletionProposalValid(proposal: ConversationDeletionProposal | undefined, ownerId: string, guildId: string, channelId: string, now = Date.now()): boolean {
  return Boolean(proposal && proposal.ownerId === ownerId && proposal.guildId === guildId && proposal.channelId === channelId && proposal.expiresAt >= now && proposal.resourceIds.length > 0);
}
