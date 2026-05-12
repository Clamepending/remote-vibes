import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanvasCards,
  createFallbackCanvasLayout,
  getCanvasBoardId,
  getCanvasLayoutStorageKey,
  getCanvasViewportStorageKey,
  mergeCanvasLayout,
  normalizeNodeSnapshot,
  sanitizeCanvasLayout,
} from "../src/client/canvas/canvas-model.js";

test("normalizeNodeSnapshot accepts the privileged node snapshot shape", () => {
  const snapshot = normalizeNodeSnapshot({
    schemaVersion: 1,
    node: {
      id: "mac-main",
      name: "Mac Studio",
      status: "online",
      os: "darwin",
      version: "1.0.19",
    },
    sessions: [{ id: "s1", name: "Worker A", status: "running", cwd: "/repo" }],
    browserSessions: [{ id: "b1", title: "Browser task", status: "running" }],
    actionItems: [{ id: "a1", title: "Approve deploy", priority: "high" }],
    ports: [{ port: 5173, name: "Vite", preferredUrl: "http://127.0.0.1:5173" }],
    handoffJobs: [{ id: "h1", title: "GPU to Pi", target: { label: "Pi" } }],
    brain: { noteCount: 1, notes: [{ relativePath: "index.md", title: "Brain index" }] },
    canvases: [{ id: "c1", title: "Result chart", imagePath: "results/chart.png" }],
    generatedAt: "2026-05-12T12:00:00.000Z",
  });

  assert.equal(snapshot.node.id, "mac-main");
  assert.equal(snapshot.node.name, "Mac Studio");
  assert.equal(snapshot.counts.sessions, 1);
  assert.equal(snapshot.counts.browserSessions, 1);
  assert.equal(snapshot.counts.approvals, 1);
  assert.equal(snapshot.counts.ports, 1);
  assert.equal(snapshot.counts.handoffJobs, 1);
  assert.equal(snapshot.counts.brainNotes, 1);
  assert.equal(snapshot.counts.artifacts, 1);
});

test("buildCanvasCards renders machine, brain, handoff, session, browser, approval, app, and artifact cards", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    brain: {
      noteCount: 2,
      edgeCount: 1,
      notes: [{ relativePath: "index.md", title: "Brain index", excerpt: "Durable research state" }],
    },
    handoffJobs: [{
      id: "gpu-pi",
      title: "GPU to Pi deploy",
      status: "planned",
      target: { label: "Pi", sshTarget: "pi@home" },
      objectivePreview: "Train on GPU, deploy on Pi.",
      steps: [{ id: "train", title: "Train", status: "pending" }],
    }],
    sessions: [{ id: "agent-1", name: "Trainer", providerId: "codex", status: "running", cwd: "/models" }],
    browserSessions: [{ id: "browser-1", name: "Eval browser", status: "running", latestSnapshot: { url: "https://example.test" } }],
    actionItems: [{ id: "approval-1", title: "Ship build", detail: "Review production deploy", href: "?view=agent-inbox" }],
    ports: [{ port: 6006, name: "TensorBoard", preferredAccess: "proxy" }],
    canvases: [{ id: "artifact-1", title: "Loss curve", caption: "Best run so far" }],
  });

  assert.deepEqual(
    cards.map((card) => card.type),
    ["machine", "brain", "approval", "handoff", "agent", "browser", "app", "artifact"],
  );
  assert.equal(cards.find((card) => card.type === "brain")?.ref.noteCount, 2);
  assert.equal(cards.find((card) => card.type === "handoff")?.ref.target.sshTarget, "pi@home");
  assert.equal(cards.find((card) => card.type === "agent")?.ref.sessionId, "agent-1");
  assert.equal(cards.find((card) => card.type === "app")?.href, "/proxy/6006/");
  assert.equal(cards.find((card) => card.type === "artifact")?.detail, "Best run so far");
});

test("buildCanvasCards promotes previewable app ports and folds the noisy remainder", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    ports: Array.from({ length: 7 }, (_, index) => ({
      port: 5000 + index,
      name: `App ${index + 1}`,
      preferredAccess: index % 2 ? "direct" : "proxy",
    })),
  });

  const appCards = cards.filter((card) => card.type === "app");
  assert.equal(appCards.length, 5);
  assert.equal(appCards.filter((card) => card.ref.embedUrl).length, 4);
  assert.equal(appCards.at(-1).id, "app:local-ports");
  assert.equal(appCards.at(-1).title, "More local apps");
  assert.equal(appCards.at(-1).subtitle, "3 more ports");
  assert.equal(appCards.at(-1).ref.ports.length, 7);
});

