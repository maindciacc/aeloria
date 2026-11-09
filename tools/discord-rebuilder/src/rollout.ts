export type RolloutStage = "structure" | "roles" | "content" | "role-panel" | "onboarding";

export type RolloutStageResult = {
  stage: RolloutStage;
  ok: boolean;
  lines: string[];
};

export type RolloutStageRunner = (stage: RolloutStage) => Promise<string[]>;

export const ROLLOUT_STAGES: readonly RolloutStage[] = ["structure", "roles", "content", "role-panel", "onboarding"];

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
