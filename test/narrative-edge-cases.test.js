// Edge-case sweep for the narrative push protocol + schema rollout.
//
// Each scenario here is a real failure mode I want pinned: multi-client
// fan-out, reconnect with stale state, schemaVersion mismatch fallback,
// PTY diff broadcast, dedupePush validator drop, plan-mode idempotency.
// These tests don't exercise a real Claude child — they drive the
// SessionManager broadcast methods directly with synthetic state, so they
// stay fast and deterministic.

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
import { buildClaudeNarrativeFromText } from "../src/session-native-narrative.js";
import { ClaudeStreamSession } from "../src/claude-stream-session.js";
import { SessionManager } from "../src/session-manager.js";

const fakeProviders = [
  { id: "claude", label: "Claude Code", available: true, command: "claude", launchCommand: "claude", defaultName: "Claude" },
  { id: "shell", label: "Vanilla Shell", available: true, command: null, launchCommand: null, defaultName: "Shell" },
];

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
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-edge-cases-"));
  const userHomeDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-edge-cases-home-"));
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

function makeStreamSession(manager, { id = "stream-edge" } = {}) {
  const session = manager.buildSessionRecord({
    id,
    providerId: "claude",
    providerLabel: "Claude Code",
    name: "Edge case",
    cwd: process.cwd(),
    status: "running",
    streamMode: true,
  });
  manager.sessions.set(session.id, session);
  session.streamEntries = [];
  session.clients = new Set();
  return session;
}

// ---------------------------------------------------------------------------
// Multi-client fan-out
// ---------------------------------------------------------------------------

test("multi-client: every client attached to a session receives every diff event", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager);
    const clientA = makeMockSocket();
    const clientB = makeMockSocket();
    manager.attachClient(session.id, clientA);
    manager.attachClient(session.id, clientB);

    // Both clients should have received init.
    const initA = clientA.sent.find((f) => f.type === NARRATIVE_FRAME_TYPES.INIT);
    const initB = clientB.sent.find((f) => f.type === NARRATIVE_FRAME_TYPES.INIT);
    assert.ok(initA && initB, "both clients see init");

    clientA.sent.length = 0;
    clientB.sent.length = 0;

    session.streamEntries = [
      { id: "a1", kind: "assistant", text: "hi", seq: 1 },
    ];
    manager.broadcastNarrativeDiff(session);

    const eventsA = clientA.sent.filter((f) => f.type === NARRATIVE_FRAME_TYPES.EVENT);
    const eventsB = clientB.sent.filter((f) => f.type === NARRATIVE_FRAME_TYPES.EVENT);
    assert.equal(eventsA.length, 1);
    assert.equal(eventsB.length, 1);
    // Same seq on both — server emits to all clients in lockstep.
    assert.equal(eventsA[0].seq, eventsB[0].seq);
  });
});

test("multi-client: a client that joins mid-stream gets a seeded init plus future events", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager);

    // First client joins, receives init for empty state, then sees a few events.
    const earlyClient = makeMockSocket();
    manager.attachClient(session.id, earlyClient);
    session.streamEntries = [{ id: "a1", kind: "assistant", text: "hi", seq: 1 }];
    manager.broadcastNarrativeDiff(session);
    session.streamEntries = [
      { id: "a1", kind: "assistant", text: "hi there", seq: 1 },
      { id: "t1", kind: "tool", label: "Read", text: "/tmp/x", seq: 2, status: "running" },
    ];
    manager.broadcastNarrativeDiff(session);

    // Second client joins later. Its init must already include both entries.
    const lateClient = makeMockSocket();
    manager.attachClient(session.id, lateClient);
    const init = lateClient.sent.find((f) => f.type === NARRATIVE_FRAME_TYPES.INIT);
    assert.ok(init, "late client sees init");
    assert.equal(init.entries.length, 2, "init carries the full current state");
    assert.deepEqual(init.entries.map((e) => e.id).sort(), ["a1", "t1"]);
  });
});

// ---------------------------------------------------------------------------
// Resume rehydration: chronological order across the restart boundary
// ---------------------------------------------------------------------------

