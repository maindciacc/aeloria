import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type LoreDraft = {
  title: string;
  content: string;
  authorId: string;
  authorName: string;
};

function safeSlug(value: string): string {
  const slug = value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "untitled-draft";
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function draftMarkdown(draft: LoreDraft): string {
  return `# ${draft.title}\n\n- Status: Draft\n- Proposed by: ${draft.authorName} (${draft.authorId})\n- Created: ${new Date().toISOString()}\n\n> This is a proposal, not approved Aeloria canon.\n\n${draft.content.trim()}\n`;
}

export async function writeLoreDraft(repositoryRoot: string, draft: LoreDraft): Promise<string> {
  const folder = resolve(repositoryRoot, "docs", "lore", "drafts");
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${nowStamp()}-${safeSlug(draft.title)}.md`);
  await writeFile(path, draftMarkdown(draft), "utf8");
  return path;
}

export async function recordLoreApproval(repositoryRoot: string, draft: LoreDraft, approverId: string, approverName: string): Promise<string> {
  const path = resolve(repositoryRoot, "docs", "canon", "canon-register.md");
  const entry = `\n\n## Approved lore proposal: ${draft.title}\n\n- Proposed by: ${draft.authorName} (${draft.authorId})\n- Approved by: ${approverName} (${approverId})\n- Approved: ${new Date().toISOString()}\n\n${draft.content.trim()}\n`;
  await appendFile(path, entry, "utf8");
  return path;
}
