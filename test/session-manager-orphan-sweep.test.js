// Stream-mode children can survive the parent server's death (kill -9,
// OOM, sandbox tear-down). On the next server boot, two children would
// race the same `~/.claude/projects/<cwd>/<id>.jsonl` transcript — the
// orphan from before, plus the new `--resume <id>` spawn we own. The
// startup sweep matches our session ids against the process table and
// SIGTERMs the orphans first. These tests pin the matcher so we don't
// kill the wrong pid (false positive: catastrophic) or miss a real
// orphan (false negative: silent quota burn + transcript corruption).

import assert from "node:assert/strict";
import test from "node:test";
import { reapOrphanProviderChildren } from "../src/session-manager.js";

const SILENT_LOGGER = { warn() {}, info() {} };

test("reapOrphanProviderChildren: kills the pid whose command line carries our session id", () => {
  const psOutput = [
    " 1234 /usr/local/bin/claude --resume aaaaaaaa-1111-2222-3333-cccccccccccc --output-format stream-json",
    " 5678 /usr/bin/node /opt/random/server.js",
  ].join("\n");
  const killed = [];
  const reaped = reapOrphanProviderChildren(
    ["aaaaaaaa-1111-2222-3333-cccccccccccc"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: (pid, signal) => killed.push({ pid, signal }),
    },
  );
  assert.deepEqual(reaped, [{ pid: 1234, sessionId: "aaaaaaaa-1111-2222-3333-cccccccccccc" }]);
  assert.deepEqual(killed, [{ pid: 1234, signal: "SIGTERM" }]);
});

test("reapOrphanProviderChildren: ignores processes whose command line doesn't carry the id", () => {
  const psOutput = [
    " 1234 /usr/local/bin/claude --resume zzzzzzzz-9999-8888-7777-6666666666666",
    " 9000 /usr/bin/codex run something else",
  ].join("\n");
  const killed = [];
  const reaped = reapOrphanProviderChildren(
    ["aaaaaaaa-1111-2222-3333-cccccccccccc"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: (pid, signal) => killed.push({ pid, signal }),
    },
  );
  assert.deepEqual(reaped, []);
  assert.deepEqual(killed, []);
});

test("reapOrphanProviderChildren: skips non-claude/codex processes even if their argv matches the id", () => {
  // Defensive: a python process with the UUID in argv shouldn't be touched.
  const psOutput = [
    " 4242 python /home/foo/bar.py --notes aaaaaaaa-1111-2222-3333-cccccccccccc",
  ].join("\n");
  const killed = [];
  reapOrphanProviderChildren(
    ["aaaaaaaa-1111-2222-3333-cccccccccccc"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: (pid, signal) => killed.push({ pid, signal }),
    },
  );
  assert.deepEqual(killed, []);
});

test("reapOrphanProviderChildren: handles multiple session ids and multiple matches", () => {
  const psOutput = [
    " 100 /usr/local/bin/claude --resume aaaa-1 --output-format stream-json",
    " 200 /usr/local/bin/claude --resume bbbb-2 --output-format stream-json",
    " 300 /usr/local/bin/claude --resume cccc-3 --output-format stream-json",
    " 400 /usr/local/bin/codex --session-id aaaa-1 run",
  ].join("\n");
  const killed = [];
  const reaped = reapOrphanProviderChildren(
    ["aaaa-1", "bbbb-2"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: (pid, signal) => killed.push({ pid, signal }),
    },
  );
  assert.equal(reaped.length, 3, "two aaaa-1 matches + one bbbb-2 match");
  assert.deepEqual(killed.map((k) => k.pid).sort((a, b) => a - b), [100, 200, 400]);
});

test("reapOrphanProviderChildren: substring match alone is not enough — id must be word-bounded", () => {
  // "aaaa-1" must not match a longer id like "aaaa-12345" — UUID
  // namespacing collisions would silently kill the wrong process.
  const psOutput = [
    " 100 /usr/local/bin/claude --resume aaaa-12345 --output-format stream-json",
  ].join("\n");
  const killed = [];
  reapOrphanProviderChildren(
    ["aaaa-1"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: (pid, signal) => killed.push({ pid, signal }),
    },
  );
  assert.deepEqual(killed, [], "must not kill the longer id");
});

test("reapOrphanProviderChildren: graceful when ps fails", () => {
  const reaped = reapOrphanProviderChildren(
    ["aaaa-1"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => { throw new Error("ps not found"); },
      killProcess: () => { throw new Error("should not be called"); },
    },
  );
  assert.deepEqual(reaped, []);
});

test("reapOrphanProviderChildren: empty session ids is a no-op (no ps call)", () => {
  let psCalled = false;
  const reaped = reapOrphanProviderChildren([], {
    logger: SILENT_LOGGER,
    readProcessTable: () => { psCalled = true; return ""; },
    killProcess: () => {},
  });
  assert.deepEqual(reaped, []);
  assert.equal(psCalled, false, "must not invoke ps when there's nothing to look for");
});

test("reapOrphanProviderChildren: ESRCH (already-dead pid) is treated as success", () => {
  const psOutput = " 1234 /usr/local/bin/claude --resume aaaa-1 --output-format stream-json";
  const reaped = reapOrphanProviderChildren(
    ["aaaa-1"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: () => {
        const err = new Error("kill ESRCH");
        err.code = "ESRCH";
        throw err;
      },
    },
  );
  // Reap is recorded only when the kill actually succeeded; ESRCH paths
  // are NOT added (the pid is already gone). Either outcome is fine for
  // the user — what we're guarding against here is throwing an
  // uncaught exception during startup.
  assert.equal(Array.isArray(reaped), true);
});

test("reapOrphanProviderChildren: doesn't reap our own pid even if argv matches", () => {
  const ownPid = process.pid;
  const psOutput = ` ${ownPid} /usr/local/bin/node src/server.js --session-id aaaa-1`;
  const killed = [];
  reapOrphanProviderChildren(
    ["aaaa-1"],
    {
      logger: SILENT_LOGGER,
      readProcessTable: () => psOutput,
      killProcess: (pid, signal) => killed.push({ pid, signal }),
    },
  );
  assert.deepEqual(killed, [], "must skip our own pid");
});