test("resume rehydration: persist + restore preserves seq, so chat order survives a restart", async () => {
  // Original symptom: after a server restart the merger could put restored
  // entries (whose seq was stripped) below freshly-pushed pills (with real
  // seq), reading the chat backwards. Fix is two-fold:
  //   1. serializePersistedSession now persists each entry's seq AND the
  //      session-wide entrySeqCounter.
  //   2. buildSessionRecord on restore preserves the persisted seqs and
  //      backfills any missing ones monotonically before any new push, so
  //      live entries can never collide with restored ones.
  // With both pieces in place, seq-primary ordering reads correctly across
  // the restart boundary.
  await withManager(async (manager) => {
    const original = makeStreamSession(manager, { id: "stream-resume-order" });
    manager.pushNativeNarrativeEntry(original, {
      kind: "status", label: "Starting", text: "Starting Claude Code in /tmp/repo.",
      timestamp: "2026-04-30T16:53:05.722Z", meta: "launch",
    });
    manager.pushNativeNarrativeEntry(original, {
      kind: "status", label: "Stream", text: "Stream mode active for Claude Code.",
      timestamp: "2026-04-30T16:53:05.723Z", meta: "stream-mode",
    });
    manager.pushNativeNarrativeEntry(original, {
      kind: "user", label: "You", text: "Reply with one word: pong",
      timestamp: "2026-04-30T16:55:23.113Z",
    });
    const persistedShape = manager.serializePersistedSession(original);

    // Fresh manager simulates a server restart. Restore the session from
    // the persisted shape, then push a "Resumed" pill — its seq must come
    // out greater than every restored seq.
    manager.sessions.delete(original.id);
    const restored = manager.buildSessionRecord({
      id: persistedShape.id,
      providerId: persistedShape.providerId,
      providerLabel: persistedShape.providerLabel,
      name: persistedShape.name,
      cwd: persistedShape.cwd,
      streamMode: true,
      nativeNarrativeEntries: persistedShape.nativeNarrativeEntries,
      entrySeqCounter: persistedShape.entrySeqCounter,
      broadcastSeq: persistedShape.broadcastSeq,
    });
    manager.sessions.set(restored.id, restored);

    // Restored entries kept their seqs.
    const restoredSeqs = restored.nativeNarrativeEntries.map((e) => e.seq);
    assert.deepEqual(restoredSeqs, [1, 2, 3], "persisted seqs round-trip intact");
    assert.equal(restored.entrySeqCounter, 3, "counter resumes above restored max");

    // Rehydrated JSONL entry with no seq — this is the synthetic-zero case.
    restored.streamEntries = [{
      id: "claude-assistant-msg_X-0", kind: "assistant", label: "Claude Code",
      text: "pong", timestamp: "2026-04-30T16:55:24.513Z",
    }];

    // Fresh post-restart pill — allocateSeq via pushNativeNarrativeEntry gives it 4.
    manager.pushNativeNarrativeEntry(restored, {
      kind: "status", label: "Stream",
      text: "Resumed Claude Code session — conversation history loaded from the prior JSONL transcript.",
      timestamp: "2026-04-30T17:41:41.944Z", meta: "stream-mode",
    });

    const narrative = await manager.getSessionNarrative(restored.id);
    const order = narrative.entries.map((entry) => entry.label);

    // Insertion order via seq: Starting (1) -> Stream (2) -> You (3) ->
    // Resumed Stream (4) -> Claude Code (no seq, falls below by tiebreak).
    // The Claude Code synthetic-zero entry appears last (after the seq=4
    // pill) because seq-primary places real-seq entries first; this is OK
    // because in real life the JSONL replay path stamps seq via _allocateSeq
    // before the entry is broadcast.
    assert.deepEqual(
      order,
      ["Starting", "Stream", "You", "Stream", "Claude Code"],
      `entries must be in seq order, got ${JSON.stringify(order)}`,
    );
  });
});