test("buildCanvasCards keeps active work visible and collapses quiet board noise", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    sessions: [
      { id: "active-agent", name: "Active trainer", providerId: "codex", status: "running" },
      { id: "quiet-agent", name: "Old idle worker", providerId: "claude", status: "idle" },
      { id: "done-agent", name: "Finished sweep", providerId: "codex", status: "completed" },
    ],
    browserSessions: [
      { id: "active-browser", name: "Active browser", status: "running", latestSnapshot: { url: "https://example.test" } },
      { id: "old-browser", name: "Old browser", status: "idle" },
    ],
    actionItems: [
      { id: "deploy-approval", title: "Approve deploy", status: "open" },
      { id: "setup-done", title: "Connect Telegram", status: "completed" },
    ],
    canvases: [
      { id: "new-chart", title: "Newest chart", createdAt: "2026-05-12T13:00:00.000Z" },
      { id: "old-chart", title: "Old chart", createdAt: "2026-05-12T12:00:00.000Z" },
    ],
  });

  assert.deepEqual(cards.filter((card) => card.type === "agent").map((card) => card.title), ["Active trainer"]);
  assert.deepEqual(cards.filter((card) => card.type === "browser").map((card) => card.title), ["Active browser"]);
  assert.deepEqual(cards.filter((card) => card.type === "approval").map((card) => card.title), ["Approve deploy"]);
  assert.deepEqual(cards.filter((card) => card.type === "artifact").map((card) => card.title), ["Newest chart"]);

  const summaries = cards.filter((card) => card.type === "summary");
  assert.equal(summaries.length, 4);
  assert.equal(summaries.find((card) => card.ref.summaryKind === "agent")?.subtitle, "2 hidden");
  assert.equal(summaries.find((card) => card.ref.summaryKind === "browser")?.subtitle, "1 hidden");
  assert.equal(summaries.find((card) => card.ref.summaryKind === "approval")?.title, "Resolved requests");
  assert.equal(summaries.find((card) => card.ref.summaryKind === "artifact")?.detail, "Old chart");
});

test("buildCanvasCards hides quiet redacted remote agent windows", () => {
  const cards = buildCanvasCards({
    mode: "redacted",
    node: { id: "remote-1", name: "Remote box", status: "online" },
    sessions: [
      { id: "idle-1", name: "redacted", providerId: "claude", status: "idle" },
      { id: "idle-2", name: "redacted", providerId: "codex", status: "completed" },
    ],
  });

  assert.equal(cards.filter((card) => card.type === "agent").length, 0);
  assert.equal(cards.find((card) => card.type === "summary")?.ref.summaryKind, "agent");
});

test("mergeCanvasLayout preserves saved positions and creates defaults for new cards", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "Mac" },
    sessions: [{ id: "s1", name: "One" }, { id: "s2", name: "Two" }],
  });
  const layout = mergeCanvasLayout(cards, {
    "session:s1": { x: 444, y: 222, width: 300, height: 190, z: 99 },
  });

  assert.equal(layout["session:s1"].x, 444);
  assert.equal(layout["session:s1"].y, 222);
  assert.equal(layout["session:s1"].z, 99);
  assert.ok(Number.isFinite(layout["session:s2"].x));
  assert.ok(Number.isFinite(layout["machine:node-1"].y));
});

test("createFallbackCanvasLayout separates machine and orchestration lanes", () => {
  const overlaps = (a, b) =>
    a.x < b.x + b.width
      && a.x + a.width > b.x
      && a.y < b.y + b.height
      && a.y + a.height > b.y;
  const cards = [
    ...buildCanvasCards({
      node: { id: "local", name: "Mac" },
      handoffJobs: [{ id: "handoff-1", title: "GPU to Pi", target: { label: "Pi" } }],
    }),
    ...buildCanvasCards({
      node: { id: "remote", name: "GPU box" },
      sessions: [{ id: "remote-agent", name: "Trainer", status: "running" }],
    }),
  ];
  const layout = createFallbackCanvasLayout(cards);

  assert.ok(layout["machine:local"].x < layout["handoff:handoff-1"].x);
  assert.ok(layout["machine:remote"].x < layout["handoff:handoff-1"].x);
  assert.ok(layout["session:remote-agent"].x > layout["handoff:handoff-1"].x);
  assert.equal(overlaps(layout["machine:remote"], layout["handoff:handoff-1"]), false);
});

test("sanitizeCanvasLayout clamps invalid layout values before persistence", () => {
  const layout = sanitizeCanvasLayout({
    card: { x: 999_999, y: -999_999, width: 1, height: 10_000, z: 999_999 },
  });

  assert.equal(layout.card.x, 20_000);
  assert.equal(layout.card.y, -2_000);
  assert.equal(layout.card.width, 180);
  assert.equal(layout.card.height, 540);
  assert.equal(layout.card.z, 100_000);
});

test("canvas board id and storage key are stable per node", () => {
  const boardId = getCanvasBoardId({ node: { id: "mac main", name: "Mac" } });
  assert.equal(boardId, "machine:mac-main");
  assert.equal(
    getCanvasLayoutStorageKey(boardId),
    "swarmlab.canvas.layout.v2:machine:mac-main",
  );
  assert.equal(
    getCanvasViewportStorageKey(boardId),
    "swarmlab.canvas.viewport.v1:machine:mac-main",
  );
});
