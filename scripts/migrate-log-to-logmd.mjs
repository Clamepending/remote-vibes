// One-shot migration: move each project's `## LOG` section out of
// projects/<name>/README.md into a sibling LOG.md, replacing the README
// section body with a pointer line. Idempotent: if LOG.md already exists
// or the README section is already a pointer, the project is skipped.
//
// Usage: node scripts/migrate-log-to-logmd.mjs <projects-dir>

import { readFile, writeFile, stat } from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";

const projectsDir = process.argv[2] || path.resolve("projects");

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

function extractLogSection(text) {
  // Returns { before, headingLine, body, after } or null if no `## LOG`.
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+LOG\s*$/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return {
    before: lines.slice(0, start).join("\n"),
    headingLine: lines[start],
    body: lines.slice(start + 1, end).join("\n"),
    after: lines.slice(end).join("\n"),
  };
}

function bodyHasTableRows(body) {
  const lines = body.split("\n");
  let sawSeparator = false;
  for (const line of lines) {
    if (/^\|\s*[-:]+/.test(line)) { sawSeparator = true; continue; }
    if (sawSeparator && /^\|.+\|/.test(line)) {
      // A row line after the separator. Skip placeholder rows.
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^[—–\-]*$/.test(c) || /^\*?\(\s*empty[^)]*\)\*?$/i.test(c))) continue;
      return true;
    }
  }
  return false;
}

const projectNames = readdirSync(projectsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("."))
  .map((e) => e.name);

let migrated = 0;
let skipped = 0;
for (const name of projectNames) {
  const projectDir = path.join(projectsDir, name);
  const readmePath = path.join(projectDir, "README.md");
  const logPath = path.join(projectDir, "LOG.md");
  if (!(await pathExists(readmePath))) { skipped += 1; continue; }
  if (await pathExists(logPath)) { console.log(`skip ${name}: LOG.md already exists`); skipped += 1; continue; }

  const text = await readFile(readmePath, "utf8");
  const section = extractLogSection(text);
  if (!section) { console.log(`skip ${name}: no ## LOG section`); skipped += 1; continue; }

  // Build LOG.md. If the README's LOG section had table rows, carry them
  // over verbatim. If it was empty (header-only or just prose), still
  // create a header+separator-only LOG.md so the doctor's
  // `log_file_missing` check passes after migration.
  const carriedBody = bodyHasTableRows(section.body)
    ? section.body.trim()
    : [
      "| date | event | slug or ref | one-line summary | link |",
      "|------|-------|-------------|------------------|------|",
    ].join("\n");
  const logBody = [
    `# ${name} — LOG`,
    "",
    "Append-only event log. Newest first. See [README.md](./README.md) for project state (LEADERBOARD, ACTIVE, QUEUE).",
    "",
    carriedBody,
    "",
  ].join("\n");
  await writeFile(logPath, logBody, "utf8");

  // Replace README section with pointer.
  const pointer = "## LOG\n\nSee [LOG.md](./LOG.md) — append-only event history.\n";
  const newReadme = [
    section.before.replace(/\n+$/, ""),
    "",
    pointer,
    section.after.replace(/^\n+/, ""),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  await writeFile(readmePath, newReadme, "utf8");

  console.log(`migrated ${name}`);
  migrated += 1;
}

console.log(`done: ${migrated} migrated, ${skipped} skipped`);