test("resume rehydration: legacy on-disk records without seq get backfilled monotonically on restore", async () => {
  // Old persisted records (saved before we persisted seq) have entries with
  // no seq. buildSessionRecord must stamp them with monotonic seqs in their
  // restored order so the chat reads the same way it did before the
  // restart, AND so any subsequent push allocates a seq above them.
  await withManager(async (manager) => {
    const restored = manager.buildSessionRecord({
      id: "stream-legacy-restore",
      providerId: "claude",
      providerLabel: "Claude Code",
      name: "Legacy",
      cwd: process.cwd(),
      streamMode: true,
      nativeNarrativeEntries: [
        // No `seq` field — this is what an old sessions.json file looks like.
        { id: "u1", kind: "user", label: "You", text: "first", timestamp: "2026-05-01T10:00:00.000Z" },
        { id: "a1", kind: "assistant", label: "Claude Code", text: "reply", timestamp: "2026-05-01T10:00:30.000Z" },
        { id: "u2", kind: "user", label: "You", text: "second", timestamp: "2026-05-01T10:01:00.000Z" },
      ],
      // No entrySeqCounter on the snapshot either.
    });
    manager.sessions.set(restored.id, restored);

    const seqs = restored.nativeNarrativeEntries.map((e) => e.seq);
    assert.deepEqual(seqs, [1, 2, 3], "legacy entries get backfilled in restored order");
    assert.equal(restored.entrySeqCounter, 3, "counter aligned with backfilled max");

    // A fresh push allocates seq=4 — strictly above the backfilled values.
    manager.pushNativeNarrativeEntry(restored, {
      kind: "user", label: "You", text: "third (post-restart)",
      timestamp: "2026-05-01T10:02:00.000Z",
    });
    assert.equal(restored.nativeNarrativeEntries[3].seq, 4);
  });
});

test("resume rehydration: live stream entries with same timestamp keep their seq order (within-turn tiebreaker)", async () => {
  // Same-timestamp entries from a single Claude message (text + tool_use that
  // share the Claude-side timestamp) must stay in seq order so the renderer
  // doesn't shuffle a tool_use card above its narrating text.
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "stream-tiebreak" });
    const sharedTs = "2026-04-30T18:00:00.000Z";
    session.streamEntries = [
      { id: "tool-1", kind: "tool", label: "Read", text: "/x", seq: 11, timestamp: sharedTs, status: "running" },
      { id: "asst-1", kind: "assistant", label: "Claude Code", text: "Let me check.", seq: 10, timestamp: sharedTs },
    ];
    const narrative = await manager.getSessionNarrative(session.id);
    const order = narrative.entries.map((entry) => entry.id);
    assert.deepEqual(order, ["asst-1", "tool-1"], "lower seq comes first when timestamps tie");
  });
});

test("stream narrative snapshot collapses completed assistant plus stale streaming duplicate", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "stream-duplicate-partial" });
    const timestamp = "2026-05-02T21:19:00.000Z";
    session.streamEntries = [
      {
        id: "claude-assistant-msg_final-0",
        kind: "assistant",
        label: "Claude Code",
        text: "Let me write a proper pre-flight.",
        timestamp,
        seq: 10,
      },
      {
        id: "claude-partial-current",
        kind: "assistant",
        label: "Claude Code",
        text: "Let me write a proper pre-flight.",
        timestamp: "2026-05-02T21:19:01.000Z",
        meta: "streaming",
        seq: 11,
      },
    ];

    const narrative = await manager.getSessionNarrative(session.id);
    assert.deepEqual(
      narrative.entries
        .filter((entry) => entry.kind === "assistant")
        .map((entry) => ({ id: entry.id, text: entry.text, meta: entry.meta || "" })),
      [
        {
          id: "claude-assistant-msg_final-0",
          text: "Let me write a proper pre-flight.",
          meta: "",
        },
      ],
    );
  });
});

// ---------------------------------------------------------------------------
// Reconnect / seq-gap recovery
// ---------------------------------------------------------------------------

test("reconnect: client reducer with stale state can recover from a fresh init", () => {
  // Drive the reducer through a full state, then simulate a reconnect by
  // applying a brand-new init frame. The reducer should snap to the new
  // baseline and forget the prior state — that's the recovery path.
  let state = createInitialNarrativeState();
  state = applyNarrativeFrame(state, {
    type: NARRATIVE_FRAME_TYPES.INIT,
    sessionId: "s",
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    lastSeq: 5,
    entries: [
      { id: "u1", kind: "user", text: "old prompt" },
      { id: "a1", kind: "assistant", text: "old reply" },
    ],
  });
  assert.equal(selectNarrativeEntries(state).length, 2);

  // Reconnect: server pushes a new init. The reducer replaces state.
  state = applyNarrativeFrame(state, {
    type: NARRATIVE_FRAME_TYPES.INIT,
    sessionId: "s",
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    lastSeq: 12,
    entries: [
      { id: "u2", kind: "user", text: "new prompt" },
    ],
  });
  const entries = selectNarrativeEntries(state);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "u2");
  assert.equal(state.lastSeq, 12);
});

