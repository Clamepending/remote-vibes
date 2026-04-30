// Unit + CLI tests for src/research/queue-edit.js + bin/vr-research-queue.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  addQueueRow,
  removeQueueRow,
  reprioritizeQueueRow,
  __internal,
} from "../src/research/queue-edit.js";

const VR_QUEUE = path.resolve("bin/vr-research-queue");

function tmp(prefix) { return mkdtempSync(join(tmpdir(), `${prefix}-`)); }

function runCli(args, { cwd, env = {}, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [VR_QUEUE, ...args], {
      cwd, env: { ...process.env, ...env },
    });
    let stdout = "", stderr = "";
    let settled = false;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} settle(null); }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => { stderr += `\n[spawn error] ${err.message}`; settle(null); });
    child.on("exit", (code) => settle(code));
  });
}

function makeProject(prefix, rowCount = 0) {
  const dir = tmp(prefix);
  const rows = [];
  for (let i = 1; i <= rowCount; i += 1) {
    rows.push(`| q${i} | main | seed move ${i} |`);
  }
  const tableBody = rows.length ? rows.join("\n") + "\n" : "";
  writeFileSync(join(dir, "README.md"), [
    "# example",
    "",
    "## QUEUE",
    "",
    "| move | starting-point | why |",
    "|------|----------------|-----|",
    tableBody,
    "## LOG",
    "",
    "| date | event | slug or ref | one-line summary | link |",
    "|------|-------|-------------|-------------------|------|",
    "",
  ].join("\n"));
  return dir;
}

// ---- addQueueRow ----

