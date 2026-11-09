export type ConversationIntent =
  | { kind: "rollout-preview" }
  | { kind: "rollout-request" }
  | { kind: "lockdown-status" }
  | { kind: "lockdown-request"; enabled: boolean }
  | { kind: "smoke-preview" }
  | { kind: "smoke-run" }
  | { kind: "smoke-cleanup" }
  | { kind: "status" }
  | { kind: "chat"; question: string };

export function conversationIntent(input: string): ConversationIntent {
  const text = input.trim();
  const normalized = text.toLocaleLowerCase();
  if (/\b(lock|lockdown|freeze|close)\b/.test(normalized) && !/\b(status|what|is)\b/.test(normalized)) return { kind: "lockdown-request", enabled: true };
  if (/\b(unlock|open|lift|release)\b.*\b(lockdown|server|gates)\b/.test(normalized)) return { kind: "lockdown-request", enabled: false };
  if (/\blockdown\b.*\b(status|active|enabled|disabled)\b|\bstatus\b.*\blockdown\b/.test(normalized)) return { kind: "lockdown-status" };
  if (/\b(smoke|test)\b.*\b(clean|cleanup|remove)\b/.test(normalized)) return { kind: "smoke-cleanup" };
  if ((/\b(smoke|system test)\b.*\b(run|post|execute|start)\b/.test(normalized) || /\b(run|post|execute|start)\b.*\b(smoke|system test)\b/.test(normalized))) return { kind: "smoke-run" };
  if ((/\b(smoke|system test)\b.*\b(preview|plan|check)\b/.test(normalized) || /\b(preview|plan|check)\b.*\b(smoke|system test)\b/.test(normalized))) return { kind: "smoke-preview" };
  if (/\b(deploy|rollout|build|rebuild|restore|open)\b.*\b(server|guild|aeloria|forgotten ring)\b/.test(normalized)) return { kind: "rollout-request" };
  if (/\b(rollout|deployment|deploy)\b.*\b(preview|plan|dry run)\b/.test(normalized)) return { kind: "rollout-preview" };
  if (/\b(status|health|how are we|what's happening|whats happening)\b/.test(normalized)) return { kind: "status" };
  return { kind: "chat", question: text };
}

export function explicitConfirmation(input: string): boolean {
  return /^(yes|yeah|yep|confirm|confirmed|do it|proceed|go ahead|open it|lock it down|lift it)\b[\s!.]*$/i.test(input.trim());
}

export function explicitCancellation(input: string): boolean {
  return /^(no|nope|cancel|stop|never mind|nevermind|don't|do not)\b/i.test(input.trim());
}