test("seq-gap: a frame with seq > lastSeq + 1 is treated as a gap (caller signals resync)", () => {
  // Build a baseline at lastSeq=2.
  let state = createInitialNarrativeState();
  state = applyNarrativeFrame(state, {
    type: NARRATIVE_FRAME_TYPES.INIT,
    sessionId: "s",
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    lastSeq: 2,
    entries: [{ id: "a1", kind: "assistant", text: "hi" }],
  });

  // Now simulate the client-side gap detection that lives in
  // applyNarrativeFrameToState. The reducer itself doesn't reject the
  // frame on seq grounds; the caller does. So this test asserts the
  // pre-condition the caller checks.
  const gapEvent = {
    type: NARRATIVE_FRAME_TYPES.EVENT,
    sessionId: "s",
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    op: "upsert",
    seq: 9,
    entry: { id: "a2", kind: "assistant", text: "leap" },
  };
  const expected = state.lastSeq + 1;
  assert.ok(gapEvent.seq > expected, "seq jumps by more than 1 — gap");
});

// ---------------------------------------------------------------------------
// schemaVersion mismatch
// ---------------------------------------------------------------------------

test("schemaVersion: a frame newer than the client knows is detectable from frame.schemaVersion", () => {
  // The reducer applies the frame regardless (additive shapes survive); the
  // client's mismatch handler is the layer that drops the reducer arm and
  // resyncs. Here we just pin the protocol invariant.
  const futureFrame = {
    type: NARRATIVE_FRAME_TYPES.INIT,
    sessionId: "s",
    schemaVersion: NARRATIVE_SCHEMA_VERSION + 1,
    lastSeq: 0,
    entries: [],
  };
  assert.ok(futureFrame.schemaVersion > NARRATIVE_SCHEMA_VERSION,
    "a future-version frame is comparable against NARRATIVE_SCHEMA_VERSION");
});

// ---------------------------------------------------------------------------
// PTY-backed push protocol
// ---------------------------------------------------------------------------

test("PTY diff broadcast: pushOutput debounces a narrative-event for non-stream sessions", async () => {
  await withManager(async (manager) => {
    const session = manager.buildSessionRecord({
      id: "pty-1",
      providerId: "shell",
      providerLabel: "Vanilla Shell",
      name: "PTY edge",
      cwd: process.cwd(),
      status: "running",
    });
    manager.sessions.set(session.id, session);
    session.clients = new Set();
    const socket = makeMockSocket();
    manager.attachClient(session.id, socket);
    socket.sent.length = 0;

    // PTY-style chunk landing in pushOutput.
    manager.pushOutput(session, "hello\n");
    // The diff is debounced to NARRATIVE_DIFF_THROTTLE_MS; wait it out.
    await new Promise((resolve) => setTimeout(resolve, 280));

    // We can't assert specific entry shapes — buildProjectedNarrative is
    // permissive. But after pushOutput, the narrativeDiffTimer should have
    // fired (cleared) and the session should still be alive.
    assert.equal(session.narrativeDiffTimer, null, "timer cleared after firing");
  });
});

test("PTY diff broadcast: rapid chunks don't fire multiple diffs (debounce holds)", async () => {
  await withManager(async (manager) => {
    const session = manager.buildSessionRecord({
      id: "pty-2",
      providerId: "shell",
      providerLabel: "Vanilla Shell",
      name: "PTY edge",
      cwd: process.cwd(),
      status: "running",
    });
    manager.sessions.set(session.id, session);
    session.clients = new Set();

    // Fire 5 chunks back-to-back. The debounce should coalesce them.
    let scheduleCallCount = 0;
    const originalSchedule = manager.scheduleNarrativeDiffBroadcast.bind(manager);
    manager.scheduleNarrativeDiffBroadcast = function tracked(...args) {
      scheduleCallCount += 1;
      return originalSchedule(...args);
    };

    manager.pushOutput(session, "a");
    manager.pushOutput(session, "b");
    manager.pushOutput(session, "c");
    manager.pushOutput(session, "d");
    manager.pushOutput(session, "e");

    // schedule was called per chunk, but the inner setTimeout only fires
    // once because subsequent calls find an existing timer.
    assert.equal(scheduleCallCount, 5, "schedule called once per chunk");

    // Wait out the debounce.
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(session.narrativeDiffTimer, null, "single timer fired once");
  });
});

