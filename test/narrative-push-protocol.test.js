// End-to-end test for the WebSocket narrative push protocol.
//
// The server emits narrative-init on attach and narrative-event per
// upsert/remove. The client reducer applies them and produces the entries
// the renderer reads. This test wires both sides together with no real
// browser — it drives the server's broadcast methods directly, captures
// the JSON frames a real WebSocket would carry, and feeds them into the
// client's reducer (imported as a pure module). What comes out of the
// reducer should match what the server thinks the session contains.

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import {
  applyNarrativeFrame,
  createInitialNarrativeState,
  selectNarrativeEntries,
  NARRATIVE_FRAME_TYPES,
  NARRATIVE_SCHEMA_VERSION,
} from "../src/narrative-schema.js";
import { SessionManager } from "../src/session-manager.js";

const fakeProviders = [
  { id: "claude", label: "Claude Code", available: true, command: "claude", launchCommand: "claude", defaultName: "Claude" },
];

// Minimal mock of the WebSocket the SessionManager talks to. Captures
// every send() into a queue we can inspect.
function makeMockSocket() {
  const sent = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    sent,
    send(payload) {
      sent.push(typeof payload === "string" ? JSON.parse(payload) : payload);
    },
    on() {},
    close() { socket.readyState = 3; },
  };
  return socket;
}

async function withManager(fn) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-narrative-push-"));
  const userHomeDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-narrative-push-home-"));
  const manager = new SessionManager({
    cwd: workspaceDir,
    providers: fakeProviders,
    persistentTerminals: false,
    persistSessions: false,
    stateDir: path.join(workspaceDir, ".vibe-research"),
    userHomeDir,
  });
  await manager.initialize();
  try {
    await fn(manager);
  } finally {
    await manager.shutdown({ preserveSessions: false });
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  }
}

function makeStreamSession(manager, { id = "stream-test-1" } = {}) {
  // Build a stream-mode session shell directly. We don't actually start a
  // Claude child process — we only exercise the broadcast methods, which
  // operate on session.streamEntries and session.clients.
  const session = manager.buildSessionRecord({
    id,
    providerId: "claude",
    providerLabel: "Claude Code",
    name: "Push protocol test",
    cwd: process.cwd(),
    status: "running",
    streamMode: true,
  });
  manager.sessions.set(session.id, session);
  session.streamEntries = [];
  session.clients = new Set();
  return session;
}

test("narrative-init: attachClient pushes a baseline init frame to the new client", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager);
    session.streamEntries = [
      {
        id: "a1", kind: "assistant", label: "Claude", text: "Hello!", timestamp: "2026-04-29T12:00:00Z", seq: 1,
      },
    ];

    const socket = makeMockSocket();
    manager.attachClient(session.id, socket);

    // sendSnapshot will fire snapshot-start + snapshot-end too. Filter to
    // the narrative-init frame.
    const initFrame = socket.sent.find((f) => f.type === NARRATIVE_FRAME_TYPES.INIT);
    assert.ok(initFrame, "expected a narrative-init frame on attach");
    assert.equal(initFrame.sessionId, session.id);
    assert.equal(initFrame.schemaVersion, NARRATIVE_SCHEMA_VERSION);
    assert.equal(initFrame.entries.length, 1);
    assert.equal(initFrame.entries[0].id, "a1");
  });
});

test("broadcastNarrativeDiff: emits one upsert per changed entry, with monotonic seq", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager);
    const socket = makeMockSocket();
    manager.attachClient(session.id, socket);

    // Drop the initial frames so we focus on subsequent diffs.
    socket.sent.length = 0;

    // Simulate the stream session producing a first entry…
    session.streamEntries = [
      { id: "a1", kind: "assistant", label: "Claude", text: "Hi", timestamp: "2026-04-29T12:00:01Z", seq: 1 },
    ];
    manager.broadcastNarrativeDiff(session);

    // …then a streamed text update on the same id…
    session.streamEntries = [
      { id: "a1", kind: "assistant", label: "Claude", text: "Hi there!", timestamp: "2026-04-29T12:00:02Z", seq: 1 },
    ];
    manager.broadcastNarrativeDiff(session);

    // …then a tool call on a new id.
    session.streamEntries = [
      { id: "a1", kind: "assistant", label: "Claude", text: "Hi there!", timestamp: "2026-04-29T12:00:02Z", seq: 1 },
      { id: "t1", kind: "tool", label: "Read", text: "/tmp/x", timestamp: "2026-04-29T12:00:03Z", seq: 2, status: "running" },
    ];
    manager.broadcastNarrativeDiff(session);

    const events = socket.sent.filter((f) => f.type === NARRATIVE_FRAME_TYPES.EVENT);
    assert.equal(events.length, 3, "three diff events: initial upsert, mutation, new entry");
    assert.deepEqual(events.map((f) => f.op), ["upsert", "upsert", "upsert"]);
    assert.deepEqual(events.map((f) => f.entry.id), ["a1", "a1", "t1"]);
    // seq is monotonic.
    const seqs = events.map((f) => f.seq);
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `seq should be monotonic: ${seqs.join(",")}`);
    }
  });
});

