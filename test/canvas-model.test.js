import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanvasCards,
  buildCanvasLauncherCards,
  buildCanvasRegions,
  createFallbackCanvasLayout,
  getRenderableCanvasCardIds,
  getRenderableCanvasCards,
  getCanvasCardMachineId,
  getCanvasCardRegionId,
  getCanvasBoardId,
  getCanvasLayoutStorageKey,
  getCanvasViewportStorageKey,
  isCanvasRegionMetadataCard,
  isRenderableCanvasCard,
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
  assert.equal(cards.find((card) => card.type === "agent")?.ref.providerId, "codex");
  assert.equal(cards.find((card) => card.type === "agent")?.ref.cwd, "/models");
  assert.equal(cards.find((card) => card.type === "app")?.href, "/proxy/6006/");
  assert.equal(cards.find((card) => card.type === "artifact")?.detail, "Best run so far");

  const machine = cards.find((card) => card.type === "machine");
  const renderCards = getRenderableCanvasCards(cards);
  assert.equal(isCanvasRegionMetadataCard(machine), true);
  assert.equal(isRenderableCanvasCard(machine), false);
  assert.equal(renderCards.length, cards.length - 1);
  assert.equal(renderCards.some((card) => card.type === "machine"), false);
  assert.equal(getRenderableCanvasCardIds(cards).has(machine.id), false);
});

test("buildCanvasCards excludes launchers while buildCanvasLauncherCards returns dock actions", () => {
  const payload = {
    node: { id: "node-1", name: "Mac", status: "online" },
    launchers: [
      { id: "app:cursor", label: "Cursor", kind: "desktop-app", category: "editor", priority: 90, description: "Open Cursor from the canvas.", appId: "cursor", available: true, platform: "darwin" },
      { id: "provider:codex", label: "Codex", kind: "agent-provider", priority: 100, providerId: "codex", defaultName: "Codex", available: true },
      { id: "app:missing", label: "Missing", kind: "desktop-app", appId: "missing", available: false },
    ],
  };

  const cards = buildCanvasCards(payload);
  assert.equal(cards.some((card) => card.type === "launcher"), false);

  const launchers = buildCanvasLauncherCards(payload);
  assert.deepEqual(launchers.map((card) => card.title), ["Codex", "Cursor"]);
  assert.equal(launchers[0].ref.providerId, "codex");
  assert.equal(launchers[0].ref.actionLabel, "Launch");
  assert.equal(launchers[1].ref.appId, "cursor");
  assert.equal(launchers[1].subtitle, "desktop app");
  assert.equal(launchers[1].detail, "Open Cursor from the canvas.");
  assert.equal(launchers[1].ref.category, "editor");
});

test("buildCanvasCards promotes W&B tabs to monitor cards linked to source agents", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    sessions: [
      { id: "agent-1", name: "Trainer", providerId: "codex", status: "idle" },
      { id: "agent-2", name: "Quiet worker", providerId: "claude", status: "completed" },
    ],
    browserSessions: [
      {
        id: "wandb-browser",
        name: "Loss monitor",
        status: "running",
        callerSessionId: "agent-1",
        latestUrl: "https://wandb.ai/acme/semantic-autogaze/runs/run-42?token=secret#charts",
      },
      {
        id: "docs-browser",
        name: "Docs",
        status: "running",
        callerSessionId: "agent-1",
        latestUrl: "https://example.test/docs",
      },
    ],
  });

  const agent = cards.find((card) => card.id === "session:agent-1");
  const monitor = cards.find((card) => card.type === "monitor");
  const browser = cards.find((card) => card.id === "browser:docs-browser");

  assert.ok(agent, "linked idle agent should stay visible while a monitor is attached");
  assert.equal(monitor?.title, "Weights & Biases");
  assert.equal(monitor?.subtitle, "semantic-autogaze / run run-42");
  assert.equal(monitor?.href, "https://wandb.ai/acme/semantic-autogaze/runs/run-42");
  assert.equal(monitor?.ref.sourceSessionId, "agent-1");
  assert.equal(monitor?.ref.sourceCardId, "session:agent-1");
  assert.equal(monitor?.ref.actionLabel, "Open W&B");
  assert.equal(browser?.ref.sourceCardId, "session:agent-1");
  assert.equal(cards.some((card) => card.id === "browser:wandb-browser"), false);
});