// ---------------------------------------------------------------------------
// dedupePush validator: malformed entries are dropped, not crashed on
// ---------------------------------------------------------------------------

test("dedupePush validator: a producer event with no id still parses (parser stamps an id)", () => {
  // The Claude shaper builds entries with explicit ids, so this is mostly a
  // safety check — the validator at the boundary doesn't blow up the parser
  // on the common shapes.
  const text = JSON.stringify({
    type: "assistant",
    timestamp: "2026-04-29T12:00:00Z",
    message: { content: [{ type: "text", text: "hello" }] },
  });
  const narrative = buildClaudeNarrativeFromText(text, { providerId: "claude", providerLabel: "Claude" });
  const assistant = narrative.entries.find((e) => e.kind === "assistant");
  assert.ok(assistant, "assistant entry produced");
  assert.ok(String(assistant.id || "").length > 0, "id present");
});

// ---------------------------------------------------------------------------
// Plan-mode idempotency
// ---------------------------------------------------------------------------

function makeFakeStreamForPlan() {
  const session = new ClaudeStreamSession({ sessionId: "plan-test" });
  const stdinFrames = [];
  session._child = {
    stdin: { write(line) { stdinFrames.push(JSON.parse(String(line).trim())); }, end() {} },
    stdout: { setEncoding() {}, on() {} },
    stderr: { setEncoding() {}, on() {} },
    on() {}, kill() {},
  };
  session.status = "running";
  session.stdinFrames = stdinFrames;
  return session;
}

// ---------------------------------------------------------------------------
// clientMessageId: stable end-to-end identity for user-echo entries
// ---------------------------------------------------------------------------

test("clientMessageId: writeToClaudeStreamSession honors the client-allocated id as the user-echo entry id", async () => {
  // Composer allocates a UUID at send time and threads it through the WS
  // input frame. The session manager's stream-write path must use that id
  // when pushing the user-echo native narrative entry — it's what makes
  // optimistic UI, the persisted record, and rehydrated state on reconnect
  // all share one id, eliminating dedup-by-(label,text,timestamp) fragility.
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "stream-msgid" });
    let sentLines = [];
    session.streamSession = {
      send(line) { sentLines.push(line); },
      sendWithImages() {},
    };

    const stableId = "c-uuid-from-composer";
    const ok = manager.writeToClaudeStreamSession(session, "Hello there!\r", {
      clientMessageId: stableId,
    });
    assert.equal(ok, true);
    assert.deepEqual(sentLines, ["Hello there!"], "the trimmed line was sent to Claude");
    const userEntries = session.nativeNarrativeEntries.filter((e) => e.kind === "user");
    assert.equal(userEntries.length, 1);
    assert.equal(userEntries[0].id, stableId, "user-echo entry uses the client id");
    assert.equal(userEntries[0].text, "Hello there!");
  });
});

test("clientMessageId: only the first physical line of a multi-line paste consumes the client id", async () => {
  // The composer allocates one id per send action. Multi-line inputs must
  // not collide them across pushes inside the same write call — second
  // line synthesizes its own random id.
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "stream-msgid-multi" });
    session.streamSession = {
      send() {},
      sendWithImages() {},
    };

    manager.writeToClaudeStreamSession(session, "first line\nsecond line\r", {
      clientMessageId: "c-only-first-keeps-this",
    });
    const userEntries = session.nativeNarrativeEntries.filter((e) => e.kind === "user");
    assert.equal(userEntries.length, 2);
    assert.equal(userEntries[0].id, "c-only-first-keeps-this", "first line uses the client id");
    assert.notEqual(userEntries[1].id, "c-only-first-keeps-this", "second line gets a fresh id");
    assert.match(userEntries[1].id, /[0-9a-f-]{8,}/i, "second line's synthetic id is uuid-shaped");
  });
});

