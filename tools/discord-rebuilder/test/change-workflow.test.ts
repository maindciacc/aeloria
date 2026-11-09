import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCodeProposal, listCodeProposals } from "../src/change-workflow.js";

test("code proposals are stored for review without applying changes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "aeloria-code-review-"));
  try {
    const proposal = await createCodeProposal(workspace, "Improve Warden", "--- a/tools/discord-rebuilder/src/index.ts\n+++ b/tools/discord-rebuilder/src/index.ts\n@@\n-old\n+new\n", "salty");
    assert.equal(proposal.status, "pending");
    assert.deepEqual((await listCodeProposals(workspace)).map((item) => item.id), [proposal.id]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("code proposals reject environment and traversal paths", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "aeloria-code-review-"));
  try {
    await assert.rejects(() => createCodeProposal(workspace, "Unsafe", "--- a/.env\n+++ b/.env\n@@\n-old\n+new\n", "salty"));
    await assert.rejects(() => createCodeProposal(workspace, "Unsafe", "--- a/../secret.txt\n+++ b/../secret.txt\n@@\n-old\n+new\n", "salty"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