test("add: appends to empty queue", async () => {
  const dir = makeProject("vr-q-empty", 0);
  try {
    const readmePath = join(dir, "README.md");
    const result = await addQueueRow({
      readmePath,
      row: { slug: "v1-newer", startingPoint: "main", why: "first move" },
    });
    assert.equal(result.added.slug, "v1-newer");
    assert.equal(result.added.position, 1);
    assert.equal(result.bumped, null);
    const after = readFileSync(readmePath, "utf8");
    assert.match(after, /\| v1-newer \| main \| first move \|/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("add: appends at the end by default", async () => {
  const dir = makeProject("vr-q-tail", 2);
  try {
    const readmePath = join(dir, "README.md");
    const result = await addQueueRow({
      readmePath,
      row: { slug: "v3-new", startingPoint: "main", why: "next" },
    });
    assert.equal(result.added.position, 3);
    const after = readFileSync(readmePath, "utf8");
    const q1Idx = after.indexOf("| q1 |");
    const q2Idx = after.indexOf("| q2 |");
    const newIdx = after.indexOf("| v3-new |");
    assert.ok(q1Idx < q2Idx && q2Idx < newIdx, "new row should be after existing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("add at position 1: shifts existing rows down", async () => {
  const dir = makeProject("vr-q-front", 2);
  try {
    const readmePath = join(dir, "README.md");
    await addQueueRow({
      readmePath,
      row: { slug: "v0-priority", startingPoint: "main", why: "highest" },
      position: 1,
    });
    const after = readFileSync(readmePath, "utf8");
    const newIdx = after.indexOf("| v0-priority |");
    const q1Idx = after.indexOf("| q1 |");
    assert.ok(newIdx < q1Idx, "v0-priority should precede q1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("add: 6th row gets bumped past the cap", async () => {
  const dir = makeProject("vr-q-bump", 5);
  try {
    const readmePath = join(dir, "README.md");
    const result = await addQueueRow({
      readmePath,
      row: { slug: "v6-overflow", startingPoint: "main", why: "extra" },
    });
    // The new row was appended at position 6, then bumped because >cap.
    assert.ok(result.bumped, "expected bumped row");
    assert.equal(result.bumped.slug, "v6-overflow");
    const after = readFileSync(readmePath, "utf8");
    assert.equal(/v6-overflow/.test(after), false, "bumped row should not be in README");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("add: existing row pushed past cap by front-insert is bumped", async () => {
  const dir = makeProject("vr-q-bump-tail", 5);
  try {
    const readmePath = join(dir, "README.md");
    const result = await addQueueRow({
      readmePath,
      row: { slug: "v0-priority", startingPoint: "main", why: "highest" },
      position: 1,
    });
    assert.ok(result.bumped, "expected bumped row");
    assert.equal(result.bumped.slug, "q5", `expected q5 to be bumped, got ${result.bumped.slug}`);
    const after = readFileSync(readmePath, "utf8");
    assert.equal(/\| q5 \|/.test(after), false);
    // v0-priority at top, q1..q4 follow.
    assert.match(after, /\| v0-priority \| main \| highest \|/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("add: rejects duplicate slug", async () => {
  const dir = makeProject("vr-q-dup", 2);
  try {
    await assert.rejects(
      addQueueRow({
        readmePath: join(dir, "README.md"),
        row: { slug: "q1", startingPoint: "main", why: "x" },
      }),
      /already has a row for slug "q1"/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("add: rejects gap-leaving position", async () => {
  const dir = makeProject("vr-q-gap", 2);
  try {
    await assert.rejects(
      addQueueRow({
        readmePath: join(dir, "README.md"),
        row: { slug: "x", startingPoint: "main", why: "x" },
        position: 5,
      }),
      /would leave a gap/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- removeQueueRow ----

test("remove: drops the row + preserves order", async () => {
  const dir = makeProject("vr-q-remove", 4);
  try {
    const readmePath = join(dir, "README.md");
    await removeQueueRow({ readmePath, slug: "q2" });
    const after = readFileSync(readmePath, "utf8");
    assert.equal(/\| q2 \|/.test(after), false);
    const q1Idx = after.indexOf("| q1 |");
    const q3Idx = after.indexOf("| q3 |");
    const q4Idx = after.indexOf("| q4 |");
    assert.ok(q1Idx < q3Idx && q3Idx < q4Idx);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("remove: errors when slug not found", async () => {
  const dir = makeProject("vr-q-remove-miss", 2);
  try {
    await assert.rejects(
      removeQueueRow({ readmePath: join(dir, "README.md"), slug: "nope" }),
      /no row for slug "nope"/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- reprioritizeQueueRow ----

test("reprioritize: moves a row to a higher position", async () => {
  const dir = makeProject("vr-q-reprio-up", 4);
  try {
    const readmePath = join(dir, "README.md");
    // Initial order: q1, q2, q3, q4. Move q3 to row 1.
    const result = await reprioritizeQueueRow({
      readmePath,
      slug: "q3",
      toRow: 1,
    });
    assert.equal(result.fromRow, 3);
    assert.equal(result.toRow, 1);
    const after = readFileSync(readmePath, "utf8");
    const q3Idx = after.indexOf("| q3 |");
    const q1Idx = after.indexOf("| q1 |");
    const q2Idx = after.indexOf("| q2 |");
    assert.ok(q3Idx < q1Idx, "q3 should now be first");
    assert.ok(q1Idx < q2Idx, "q1 still precedes q2");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reprioritize: moves a row to a lower position", async () => {
  const dir = makeProject("vr-q-reprio-down", 4);
  try {
    const readmePath = join(dir, "README.md");
    await reprioritizeQueueRow({
      readmePath,
      slug: "q1",
      toRow: 4,
    });
    const after = readFileSync(readmePath, "utf8");
    const q1Idx = after.indexOf("| q1 |");
    const q4Idx = after.indexOf("| q4 |");
    assert.ok(q4Idx < q1Idx, "q1 should now follow q4");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reprioritize: errors on slug not found", async () => {
  const dir = makeProject("vr-q-reprio-miss", 2);
  try {
    await assert.rejects(
      reprioritizeQueueRow({ readmePath: join(dir, "README.md"), slug: "nope", toRow: 1 }),
      /no row for slug "nope"/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reprioritize: errors on toRow > queue length", async () => {
  const dir = makeProject("vr-q-reprio-overflow", 2);
  try {
    await assert.rejects(
      reprioritizeQueueRow({ readmePath: join(dir, "README.md"), slug: "q1", toRow: 5 }),
      /toRow 5 > queue length 2/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- bin/vr-research-queue ----

test("vr-research-queue --help: exits 0", async () => {
  const r = await runCli(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /vr-research-queue/);
});

test("vr-research-queue add: appends row + prints confirmation", async () => {
  const dir = makeProject("vr-q-cli-add", 1);
  try {
    const r = await runCli([
      dir, "add",
      "--slug", "vk",
      "--starting-point", "main",
      "--why", "next move",
    ]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /added vk at position 2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vr-research-queue add at full queue: prints bumped + exits 0", async () => {
  const dir = makeProject("vr-q-cli-bump", 5);
  try {
    const r = await runCli([
      dir, "add",
      "--slug", "vk",
      "--starting-point", "main",
      "--why", "extra",
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /bumped: vk fell off the end/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vr-research-queue remove: drops row", async () => {
  const dir = makeProject("vr-q-cli-remove", 2);
  try {
    const r = await runCli([dir, "remove", "--slug", "q1"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /removed q1 from QUEUE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vr-research-queue reprioritize: prints from→to summary", async () => {
  const dir = makeProject("vr-q-cli-reprio", 3);
  try {
    const r = await runCli([dir, "reprioritize", "--slug", "q3", "--to-row", "1"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /reprioritized q3: row 3 → 1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vr-research-queue --json: structured output", async () => {
  const dir = makeProject("vr-q-cli-json", 2);
  try {
    const r = await runCli([
      dir, "add",
      "--slug", "vj",
      "--starting-point", "main",
      "--why", "y",
      "--json",
    ]);
    assert.equal(r.status, 0);
    const body = JSON.parse(r.stdout);
    assert.equal(body.added.slug, "vj");
    assert.equal(body.added.position, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