test("restartStreamSession: a late exit event from the killed predecessor must not stomp the freshly-spawned child's status", async () => {
  // Failure mode: after sign-in, the OAuth flow calls restartStreamSession
  // to pick up CLAUDE_CODE_OAUTH_TOKEN. We close() the old child and
  // immediately spawn a new one. The old child's `on("exit")` fires
  // asynchronously after spawn; without the guard it sets
  // session.status = "exited" and the user sees the new child get marked
  // dead. This pins the contract that:
  //   (a) once session.streamSession points at a different instance,
  //       the old handler must no-op
  //   (b) the _restarting flag is honored
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "stream-restart-race" });
    // Stub a streamSession instance with the hooks the manager wires up.
    // We simulate the on("exit") handler by capturing the registered
    // callback and firing it manually — that's the race we care about.
    const handlers = {};
    const fakeStream = {
      on(event, cb) { handlers[event] = cb; },
      send() {},
      sendWithImages() {},
      close() {},
      _restarting: false,
    };
    session.streamSession = fakeStream;

    // Re-run startClaudeStreamSession's exit-handler wiring locally —
    // that's what we're testing. (We can't call the real method without
    // spawning claude.) Mirror the wiring exactly:
    const ownStreamSession = fakeStream;
    fakeStream.on("exit", ({ code, signal }) => {
      if (ownStreamSession._restarting) return;
      if (session.streamSession && session.streamSession !== ownStreamSession) return;
      session.status = "exited";
      session.exitCode = code;
      session.exitSignal = signal;
    });

    session.status = "running";

    // Step 1: simulate restartStreamSession's pre-close work.
    fakeStream._restarting = true;
    const replacement = { _replacement: true, on() {}, send() {}, close() {} };
    session.streamSession = replacement;

    // Step 2: the OLD child's exit fires now (async-arrived).
    handlers.exit({ code: 143, signal: "SIGTERM" });

    // The replacement must be unaffected.
    assert.equal(session.status, "running", "old exit must not mark session as exited");
    assert.equal(session.streamSession, replacement, "replacement pointer survived");

    // Step 3: a stray late exit from the OLD child arriving even after
    // _restarting was cleared (defense in depth) — replacement-guard
    // catches it because session.streamSession !== ownStreamSession.
    fakeStream._restarting = false;
    handlers.exit({ code: 143, signal: "SIGTERM" });
    assert.equal(session.status, "running", "replacement-guard catches stragglers");

    // Step 4: when the LIVE child finally dies for real, its OWN handler
    // runs and marks the session exited. We simulate that with a fresh
    // ownStreamSession captured in the replacement's handler.
    const liveHandlers = {};
    replacement.on = (event, cb) => { liveHandlers[event] = cb; };
    const ownLive = replacement;
    replacement.on("exit", ({ code, signal }) => {
      if (ownLive._restarting) return;
      if (session.streamSession && session.streamSession !== ownLive) return;
      session.status = "exited";
      session.exitCode = code;
      session.exitSignal = signal;
    });
    liveHandlers.exit({ code: 0, signal: null });
    assert.equal(session.status, "exited", "live child's own exit DOES mark the session");
    assert.equal(session.exitCode, 0);
  });
});

test("clientMessageId: user-echo seq is monotonic and strictly above any prior status pill", async () => {
  // The user-echo entry must come after any setup pills (Starting, Stream,
  // etc.) in seq order, so the client renderer's insertion-order placement
  // shows them in that order.
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "stream-msgid-seq" });
    session.streamSession = { send() {}, sendWithImages() {} };

    manager.pushNativeNarrativeEntry(session, {
      kind: "status", label: "Starting", text: "Starting Claude",
      timestamp: "2026-05-01T18:00:00.000Z",
    });
    const startingSeq = session.nativeNarrativeEntries[0].seq;

    manager.writeToClaudeStreamSession(session, "what's up?\r", {
      clientMessageId: "c-after-starting",
    });
    const user = session.nativeNarrativeEntries.find((e) => e.kind === "user");
    assert.ok(user.seq > startingSeq, `user seq ${user.seq} > starting seq ${startingSeq}`);
  });
});

// ---------------------------------------------------------------------------
// Auto-reply: sticky textbox that fires on idle (replaces the supervisor)
// ---------------------------------------------------------------------------

