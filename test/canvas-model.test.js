import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanvasCards,
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
    canvases: [{ id: "c1", title: "Result chart", imagePath: "results/chart.png" }],
    generatedAt: "2026-05-12T12:00:00.000Z",
  });

  assert.equal(snapshot.node.id, "mac-main");
  assert.equal(snapshot.node.name, "Mac Studio");
  assert.equal(snapshot.counts.sessions, 1);
  assert.equal(snapshot.counts.browserSessions, 1);
  assert.equal(snapshot.counts.approvals, 1);
  assert.equal(snapshot.counts.ports, 1);
  assert.equal(snapshot.counts.artifacts, 1);
});

test("buildCanvasCards renders machine, session, browser, approval, app, and artifact cards", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    sessions: [{ id: "agent-1", name: "Trainer", providerId: "codex", status: "running", cwd: "/models" }],
    browserSessions: [{ id: "browser-1", name: "Eval browser", status: "running", latestSnapshot: { url: "https://example.test" } }],
    actionItems: [{ id: "approval-1", title: "Ship build", detail: "Review production deploy", href: "?view=agent-inbox" }],
    ports: [{ port: 6006, name: "TensorBoard", preferredAccess: "proxy" }],
    canvases: [{ id: "artifact-1", title: "Loss curve", caption: "Best run so far" }],
  });

  assert.deepEqual(
    cards.map((card) => card.type),
    ["machine", "approval", "agent", "browser", "app", "artifact"],
  );
  assert.equal(cards.find((card) => card.type === "agent")?.ref.sessionId, "agent-1");
  assert.equal(cards.find((card) => card.type === "app")?.href, "/proxy/6006/");
  assert.equal(cards.find((card) => card.type === "artifact")?.detail, "Best run so far");
});

test("buildCanvasCards collapses noisy port lists into one local apps window", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    ports: Array.from({ length: 7 }, (_, index) => ({
      port: 5000 + index,
      name: `App ${index + 1}`,
      preferredAccess: index % 2 ? "direct" : "proxy",
    })),
  });

  const appCards = cards.filter((card) => card.type === "app");
  assert.equal(appCards.length, 1);
  assert.equal(appCards[0].id, "app:local-ports");
  assert.equal(appCards[0].title, "Local apps");
  assert.equal(appCards[0].subtitle, "7 running ports");
  assert.equal(appCards[0].ref.ports.length, 7);
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
