import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { draftMarkdown, recordLoreApproval, writeLoreDraft } from "../src/lore-workflow.js";

test("lore drafts are explicitly marked as non-canon", () => {
  const markdown = draftMarkdown({ title: "A New Root", content: "A proposed root remembers the Promise.", authorId: "user", authorName: "Salty" });
  assert.match(markdown, /Status: Draft/);
  assert.match(markdown, /not approved Aeloria canon/);
});

test("lore draft and approval write to the repository workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "aeloria-lore-test-"));
  try {
    await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(join(root, "docs", "canon"), { recursive: true }).then(() => writeFile(join(root, "docs", "canon", "canon-register.md"), "# Canon Register\n", "utf8")));
    const draft = { title: "The Lantern Root", content: "A draft detail.", authorId: "user", authorName: "Salty" };
    const draftPath = await writeLoreDraft(root, draft);
    assert.match(draftPath, /docs[\\/]lore[\\/]drafts/);
    const draftText = await readFile(draftPath, "utf8");
    assert.match(draftText, /Status: Draft/);
    const canonPath = await recordLoreApproval(root, draft, "owner", "Owner");
    const canonText = await readFile(canonPath, "utf8");
    assert.match(canonText, /Approved lore proposal: The Lantern Root/);
    assert.match(canonText, /Approved by: Owner \(owner\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