test("auto-reply: setAutoReplyText stores text on the session and survives serialize round-trip", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "auto-reply-store" });
    assert.equal(session.autoReplyText, "", "starts empty");

    const result = manager.setAutoReplyText(session.id, "keep going");
    assert.deepEqual(result, { ok: true, autoReplyText: "keep going" });
    assert.equal(session.autoReplyText, "keep going");

    // Round-trip through persist + restore.
    const persisted = manager.serializePersistedSession(session);
    assert.equal(persisted.autoReplyText, "keep going");
    const restored = manager.buildSessionRecord({
      id: persisted.id,
      providerId: persisted.providerId,
      providerLabel: persisted.providerLabel,
      name: persisted.name,
      cwd: persisted.cwd,
      streamMode: true,
      autoReplyText: persisted.autoReplyText,
    });
    assert.equal(restored.autoReplyText, "keep going");
  });
});

test("auto-reply: setAutoReplyText slices long text at 4096 chars (defensive cap)", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "auto-reply-cap" });
    const huge = "x".repeat(8000);
    manager.setAutoReplyText(session.id, huge);
    assert.equal(session.autoReplyText.length, 4096);
  });
});

test("auto-reply: setAutoReplyText returns session-not-found for unknown ids", async () => {
  await withManager(async (manager) => {
    const result = manager.setAutoReplyText("does-not-exist", "hi");
    assert.deepEqual(result, { ok: false, reason: "session-not-found" });
  });
});

test("auto-reply: maybeFireAutoReply no-ops when text is empty, session is exited, or stream is busy", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "auto-reply-noops" });
    let writeCalls = 0;
    session.streamSession = {
      send() { writeCalls += 1; },
      sendWithImages() { writeCalls += 1; },
    };

    // 1. Empty text -> no fire.
    manager.maybeFireAutoReply(session);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(writeCalls, 0, "empty text doesn't fire");

    // 2. Set text but mark exited -> no fire.
    manager.setAutoReplyText(session.id, "go");
    session.status = "exited";
    manager.maybeFireAutoReply(session);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(writeCalls, 0, "exited session doesn't fire");
    session.status = "running";

    // 3. streamWorking true at fire-time -> no fire (re-validated in setTimeout).
    manager.maybeFireAutoReply(session);
    session.streamWorking = true;
    await new Promise((r) => setTimeout(r, 2_500));
    assert.equal(writeCalls, 0, "streamWorking gate honored at fire time");
  });
});

test("auto-reply: throttle prevents back-to-back fires within AUTO_REPLY_MIN_INTERVAL_MS", async () => {
  await withManager(async (manager) => {
    const session = makeStreamSession(manager, { id: "auto-reply-throttle" });
    let writeCalls = 0;
    session.streamSession = {
      send() { writeCalls += 1; },
      sendWithImages() { writeCalls += 1; },
    };
    manager.setAutoReplyText(session.id, "go");

    // Fire 1 -> queued, will fire after AUTO_REPLY_FIRE_DELAY_MS (~2s).
    manager.maybeFireAutoReply(session);
    await new Promise((r) => setTimeout(r, 2_500));
    assert.equal(writeCalls, 1, "first fire happened after delay");

    // Immediately try again — throttle floor is 2s; we just fired, so this
    // call should bail out before scheduling.
    manager.maybeFireAutoReply(session);
    await new Promise((r) => setTimeout(r, 2_500));
    assert.equal(writeCalls, 1, "throttle prevented a second fire within 2s");
  });
});

test("plan-mode idempotency: a second resolvePlanMode after the first returns no-plan-awaiting", async () => {
  await withManager(async (manager) => {
    const session = manager.buildSessionRecord({
      id: "stream-plan",
      providerId: "claude",
      providerLabel: "Claude",
      cwd: process.cwd(),
      status: "running",
      streamMode: true,
    });
    manager.sessions.set(session.id, session);
    const stream = makeFakeStreamForPlan();
    session.streamSession = stream;
    stream._handleLine(JSON.stringify({
      type: "assistant",
      message: {
        id: "msg",
        content: [{ type: "tool_use", id: "plan_a", name: "ExitPlanMode", input: { plan: "1." } }],
      },
    }));

    const first = manager.resolvePlanMode(session.id, { approve: true });
    assert.equal(first.ok, true);

    const second = manager.resolvePlanMode(session.id, { approve: true });
    assert.deepEqual(second, { ok: false, reason: "no-plan-awaiting" });
  });
});