test("buildCanvasCards promotes previewable app ports and leaves the noisy remainder off-canvas", () => {
  const cards = buildCanvasCards({
    node: { id: "node-1", name: "GPU box", status: "online" },
    ports: [
      ...Array.from({ length: 7 }, (_, index) => ({
        port: 5000 + index,
        name: `App ${index + 1}`,
        preferredAccess: index % 2 ? "direct" : "proxy",
      })),
      { port: 8765, name: "8765", preferredAccess: "direct", hasDirectUrl: true },
      { port: 9091, preferredAccess: "proxy", hasDirectUrl: true },
    ],
  });

  const appCards = cards.filter((card) => card.type === "app");
  assert.equal(appCards.length, 4);
  assert.equal(appCards.filter((card) => card.ref.embedUrl).length, 4);
  assert.equal(appCards.some((card) => card.id === "port:8765"), false);
  assert.equal(appCards.some((card) => card.id === "port:9091"), false);
  assert.equal(appCards.some((card) => card.title === "More local apps"), false);
  assert.equal(appCards.some((card) => card.title === "Local apps"), false);
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
    "session:s1": {
      x: 444,
      y: 222,
      width: 300,
      height: 190,
      z: 99,
      regionId: "gpu-box",
      regionX: 400,
      regionY: 200,
      regionWidth: 960,
      regionHeight: 720,
    },
  });

  assert.equal(layout["session:s1"].x, 444);
  assert.equal(layout["session:s1"].y, 222);
  assert.equal(layout["session:s1"].z, 99);
  assert.equal(layout["session:s1"].regionId, "gpu-box");
  assert.equal(layout["session:s1"].regionX, 400);
  assert.equal(layout["session:s1"].regionY, 200);
  assert.equal(layout["session:s1"].regionWidth, 960);
  assert.equal(layout["session:s1"].regionHeight, 720);
  assert.equal(getCanvasCardMachineId(cards.find((card) => card.id === "session:s1")), "node-1");
  assert.equal(getCanvasCardRegionId(cards.find((card) => card.id === "session:s1"), layout["session:s1"]), "gpu-box");
  assert.equal(layout["session:s2"].regionId, "node-1");
  assert.ok(Number.isFinite(layout["session:s2"].x));
  assert.ok(Number.isFinite(layout["machine:node-1"].y));
});

test("createFallbackCanvasLayout creates machine regions without overlapping cards", () => {
  const overlaps = (a, b) =>
    a.x < b.x + b.width
      && a.x + a.width > b.x
      && a.y < b.y + b.height
      && a.y + a.height > b.y;
  const cards = [
    ...buildCanvasCards({
      node: { id: "local", name: "Mac" },
      handoffJobs: [{ id: "handoff-1", title: "GPU to Pi", target: { label: "Pi" } }],
      brain: { noteCount: 2, notes: [{ relativePath: "index.md", title: "Index" }] },
      actionItems: [
        { id: "done-1", title: "Done setup", status: "completed" },
        { id: "open-1", title: "Open approval", status: "open" },
      ],
    }),
    ...buildCanvasCards({
      node: { id: "remote", name: "GPU box" },
      mode: "redacted",
      sessions: [
        { id: "remote-agent", name: "Trainer", status: "running" },
      ],
      actionItems: [{ id: "remote-open-1", title: "Remote open", status: "open" }],
    }),
  ];
  const layout = createFallbackCanvasLayout(cards);
  const regions = buildCanvasRegions(cards, layout);
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  const entries = Object.entries(layout);

  assert.deepEqual(regions.map((region) => region.id), ["local", "remote"]);
  assert.equal(regions[0].title, "Mac");
  assert.equal(regions[1].title, "GPU box");
  assert.equal(layout["machine:local"].regionId, "local");
  assert.equal(layout["handoff:handoff-1"].regionId, "local");
  assert.equal(layout["session:remote-agent"].regionId, "remote");
  assert.ok(layout["machine:remote"].x > layout["machine:local"].x);
  for (const card of cards) {
    const item = layout[card.id];
    const region = regionsById.get(item.regionId);
    assert.ok(region, `${card.id} should have a region`);
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    assert.ok(centerX >= region.x && centerX <= region.x + region.width, `${card.id} center x should be in region`);
    assert.ok(centerY >= region.y && centerY <= region.y + region.height, `${card.id} center y should be in region`);
  }
  for (let outer = 0; outer < entries.length; outer += 1) {
    for (let inner = outer + 1; inner < entries.length; inner += 1) {
      if (entries[outer][1].regionId !== entries[inner][1].regionId) continue;
      assert.equal(
        overlaps(entries[outer][1], entries[inner][1]),
        false,
        `${entries[outer][0]} overlaps ${entries[inner][0]}`,
      );
    }
  }
});

test("sanitizeCanvasLayout clamps invalid layout values before persistence", () => {
  const layout = sanitizeCanvasLayout({
    card: {
      x: 999_999,
      y: -999_999,
      width: 1,
      height: 10_000,
      z: 999_999,
      regionId: "GPU Box!!",
      regionX: 999_999,
      regionY: -999_999,
      regionWidth: 10,
      regionHeight: 99_999,
      unsafe: "drop me",
    },
  });

  assert.equal(layout.card.x, 20_000);
  assert.equal(layout.card.y, -2_000);
  assert.equal(layout.card.width, 180);
  assert.equal(layout.card.height, 920);
  assert.equal(layout.card.z, 100_000);
  assert.equal(layout.card.regionId, "GPU-Box");
  assert.equal(layout.card.regionX, 20_000);
  assert.equal(layout.card.regionY, -2_000);
  assert.equal(layout.card.regionWidth, 420);
  assert.equal(layout.card.regionHeight, 5_000);
  assert.equal(layout.card.unsafe, undefined);
});

test("canvas board id and storage key are stable per node", () => {
  const boardId = getCanvasBoardId({ node: { id: "mac main", name: "Mac" } });
  assert.equal(boardId, "machine:mac-main");
  assert.equal(
    getCanvasLayoutStorageKey(boardId),
    "swarmlab.canvas.layout.v7:machine:mac-main",
  );
  assert.equal(
    getCanvasViewportStorageKey(boardId),
    "swarmlab.canvas.viewport.v4:machine:mac-main",
  );
});
