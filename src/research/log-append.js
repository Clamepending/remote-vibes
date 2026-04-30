// Surgical insert of a new LOG row at the top of the project's LOG.md
// table (newest-first, per CLAUDE.md). The agent calls this once per move
// resolution instead of hand-editing markdown.
//
// LOG.md is a sibling of README.md inside projects/<name>/ and contains a
// single markdown table. We find the table separator line and insert
// immediately after it.
//
// We work via string surgery rather than a full parse + rebuild because:
//   1. LOG.md may carry intro prose above the table that we don't model.
//   2. The table is append-grow-only, so a targeted insert preserves
//      every existing row's exact formatting.
//
// API:
//
//   const result = await appendLogRow({
//     logPath,           // absolute path to LOG.md
//     row: {
//       date,            // YYYY-MM-DD; defaults to today
//       event,           // required, e.g. "resolved+admitted"
//       slug,            // required
//       summary,         // required
//       link,            // optional
//     },
//   });
//   // → { logPath, row, inserted: true }

import { readFile, writeFile, rename } from "node:fs/promises";

// The CLAUDE.md schema for LOG row events. The "primary tag" is one of
// these; admission outcomes are appended as `+admitted` or `+evicted`.
// We don't enforce a strict whitelist — the agent might encode novel
// events — but we do reject obviously malformed inputs (empty strings,
// pipe characters that would break the table, newlines).
const PIPE_OR_NEWLINE = /[|\n\r]/;

function todayUtc() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeCell(value) {
  // Markdown table cells: backslash-escape pipes, replace newlines with
  // spaces. The agent rarely wants a literal pipe in a summary, but if it
  // happens, this preserves the table's structural integrity.
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function validateRow(row) {
  if (!row) throw new Error("row is required");
  const errs = [];
  if (!row.event || !String(row.event).trim()) errs.push("event is required");
  if (!row.slug || !String(row.slug).trim()) errs.push("slug is required");
  if (!row.summary || !String(row.summary).trim()) errs.push("summary is required");
  if (row.event && PIPE_OR_NEWLINE.test(String(row.event))) errs.push("event contains pipe or newline");
  if (row.slug && PIPE_OR_NEWLINE.test(String(row.slug))) errs.push("slug contains pipe or newline");
  if (errs.length) throw new Error(`invalid LOG row: ${errs.join("; ")}`);
}

// Atomic write: tmp + rename. A Ctrl-C between writes can't leave the
// LOG file half-edited.
async function atomicWrite(filePath, body) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, body, "utf8");
  await rename(tmpPath, filePath);
}

// Locate the LOG table separator line (the `|------|...` line directly
// after the canonical 5-column header). Returns the index immediately
// after the separator's trailing newline, or -1 if not found.
//
// We anchor on the canonical column names (date / event / slug / summary /
// link, in order) rather than the first table in the file, so LOG.md can
// carry other tables (notes, references) above the LOG without breaking
// the insert. Case-insensitive on column names; tolerates extra whitespace.
function findLogTableInsertPoint(text) {
  const re = /(\|[^\n]*?\bdate\b[^\n]*?\bevent\b[^\n]*?\bslug\b[^\n]*?\bsummary\b[^\n]*?\blink\b[^\n]*\|)\n(\|[\s|:-]+\|)\n/i;
  const match = re.exec(text);
  if (!match) return -1;
  return match.index + match[0].length;
}

export function renderLogRow(row) {
  const date = String(row.date || todayUtc());
  const event = sanitizeCell(row.event);
  const slug = sanitizeCell(row.slug);
  const summary = sanitizeCell(row.summary);
  const link = sanitizeCell(row.link || "");
  return `| ${date} | ${event} | ${slug} | ${summary} | ${link} |`;
}

export async function appendLogRow({ logPath, row } = {}) {
  if (!logPath) throw new TypeError("logPath is required");
  validateRow(row);
  const text = await readFile(logPath, "utf8");
  const insertOffset = findLogTableInsertPoint(text);
  if (insertOffset < 0) {
    throw new Error(`no LOG table found in ${logPath} (expected a markdown table with a header row)`);
  }
  const normalized = {
    date: row.date || todayUtc(),
    event: String(row.event).trim(),
    slug: String(row.slug).trim(),
    summary: String(row.summary).trim(),
    link: row.link ? String(row.link).trim() : "",
  };
  const newRow = `${renderLogRow(normalized)}\n`;
  const out = text.slice(0, insertOffset) + newRow + text.slice(insertOffset);
  await atomicWrite(logPath, out);
  return { logPath, row: normalized, inserted: true };
}

export const __internal = {
  findLogTableInsertPoint,
  sanitizeCell,
  todayUtc,
  validateRow,
};
