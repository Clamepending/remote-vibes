// Project-level budget helpers for Vibe Research.
//
// README.md carries a small `## BUDGET` section:
//   compute: 12/80 GPU-hours
//   dollars: 4.20/200 USD
//   calendar: 2026-05-15
//
// These helpers parse that shape, debit spent amounts on move resolution, and
// report whether a human budget review is required before the next claim.

import { readFile, rename, writeFile } from "node:fs/promises";

const SECTION_HEADER_RE = /^##\s+(.+?)\s*$/;
const AXIS_RE = /^(\s*(?:-\s*)?(compute|dollars)\s*:\s*)([+-]?\d+(?:\.\d+)?)(\s*\/\s*)([+-]?\d+(?:\.\d+)?)(.*)$/i;
const CALENDAR_RE = /^\s*(?:-\s*)?calendar\s*:\s*(\d{4}-\d{2}-\d{2})\b/i;

function splitLines(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function decimalPlaces(value) {
  const match = String(value || "").match(/\.(\d+)/);
  return match ? match[1].length : 0;
}

function trimNumber(value, decimals = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric
    .toFixed(decimals)
    .replace(/\.?0+$/, "");
}

function formatAxisAmount(value, axis, spentRaw = "") {
  if (axis === "dollars") {
    return Number(value).toFixed(Math.max(2, decimalPlaces(spentRaw)));
  }
  return trimNumber(value, Math.max(0, Math.min(4, decimalPlaces(spentRaw) || 3)));
}

function parseAxisLine(line) {
  const match = AXIS_RE.exec(String(line || ""));
  if (!match) return null;
  const [, prefix, axisRaw, spentRaw, separator, capRaw, suffix] = match;
  const spent = finiteNumber(spentRaw);
  const cap = finiteNumber(capRaw);
  if (spent == null || cap == null) return null;
  const axis = axisRaw.toLowerCase();
  return {
    axis,
    prefix,
    spent,
    spentRaw,
    separator,
    cap,
    capRaw,
    suffix: suffix.trim(),
    raw: line,
  };
}

export function parseBudgetSection(body) {
  const budget = {
    raw: String(body || ""),
    compute: null,
    dollars: null,
    calendar: null,
  };
  for (const line of splitLines(body)) {
    const axis = parseAxisLine(line);
    if (axis) {
      budget[axis.axis] = axis;
      continue;
    }
    const calendar = CALENDAR_RE.exec(String(line || ""));
    if (calendar) {
      budget.calendar = { date: calendar[1], raw: line };
    }
  }
  return budget;
}

function todayIsoLocal() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function budgetCapBreaches(budget, { today = todayIsoLocal() } = {}) {
  const out = [];
  for (const axisName of ["compute", "dollars"]) {
    const axis = budget?.[axisName];
    if (!axis) continue;
    if (Number.isFinite(axis.cap) && axis.cap >= 0 && axis.spent >= axis.cap) {
      out.push({
        axis: axisName,
        spent: axis.spent,
        cap: axis.cap,
        unit: axis.suffix,
        summary: `${axisName} ${trimNumber(axis.spent)}/${trimNumber(axis.cap)}${axis.suffix ? ` ${axis.suffix}` : ""}`,
      });
    }
  }
  if (budget?.calendar?.date && today > budget.calendar.date) {
    out.push({
      axis: "calendar",
      spent: today,
      cap: budget.calendar.date,
      unit: "date",
      summary: `calendar ${today} past ${budget.calendar.date}`,
    });
  }
  return out;
}

export function isBudgetCapReached(budget, options = {}) {
  return budgetCapBreaches(budget, options).length > 0;
}

function findSectionRange(lines, sectionName) {
  const headerIndex = lines.findIndex((line) => {
    const match = SECTION_HEADER_RE.exec(line);
    return match && match[1].trim().toLowerCase() === sectionName.toLowerCase();
  });
  if (headerIndex < 0) return null;
  let end = headerIndex + 1;
  while (end < lines.length && !SECTION_HEADER_RE.test(lines[end])) end += 1;
  return { headerIndex, end };
}

function normalizeDebit(value, label) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} budget debit must be a non-negative number`);
  }
  return numeric;
}

export function normalizeBudgetDebits(debits = {}) {
  return {
    compute: normalizeDebit(debits.compute, "compute"),
    dollars: normalizeDebit(debits.dollars, "dollars"),
  };
}

export function applyBudgetDebitsToReadmeText(readmeText, debits = {}, options = {}) {
  const normalizedDebits = normalizeBudgetDebits(debits);
  const hasDebit = normalizedDebits.compute > 0 || normalizedDebits.dollars > 0;
  const lines = splitLines(readmeText);
  const section = findSectionRange(lines, "BUDGET");
  if (!section) {
    return {
      text: String(readmeText || ""),
      applied: false,
      reason: hasDebit ? "README has no BUDGET section" : "no budget debit requested",
      debits: normalizedDebits,
      budget: null,
      caps: [],
    };
  }

  const beforeBudget = parseBudgetSection(lines.slice(section.headerIndex + 1, section.end).join("\n"));
  let applied = false;
  const nextLines = lines.slice();
  for (let i = section.headerIndex + 1; i < section.end; i += 1) {
    const axis = parseAxisLine(nextLines[i]);
    if (!axis) continue;
    const debit = normalizedDebits[axis.axis] || 0;
    if (!debit) continue;
    const nextSpent = axis.spent + debit;
    nextLines[i] = `${axis.prefix}${formatAxisAmount(nextSpent, axis.axis, axis.spentRaw)}${axis.separator}${axis.capRaw}${axis.suffix ? ` ${axis.suffix}` : ""}`;
    applied = true;
  }

  const nextBody = nextLines.slice(section.headerIndex + 1, section.end).join("\n");
  const budget = parseBudgetSection(nextBody);
  const caps = budgetCapBreaches(budget, options);
  return {
    text: `${nextLines.join("\n").replace(/\n*$/, "")}\n`,
    applied,
    reason: applied || !hasDebit ? "" : "requested budget axes were not present in BUDGET",
    debits: normalizedDebits,
    before: beforeBudget,
    budget,
    caps,
  };
}

async function atomicWrite(filePath, body) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, body, "utf8");
  await rename(tmpPath, filePath);
}

export async function applyBudgetDebitsToReadme({ readmePath, debits = {}, today } = {}) {
  if (!readmePath) throw new TypeError("readmePath is required");
  const text = await readFile(readmePath, "utf8");
  const result = applyBudgetDebitsToReadmeText(text, debits, { today });
  if (result.applied) await atomicWrite(readmePath, result.text);
  return result;
}

export function summarizeBudgetCaps(caps = []) {
  if (!caps.length) return "";
  return caps.map((cap) => cap.summary).join("; ");
}

export const __internal = {
  AXIS_RE,
  applyBudgetDebitsToReadmeText,
  budgetCapBreaches,
  decimalPlaces,
  findSectionRange,
  formatAxisAmount,
  normalizeBudgetDebits,
  parseAxisLine,
  todayIsoLocal,
};
