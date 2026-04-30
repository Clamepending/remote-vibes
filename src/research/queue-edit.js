// QUEUE table editor for project READMEs. Three operations matching
// CLAUDE.md's verb set:
//
//   addQueueRow({ readmePath, row, position })
//     ADD: append a new row at `position` (defaults to end). Caps at 5
//     rows. If a row would push past the cap, it's returned as
//     `bumped` so the caller can decide whether to drop it or take a
//     remove action first.
//
//   removeQueueRow({ readmePath, slug })
//     REMOVE: delete the row whose slug matches.
//
//   reprioritizeQueueRow({ readmePath, slug, toRow })
//     REPRIORITIZE: move an existing row to position `toRow` (1-indexed).
//
// Same string-surgery + atomic-write pattern as log-append / active-edit /
// leaderboard-edit. Cells:
//
//   | <slug> | <starting-point> | <why> |

import { readFile, writeFile, rename } from "node:fs/promises";

const PIPE_OR_NEWLINE = /[|\n\r]/;
const QUEUE_CAP = 5;

function sanitizeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}

async function atomicWrite(filePath, body) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, body, "utf8");
  await rename(tmpPath, filePath);
}

function locateQueueTable(text) {
  const headingMatch = /^(#{1,6})\s+QUEUE\s*$/m.exec(text);
  if (!headingMatch) return null;
  const headingEnd = headingMatch.index + headingMatch[0].length;
  const tail = text.slice(headingEnd);
  const headerMatch = /\n+(\|[^\n]+\|)\n(\|[\s|:-]+\|)\n/.exec(tail);
  if (!headerMatch) return null;
  const separatorEnd = headingEnd + headerMatch.index + headerMatch[0].length;
  let cursor = separatorEnd;
  while (cursor < text.length) {
    const lineEnd = text.indexOf("\n", cursor);
    const line = text.slice(cursor, lineEnd === -1 ? text.length : lineEnd);
    if (!line.startsWith("|")) break;
    cursor = lineEnd === -1 ? text.length : lineEnd + 1;
  }
  const tableBody = text.slice(separatorEnd, cursor);
  const dataLines = tableBody.split("\n").filter((l) => l.startsWith("|"));
  return { separatorEnd, tableEnd: cursor, dataLines };
}

function parseDataLine(line) {
  const inner = line.replace(/^\|/, "").replace(/\|\s*$/, "");
  const cells = inner.split("|").map((c) => c.trim());
  return { slug: cells[0] || "", cells };
}

export function renderQueueRow({ slug, startingPoint, why }) {
  return `| ${sanitizeCell(slug)} | ${sanitizeCell(startingPoint || "")} | ${sanitizeCell(why || "")} |`;
}

function validateAdd(row) {
  const errs = [];
  if (!row?.slug || !String(row.slug).trim()) errs.push("slug is required");
  if (row?.slug && PIPE_OR_NEWLINE.test(String(row.slug))) errs.push("slug contains pipe or newline");
  if (errs.length) throw new Error(`invalid QUEUE row: ${errs.join("; ")}`);
}

export async function addQueueRow({ readmePath, row, position } = {}) {
  if (!readmePath) throw new TypeError("readmePath is required");
  validateAdd(row);
  const text = await readFile(readmePath, "utf8");
  const loc = locateQueueTable(text);
  if (!loc) throw new Error(`no QUEUE table found in ${readmePath}`);
  const existing = loc.dataLines.map(parseDataLine);
  const slug = String(row.slug).trim();
  if (existing.some((r) => r.slug === slug)) {
    throw new Error(`QUEUE already has a row for slug "${slug}"`);
  }
  const targetPos = Number.isInteger(position) && position >= 1
    ? position
    : existing.length + 1;
  if (targetPos > existing.length + 1) {
    throw new Error(`position ${targetPos} would leave a gap (current queue has ${existing.length} rows)`);
  }
  const inserted = renderQueueRow({
    slug,
    startingPoint: row.startingPoint || "",
    why: row.why || "",
  });

  // Build the new ordered list of raw row strings.
  const merged = [];
  const existingLines = loc.dataLines.slice();
  for (let i = 0; i < existingLines.length; i += 1) {
    if (merged.length + 1 === targetPos) merged.push(inserted);
    merged.push(existingLines[i]);
  }
  if (merged.length < targetPos) merged.push(inserted);

  // Cap at QUEUE_CAP. Anything past the cap is `bumped`.
  let bumped = null;
  if (merged.length > QUEUE_CAP) {
    const fallen = merged.pop();
    const parsed = parseDataLine(fallen);
    bumped = { slug: parsed.slug, raw: fallen };
  }
  const newTable = merged.join("\n") + (merged.length ? "\n" : "");
  const updated = text.slice(0, loc.separatorEnd) + newTable + text.slice(loc.tableEnd);
  await atomicWrite(readmePath, updated);
  return { readmePath, added: { slug, position: targetPos }, bumped };
}

export async function removeQueueRow({ readmePath, slug } = {}) {
  if (!readmePath) throw new TypeError("readmePath is required");
  if (!slug || !String(slug).trim()) throw new Error("slug is required");
  const trimmed = String(slug).trim();
  const text = await readFile(readmePath, "utf8");
  const loc = locateQueueTable(text);
  if (!loc) throw new Error(`no QUEUE table found in ${readmePath}`);
  const existing = loc.dataLines.map(parseDataLine);
  const idx = existing.findIndex((r) => r.slug === trimmed);
  if (idx < 0) throw new Error(`QUEUE has no row for slug "${trimmed}"`);
  const remaining = loc.dataLines.filter((_, i) => i !== idx);
  const newTable = remaining.join("\n") + (remaining.length ? "\n" : "");
  const updated = text.slice(0, loc.separatorEnd) + newTable + text.slice(loc.tableEnd);
  await atomicWrite(readmePath, updated);
  return { readmePath, removed: true, slug: trimmed };
}

export async function reprioritizeQueueRow({ readmePath, slug, toRow } = {}) {
  if (!readmePath) throw new TypeError("readmePath is required");
  if (!slug || !String(slug).trim()) throw new Error("slug is required");
  if (!Number.isInteger(toRow) || toRow < 1) throw new Error("toRow must be an integer >= 1");
  const trimmed = String(slug).trim();
  const text = await readFile(readmePath, "utf8");
  const loc = locateQueueTable(text);
  if (!loc) throw new Error(`no QUEUE table found in ${readmePath}`);
  const lines = loc.dataLines.slice();
  const parsed = lines.map(parseDataLine);
  const idx = parsed.findIndex((r) => r.slug === trimmed);
  if (idx < 0) throw new Error(`QUEUE has no row for slug "${trimmed}"`);
  if (toRow > parsed.length) {
    throw new Error(`toRow ${toRow} > queue length ${parsed.length}`);
  }
  const [moving] = lines.splice(idx, 1);
  lines.splice(toRow - 1, 0, moving);
  const newTable = lines.join("\n") + (lines.length ? "\n" : "");
  const updated = text.slice(0, loc.separatorEnd) + newTable + text.slice(loc.tableEnd);
  await atomicWrite(readmePath, updated);
  return { readmePath, slug: trimmed, fromRow: idx + 1, toRow };
}

export const __internal = {
  locateQueueTable,
  parseDataLine,
  renderQueueRow,
  QUEUE_CAP,
};