test("broadcastNarrativeDiff: emits a remove frame when an entry leaves the rolling buffer", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager);
    const socket = makeMockSocket();
    manager.attachClient(session.id, socket);
    socket.sent.length = 0;

    session.streamEntries = [
      { id: "x1", kind: "assistant", text: "first", seq: 1 },
      { id: "x2", kind: "assistant", text: "second", seq: 2 },
    ];
    manager.broadcastNarrativeDiff(session);

    session.streamEntries = [
      { id: "x2", kind: "assistant", text: "second", seq: 2 }, // x1 dropped
    ];
    manager.broadcastNarrativeDiff(session);

    const events = socket.sent.filter((f) => f.type === NARRATIVE_FRAME_TYPES.EVENT);
    const removes = events.filter((f) => f.op === "remove");
    assert.equal(removes.length, 1);
    assert.equal(removes[0].entryId, "x1");
  });
});

test("end-to-end: server frames + client reducer converge on the same state", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager);
    const socket = makeMockSocket();
    manager.attachClient(session.id, socket);

    // Build the reducer state from every frame that crossed the wire,
    // exactly the way the browser does in applyNarrativeFrameToState.
    let reducer = createInitialNarrativeState();
    for (const frame of socket.sent.filter((f) => f.type?.startsWith("narrative-"))) {
      reducer = applyNarrativeFrame(reducer, frame);
    }

    // Drive the session: assistant streams a reply, then a tool call lands
    // its result, then a plan card is proposed.
    const updates = [
      [
        { id: "a1", kind: "assistant", text: "", seq: 1 },
      ],
      [
        { id: "a1", kind: "assistant", text: "Reading the file…", seq: 1 },
      ],
      [
        { id: "a1", kind: "assistant", text: "Reading the file…", seq: 1 },
        { id: "t1", kind: "tool", label: "Read", text: "/tmp/x", status: "running", seq: 2 },
      ],
      [
        { id: "a1", kind: "assistant", text: "Reading the file…", seq: 1 },
        { id: "t1", kind: "tool", label: "Read", text: "/tmp/x", status: "done", outputPreview: "file contents", seq: 2 },
      ],
      [
        { id: "a1", kind: "assistant", text: "Reading the file…", seq: 1 },
        { id: "t1", kind: "tool", label: "Read", text: "/tmp/x", status: "done", outputPreview: "file contents", seq: 2 },
        { id: "p1", kind: "plan", label: "Plan", text: "1. Edit\n2. Test", seq: 3, status: "pending" },
      ],
    ];

    for (const next of updates) {
      session.streamEntries = next;
      manager.broadcastNarrativeDiff(session);
    }

    // Apply every frame the server emitted into the client reducer.
    for (const frame of socket.sent.filter((f) => f.type?.startsWith("narrative-"))) {
      reducer = applyNarrativeFrame(reducer, frame);
    }

    const reducerEntries = selectNarrativeEntries(reducer);
    const serverEntries = manager.getStreamNarrativeSnapshot(session);
    // Both sides agree on the entry list (id + kind + text).
    assert.deepEqual(
      reducerEntries.map((e) => ({ id: e.id, kind: e.kind, text: e.text })),
      serverEntries.map((e) => ({ id: e.id, kind: e.kind, text: e.text })),
    );
    // The plan card survived intact through three intermediate diffs.
    const planEntry = reducerEntries.find((e) => e.kind === "plan");
    assert.ok(planEntry);
    assert.equal(planEntry.text, "1. Edit\n2. Test");
    // Tool entry's status mutation propagated.
    const toolEntry = reducerEntries.find((e) => e.kind === "tool");
    assert.equal(toolEntry.status, "done");
    assert.equal(toolEntry.outputPreview, "file contents");
  });
});
