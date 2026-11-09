import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const MAX_PATCH_CHARS = 250_000;
const SAFE_PATCH_PATH = /^(a|b)\/(?:docs|notes|tools\/discord-rebuilder\/(?:src|test))\/[^\0]+$/;
const BLOCKED_PATCH_PATH = /(^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|node_modules(?:\/|$)|\.warden-workspace(?:\/|$)|.*\.(?:pem|key|pfx))$/i;

type ProposalStatus = "pending" | "applied" | "rejected";

export type CodeProposal = {
  id: string;
  title: string;
  authorId: string;
  createdAt: string;
  status: ProposalStatus;
  patchFile: string;
  result?: string[];
};

export type ValidationResult = {
  ok: boolean;
  lines: string[];
};

function proposalRoot(workspacePath: string): string {
  return resolve(workspacePath, "review-queue", "code");
}

function proposalMetadataPath(workspacePath: string, id: string): string {
  return join(proposalRoot(workspacePath), `${id}.json`);
}

function proposalPatchPath(workspacePath: string, id: string): string {
  return join(proposalRoot(workspacePath), `${id}.patch`);
}

function validatePatchPaths(patch: string): void {
  const paths = [...patch.matchAll(/^(?:---|\+\+\+) ([^\t\r\n]+)(?:\t[^\r\n]*)?$/gm)].map((match) => match[1]);
  if (paths.length === 0 || paths.length % 2 !== 0) throw new Error("A unified diff with file paths is required.");
  for (const path of paths) {
    if (!SAFE_PATCH_PATH.test(path) || BLOCKED_PATCH_PATH.test(path) || path.includes("..")) throw new Error(`Patch path is not allowed: ${path}`);
  }
}

async function run(command: string, args: string[], cwd: string): Promise<string[]> {
  try {
    const result = await execFileAsync(command, args, { cwd, windowsHide: true, maxBuffer: 1_000_000 });
    return [result.stdout.trim(), result.stderr.trim()].filter(Boolean);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error([failure.stdout, failure.stderr, failure.message].filter(Boolean).join("\n"));
  }
}

async function readProposal(workspacePath: string, id: string): Promise<CodeProposal> {
  return JSON.parse(await readFile(proposalMetadataPath(workspacePath, id), "utf8")) as CodeProposal;
}

async function saveProposal(workspacePath: string, proposal: CodeProposal): Promise<void> {
  await writeFile(proposalMetadataPath(workspacePath, proposal.id), `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
}

export async function listCodeProposals(workspacePath: string): Promise<CodeProposal[]> {
  const root = proposalRoot(workspacePath);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const proposals: CodeProposal[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try { proposals.push(await readProposal(workspacePath, entry.name.slice(0, -5))); } catch { continue; }
  }
  return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createCodeProposal(workspacePath: string, title: string, patch: string, authorId: string): Promise<CodeProposal> {
  if (!title.trim() || title.length > 200) throw new Error("A proposal title up to 200 characters is required.");
  if (!patch.trim() || patch.length > MAX_PATCH_CHARS) throw new Error("A non-empty patch up to 250,000 characters is required.");
  validatePatchPaths(patch);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const proposal: CodeProposal = { id, title: title.trim(), authorId, createdAt: new Date().toISOString(), status: "pending", patchFile: `${id}.patch` };
  await mkdir(proposalRoot(workspacePath), { recursive: true });
  await writeFile(proposalPatchPath(workspacePath, id), patch, "utf8");
  await saveProposal(workspacePath, proposal);
  return proposal;
}

export async function validateCodeProposal(repositoryRoot: string, workspacePath: string, id: string): Promise<ValidationResult> {
  const proposal = await readProposal(workspacePath, id);
  if (proposal.status !== "pending") return { ok: false, lines: [`Proposal is ${proposal.status}; only pending proposals can be validated.`] };
  try {
    const lines = await run("git", ["apply", "--check", "--whitespace=error-all", proposalPatchPath(workspacePath, id)], repositoryRoot);
    return { ok: true, lines: ["Patch applies cleanly.", ...lines] };
  } catch (error) {
    return { ok: false, lines: [error instanceof Error ? error.message : "Patch validation failed."] };
  }
}

export async function applyCodeProposal(repositoryRoot: string, workspacePath: string, id: string, confirmedBy: string): Promise<ValidationResult> {
  const proposal = await readProposal(workspacePath, id);
  if (proposal.status !== "pending") return { ok: false, lines: [`Proposal is ${proposal.status}; only pending proposals can be applied.`] };
  const validation = await validateCodeProposal(repositoryRoot, workspacePath, id);
  if (!validation.ok) return validation;
  try {
    await run("git", ["apply", "--whitespace=error-all", proposalPatchPath(workspacePath, id)], repositoryRoot);
    const typecheck = await run("npm", ["run", "typecheck"], join(repositoryRoot, "tools", "discord-rebuilder"));
    const tests = await run("npm", ["test"], join(repositoryRoot, "tools", "discord-rebuilder"));
    proposal.status = "applied";
    proposal.result = [`Applied and validated by ${confirmedBy}.`, ...typecheck, ...tests];
    await saveProposal(workspacePath, proposal);
    return { ok: true, lines: proposal.result };
  } catch (error) {
    try { await run("git", ["apply", "--reverse", proposalPatchPath(workspacePath, id)], repositoryRoot); } catch { /* preserve the original failure */ }
    proposal.status = "rejected";
    proposal.result = [error instanceof Error ? error.message : "Validation failed; patch was rejected."];
    await saveProposal(workspacePath, proposal);
    return { ok: false, lines: proposal.result };
  }
}
