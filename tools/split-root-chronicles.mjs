import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = new URL("../", import.meta.url).pathname.replace(/^\/(.)\:/, "$1:");
const sourcePath = join(repositoryRoot, "docs", "lore", "root-chronicles-draft.txt");
const booksPath = join(repositoryRoot, "docs", "lore", "books");
const source = await readFile(sourcePath, "utf8");
const headings = [...source.matchAll(/^##\s+(\d+)\.\s+(.+)$/gm)];
if (headings.length !== 20) throw new Error(`Expected 20 numbered books, found ${headings.length}.`);
await mkdir(booksPath, { recursive: true });
const entries = [];
for (let index = 0; index < headings.length; index += 1) {
  const match = headings[index];
  const start = match.index;
  const end = headings[index + 1]?.index ?? source.length;
  const block = source.slice(start, end).trim();
  const title = match[2].trim();
  const gameTitle = block.match(/\*\*Game title:\*\*\s*([^\\\r\n]+)/)?.[1]?.trim() ?? title;
  const place = block.match(/\*\*Place:\*\s*([^\\\r\n]+)/)?.[1]?.trim() ?? "Unspecified";
  const slug = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const bookNumber = String(index + 1).padStart(2, "0");
  const output = `# Book ${bookNumber} — ${title}\n\n- Status: Draft\n- Canon status: Pending review\n- Game title: ${gameTitle}\n- Suggested location: ${place}\n- Source: \`../root-chronicles-draft.txt\`\n\n${block}\n`;
  await writeFile(join(booksPath, `book-${bookNumber}-${slug}.md`), output, "utf8");
  entries.push({ number: bookNumber, title, gameTitle, place, file: `books/book-${bookNumber}-${slug}.md` });
}
const factoids = [
  "All twenty books are draft material until explicitly approved in the canon register.",
  "The Hunt drove the peoples from their homes but is never given a single confirmed motive.",
  "The refugees reached an Isle of mushroom soil and a silent tree later known as Ydrasil.",
  "The Promise was spoken before the Monolith in the Silent Chamber; its exact words were not preserved.",
  "The First Lock is associated with a word being spoken, taken, and forgotten.",
  "The Root Chronicles intentionally preserve conflicting accounts and unreliable archivists.",
  "The eighth root runs sideways toward the sea; the text also hints at a ninth root.",
  "The child with the lantern, the fourth verse, the black bowl, and the changed number forty-one are unresolved hooks.",
  "The Tree is bare at First Sight and blooms on day ninety-one in The First Bloom.",
  "Two pedestals stand below the roots: one holds a blank Promise book and the other waits for a future book.",
];
await writeFile(join(repositoryRoot, "docs", "lore", "root-chronicles-factoids.md"), `# Root Chronicles Factoids and Hooks\n\n- Status: Reference index derived from the draft\n- Canon status: Pending review\n- Source: \`root-chronicles-draft.txt\`\n\n${factoids.map((fact) => `- ${fact}`).join("\n")}\n\n## Review rule\n\nThese factoids are retrieval aids, not automatic canon. Resolve them through an explicit canon decision and preserve contradictions until approved.\n`, "utf8");
await writeFile(join(booksPath, "README.md"), `# Root Chronicles Books\n\nThese twenty files are generated views of \`../root-chronicles-draft.txt\`. The original draft remains unchanged. Each book keeps its Bedrock page markers and suggested in-world location.\n\n${entries.map((entry) => `${entry.number}. [${entry.title}](${entry.file}) — ${entry.gameTitle}; ${entry.place}`).join("\n")}\n`, "utf8");
console.log(`Generated ${entries.length} book files, a book index, and a factoid index.`);
