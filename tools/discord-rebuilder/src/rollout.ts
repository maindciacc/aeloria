export type RolloutStage = "structure" | "roles" | "content" | "role-panel" | "onboarding";

export type RolloutStageResult = {
  stage: RolloutStage;
  ok: boolean;
  lines: string[];
};

export type RolloutStageRunner = (stage: RolloutStage) => Promise<string[]>;

export const ROLLOUT_STAGES: readonly RolloutStage[] = ["structure", "roles", "content", "role-panel", "onboarding"];

export type RolloutTweaks = {
  postWelcomePackage?: boolean;
  autoRoleSeparators?: boolean;
};

export type StagedRolloutSession = {
  ownerId: string;
  guildId: string;
  channelId: string;
  nextStageIndex: number;
  approved: boolean;
  tweaks: RolloutTweaks;
  expiresAt: number;
};

export function nextRolloutStage(session: StagedRolloutSession): RolloutStage | undefined {
  return ROLLOUT_STAGES[session.nextStageIndex];
}

export function describeStagedRollout(session: StagedRolloutSession): string[] {
  const next = nextRolloutStage(session);
  return [
    `Staged rollout: ${next ? `next stage is **${next}** (${session.nextStageIndex + 1}/${ROLLOUT_STAGES.length})` : "complete"}.`,
    `Approval: ${session.approved ? "ready to run" : "waiting for approval"}.`,
    `Welcome package: ${session.tweaks.postWelcomePackage === false ? "off" : "on"}.`,
    `Separator assignment: ${session.tweaks.autoRoleSeparators === false ? "off" : "on"}.`,
    next ? "Discuss or tweak this plan, then say **approve rollout** and **run next rollout stage**." : "All rollout stages are complete.",
  ];
}

export function applyRolloutTweak(session: StagedRolloutSession, request: string): string | undefined {
  const normalized = request.toLocaleLowerCase();
  if (/\bwelcome\b.*\b(off|disable|skip|no)\b/.test(normalized)) {
    session.tweaks.postWelcomePackage = false;
    session.approved = false;
    return "welcome package off";
  }
  if (/\bwelcome\b.*\b(on|enable|include|yes)\b/.test(normalized)) {
    session.tweaks.postWelcomePackage = true;
    session.approved = false;
    return "welcome package on";
  }
  if (/\b(separator|section roles?)\b.*\b(off|disable|skip|no)\b/.test(normalized)) {
    session.tweaks.autoRoleSeparators = false;
    session.approved = false;
    return "separator assignment off";
  }
  if (/\b(separator|section roles?)\b.*\b(on|enable|include|yes)\b/.test(normalized)) {
    session.tweaks.autoRoleSeparators = true;
    session.approved = false;
    return "separator assignment on";
  }
  return undefined;
}

export function approveStagedRollout(session: StagedRolloutSession): string {
  session.approved = true;
  return nextRolloutStage(session) ? `Approved **${nextRolloutStage(session)}**. Say **run next rollout stage** to execute it.` : "The rollout is already complete.";
}

export function advanceStagedRollout(session: StagedRolloutSession): void {
  session.nextStageIndex += 1;
  session.approved = false;
}

export async function runRolloutStage(stage: RolloutStage, runner: RolloutStageRunner): Promise<RolloutStageResult> {
  try {
    return { stage, ok: true, lines: await runner(stage) };
  } catch (error) {
    return { stage, ok: false, lines: [error instanceof Error ? error.message : "Stage failed."] };
  }
}

export async function runRollout(runner: RolloutStageRunner): Promise<RolloutStageResult[]> {
  const results: RolloutStageResult[] = [];
  for (const stage of ROLLOUT_STAGES) {
    try {
      results.push({ stage, ok: true, lines: await runner(stage) });
    } catch (error) {
      results.push({ stage, ok: false, lines: [error instanceof Error ? error.message : "Stage failed."] });
      break;
    }
  }
  return results;
}

export function formatRolloutResults(results: readonly RolloutStageResult[]): string[] {
  const lines = ["**Aeloria full rollout report** — no server wipe is performed by this command."];
  for (const result of results) {
    lines.push(`${result.ok ? "✓" : "✗"} ${result.stage}`);
    lines.push(...result.lines.map((line) => `  ${line}`));
  }
  if (results.length === ROLLOUT_STAGES.length && results.every((result) => result.ok)) lines.push("Rollout complete. Review the report and run /aeloria analyze for final drift verification.");
  else lines.push("Rollout stopped after a failed stage. Review the report before retrying.");
  return lines;
}