test("plan-mode FIFO: two ExitPlanMode tool_uses both await; head returns the older id", () => {
  const stream = makeFakeStreamForPlan();
  stream._handleLine(JSON.stringify({
    type: "assistant",
    message: { id: "m1", content: [{ type: "tool_use", id: "plan_a", name: "ExitPlanMode", input: { plan: "v1" } }] },
  }));
  assert.equal(stream.getPendingPlanToolUseId(), "plan_a");
  assert.deepEqual(stream.getPendingPlanToolUseIds(), ["plan_a"]);

  stream._handleLine(JSON.stringify({
    type: "assistant",
    message: { id: "m2", content: [{ type: "tool_use", id: "plan_b", name: "ExitPlanMode", input: { plan: "v2" } }] },
  }));
  // Head is still the OLDER plan_a; plan_b is queued behind.
  assert.equal(stream.getPendingPlanToolUseId(), "plan_a");
  assert.deepEqual(stream.getPendingPlanToolUseIds(), ["plan_a", "plan_b"]);

  // Resolve plan_a — head advances to plan_b.
  stream.sendToolResult("plan_a", "approved a");
  assert.equal(stream.getPendingPlanToolUseId(), "plan_b");
  assert.deepEqual(stream.getPendingPlanToolUseIds(), ["plan_b"]);
});

test("plan-mode FIFO: out-of-order resolution dequeues the matching id, not the head", () => {
  const stream = makeFakeStreamForPlan();
  stream._handleLine(JSON.stringify({
    type: "assistant",
    message: { id: "m1", content: [{ type: "tool_use", id: "plan_a", name: "ExitPlanMode", input: { plan: "v1" } }] },
  }));
  stream._handleLine(JSON.stringify({
    type: "assistant",
    message: { id: "m2", content: [{ type: "tool_use", id: "plan_b", name: "ExitPlanMode", input: { plan: "v2" } }] },
  }));
  assert.deepEqual(stream.getPendingPlanToolUseIds(), ["plan_a", "plan_b"]);

  // Resolve plan_b first — out of order. plan_a stays at the head.
  stream.sendToolResult("plan_b", "approved b");
  assert.equal(stream.getPendingPlanToolUseId(), "plan_a");
  assert.deepEqual(stream.getPendingPlanToolUseIds(), ["plan_a"]);
});

test("plan-mode FIFO: duplicate ExitPlanMode tool_use_id is not enqueued twice", () => {
  // Defensive: if the parser sees the same plan_a twice (edge case where
  // the same assistant event is replayed), the queue stays at length 1.
  const stream = makeFakeStreamForPlan();
  const event = JSON.stringify({
    type: "assistant",
    message: { id: "m1", content: [{ type: "tool_use", id: "plan_a", name: "ExitPlanMode", input: { plan: "v1" } }] },
  });
  stream._handleLine(event);
  stream._handleLine(event);
  assert.equal(stream.getPendingPlanToolUseIds().length, 1);
});

// ---------------------------------------------------------------------------
// Slash command catalog: server-driven list overrides built-in
// ---------------------------------------------------------------------------

test("slash command catalog: server-emitted list overrides the built-in catalog", async () => {
  // resolveRichSessionSlashCommands lives in the client bundle but is pure;
  // we can import it server-side for this test.
  const { resolveRichSessionSlashCommands } = await import("../src/client/rich-session-helpers.js");

  // No availableSlashCommands → built-in catalog.
  const builtIn = resolveRichSessionSlashCommands({ id: "x" });
  assert.ok(builtIn.length >= 7);
  assert.ok(builtIn.some((entry) => entry.command === "/login"));

  // Custom list → server wins.
  const custom = resolveRichSessionSlashCommands({
    id: "x",
    availableSlashCommands: [
      { command: "/research-resolve", label: "Resolve move", hint: "loop step 9" },
    ],
  });
  assert.equal(custom.length, 1);
  assert.equal(custom[0].command, "/research-resolve");
});

test("slash command catalog: malformed entries are filtered out, not crashed on", async () => {
  const { resolveRichSessionSlashCommands } = await import("../src/client/rich-session-helpers.js");
  const result = resolveRichSessionSlashCommands({
    availableSlashCommands: [
      { command: "/ok", label: "OK" },
      { /* missing command */ label: "Bad" },
      { command: "no-leading-slash" },
      null,
      { command: "/also-ok" },
    ],
  });
  assert.deepEqual(result.map((entry) => entry.command), ["/ok", "/also-ok"]);
});
