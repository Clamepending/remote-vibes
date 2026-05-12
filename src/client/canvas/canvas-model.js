export const CANVAS_LAYOUT_STORAGE_PREFIX = "swarmlab.canvas.layout.v2";
export const CANVAS_VIEWPORT_STORAGE_PREFIX = "swarmlab.canvas.viewport.v1";

const DEFAULT_CARD_WIDTH = 270;
const DEFAULT_CARD_HEIGHT = 170;
const AGENT_CARD_WIDTH = 380;
const AGENT_CARD_HEIGHT = 430;
const BROWSER_CARD_WIDTH = 430;
const BROWSER_CARD_HEIGHT = 300;
const APP_CARD_WIDTH = 320;
const APP_CARD_HEIGHT = 220;
const MAX_INDIVIDUAL_PORT_CARDS = 4;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeId(value, fallback) {
  return normalizeText(value, fallback)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:._-]/g, "")
    .slice(0, 160) || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeOptionalDate(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : text;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }
  return "";
}

function compactTags(values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .slice(0, 5);
}

function countFromSummary(snapshot, key, fallback) {
  const summary = asObject(snapshot.summary || snapshot.counts);
  const value = summary[key];
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function getCanvasBoardId(snapshot) {
  const normalized = normalizeNodeSnapshot(snapshot);
  return `machine:${normalizeId(normalized.node.id, "local")}`;
}

export function getCanvasLayoutStorageKey(boardId) {
  return `${CANVAS_LAYOUT_STORAGE_PREFIX}:${normalizeId(boardId, "machine:local")}`;
}

export function getCanvasViewportStorageKey(boardId) {
  return `${CANVAS_VIEWPORT_STORAGE_PREFIX}:${normalizeId(boardId, "machine:local")}`;
}

export function normalizeNodeSnapshot(payload) {
  const input = asObject(payload);
  const snapshot = asObject(input.snapshot || input.nodeSnapshot || input);
  const nodeInput = asObject(snapshot.node || snapshot.machine || input.node || input.machine);
  const nodeId = normalizeId(
    pickFirst(nodeInput.id, nodeInput.nodeId, nodeInput.machineId, snapshot.nodeId, snapshot.machineId),
    "local",
  );
  const sessions = asArray(snapshot.sessions || input.sessions);
  const browserSessions = asArray(snapshot.browserSessions || snapshot.browsers || input.browserSessions);
  const actionItems = asArray(snapshot.actionItems || snapshot.approvals || input.actionItems || input.approvals);
  const ports = asArray(snapshot.ports || snapshot.apps || input.ports);
  const canvases = asArray(snapshot.canvases || snapshot.artifacts || input.canvases || input.artifacts);
  const projects = asArray(snapshot.projects || input.projects);
  const buildings = asArray(snapshot.buildings || input.buildings);
  const system = asObject(snapshot.system || input.system);
  const capabilities = asObject(snapshot.capabilities || input.capabilities);
  const generatedAt = normalizeOptionalDate(snapshot.generatedAt || input.generatedAt) || new Date(0).toISOString();

  return {
    schemaVersion: Number(snapshot.schemaVersion || 1),
    node: {
      id: nodeId,
      name: normalizeText(
        pickFirst(nodeInput.name, nodeInput.displayName, nodeInput.label, nodeInput.hostname),
        nodeId === "local" ? "This machine" : nodeId,
      ),
      status: normalizeText(pickFirst(nodeInput.status, snapshot.status), "local"),
      os: normalizeText(pickFirst(nodeInput.os, nodeInput.platform, system.platform)),
      version: normalizeText(pickFirst(nodeInput.version, snapshot.version)),
      hostname: normalizeText(nodeInput.hostname),
      lastSeenAt: normalizeOptionalDate(pickFirst(nodeInput.lastSeenAt, snapshot.lastSeenAt, generatedAt)),
    },
    capabilities,
    sessions,
    browserSessions,
    actionItems,
    canvases,
    ports,
    projects,
    system,
    buildings,
    counts: {
      sessions: countFromSummary(snapshot, "sessions", sessions.length),
      browserSessions: countFromSummary(snapshot, "browserSessions", browserSessions.length),
      approvals: countFromSummary(snapshot, "approvals", actionItems.length),
      ports: countFromSummary(snapshot, "ports", ports.length),
      artifacts: countFromSummary(snapshot, "artifacts", canvases.length),
      projects: countFromSummary(snapshot, "projects", projects.length),
      buildings: countFromSummary(snapshot, "buildings", buildings.length),
    },
    generatedAt,
  };
}

function makeCard({
  id,
  type,
  title,
  subtitle = "",
  status = "",
  detail = "",
  meta = "",
  tags = [],
  href = "",
  ref = {},
  width = DEFAULT_CARD_WIDTH,
  height = DEFAULT_CARD_HEIGHT,
}) {
  return {
    id: normalizeId(id, `${type}:${title || "card"}`),
    type,
    title: normalizeText(title, type),
    subtitle: normalizeText(subtitle),
    status: normalizeText(status),
    detail: normalizeText(detail),
    meta: normalizeText(meta),
    tags: compactTags(tags),
    href: normalizeText(href),
    ref,
    width: normalizeNumber(width, DEFAULT_CARD_WIDTH),
    height: normalizeNumber(height, DEFAULT_CARD_HEIGHT),
  };
}

function sessionCard(session, index, machineId) {
  const id = normalizeText(pickFirst(session.id, session.sessionId, session.name), `session-${index + 1}`);
  const provider = normalizeText(pickFirst(session.providerLabel, session.providerId, session.kind));
  const activity = normalizeText(pickFirst(session.activityStatus, session.status));
  const cwd = normalizeText(session.cwd || session.projectPath || session.workspace);
  return makeCard({
    id: `session:${id}`,
    type: session.kind === "browser" ? "browser" : "agent",
    title: pickFirst(session.name, session.title, id),
    subtitle: provider || "agent session",
    status: activity,
    detail: cwd,
    meta: normalizeOptionalDate(pickFirst(session.updatedAt, session.lastActivityAt, session.createdAt)),
    tags: [session.model, session.branch, session.providerId],
    ref: { machineId, sessionId: id },
    width: AGENT_CARD_WIDTH,
    height: AGENT_CARD_HEIGHT,
  });
}

function browserCard(session, index, machineId) {
  const id = normalizeText(pickFirst(session.id, session.browserUseSessionId, session.taskId), `browser-${index + 1}`);
  const snapshot = asObject(session.latestSnapshot || session.snapshot);
  return makeCard({
    id: `browser:${id}`,
    type: "browser",
    title: pickFirst(session.name, session.title, snapshot.title, id),
    subtitle: "browser",
    status: pickFirst(session.status, session.phase),
    detail: pickFirst(snapshot.url, session.url, session.task, session.prompt),
    meta: normalizeOptionalDate(pickFirst(session.updatedAt, session.createdAt)),
    tags: [session.provider, session.model],
    ref: { machineId, browserSessionId: id, sessionId: session.sessionId || "" },
    width: BROWSER_CARD_WIDTH,
    height: BROWSER_CARD_HEIGHT,
  });
}

function approvalCard(item, index, machineId) {
  const id = normalizeText(pickFirst(item.id, item.actionItemId, item.approvalId, item.title), `approval-${index + 1}`);
  return makeCard({
    id: `approval:${id}`,
    type: "approval",
    title: pickFirst(item.title, item.name, "Approval required"),
    subtitle: pickFirst(item.kind, item.priority, "human action"),
    status: pickFirst(item.status, item.priority),
    detail: pickFirst(item.detail, item.description, item.message),
    meta: normalizeOptionalDate(pickFirst(item.updatedAt, item.createdAt)),
    tags: [item.cta, item.source],
    href: item.href || "",
    ref: { machineId, actionItemId: id, sessionId: item.sessionId || "" },
    width: 300,
    height: 150,
  });
}

function portCard(port, index, machineId) {
  const rawPort = Number(port.port || port.number || port.id);
  const portLabel = Number.isInteger(rawPort) ? String(rawPort) : `port-${index + 1}`;
  const href = pickFirst(
    port.preferredUrl,
    port.directUrl,
    port.tailscaleUrl,
    port.url,
    Number.isInteger(rawPort) ? `/proxy/${rawPort}/` : "",
  );
  return makeCard({
    id: `port:${portLabel}`,
    type: "app",
    title: pickFirst(port.name, port.label, port.processName, portLabel),
    subtitle: Number.isInteger(rawPort) ? `localhost:${rawPort}` : "local app",
    status: pickFirst(port.preferredAccess, port.status, port.protocol),
    detail: pickFirst(port.command, port.pid ? `pid ${port.pid}` : "", port.host),
    meta: href,
    tags: [port.localOnly ? "local only" : "", port.exposedWithTailscale ? "tailscale" : ""],
    href,
    ref: { machineId, port: Number.isInteger(rawPort) ? rawPort : undefined },
    width: APP_CARD_WIDTH,
    height: APP_CARD_HEIGHT,
  });
}

function portsSummaryCard(ports, machineId) {
  const normalizedPorts = ports
    .map((port, index) => {
      const rawPort = Number(port.port || port.number || port.id);
      const label = Number.isInteger(rawPort)
        ? String(rawPort)
        : normalizeText(port.name || port.label || port.processName, `app-${index + 1}`);
      const name = normalizeText(pickFirst(port.name, port.label, port.processName, label), label);
      const access = normalizeText(pickFirst(port.preferredAccess, port.status, port.protocol));
      return { label, name, access };
    })
    .filter((port) => port.label || port.name);
  const sample = normalizedPorts
    .slice(0, 6)
    .map((port) => [port.label, port.name === port.label ? "" : port.name].filter(Boolean).join(" "))
    .join(" · ");
  return makeCard({
    id: "app:local-ports",
    type: "app",
    title: "Local apps",
    subtitle: `${ports.length} running ports`,
    status: "compact",
    detail: sample,
    meta: "Open individual ports from the machine sidebar; the canvas keeps apps compact.",
    tags: normalizedPorts.slice(0, 8).map((port) => port.access || port.label),
    href: "",
    ref: {
      machineId,
      ports: normalizedPorts,
    },
    width: 340,
    height: 230,
  });
}

function artifactCard(canvas, index, machineId) {
  const id = normalizeText(pickFirst(canvas.id, canvas.canvasId, canvas.imagePath, canvas.title), `artifact-${index + 1}`);
  return makeCard({
    id: `artifact:${id}`,
    type: "artifact",
    title: pickFirst(canvas.title, canvas.name, "Artifact"),
    subtitle: pickFirst(canvas.kind, canvas.type, "canvas artifact"),
    status: pickFirst(canvas.status, canvas.source),
    detail: pickFirst(canvas.caption, canvas.description, canvas.imagePath, canvas.previewUrl),
    meta: normalizeOptionalDate(pickFirst(canvas.updatedAt, canvas.createdAt)),
    tags: [canvas.sourceSessionId ? "from agent" : "", canvas.imagePath ? "image" : ""],
    href: canvas.previewUrl || canvas.href || "",
    ref: {
      machineId,
      artifactPath: canvas.imagePath || canvas.path || "",
      sessionId: canvas.sourceSessionId || "",
    },
    width: 320,
    height: 210,
  });
}

function machineCard(snapshot) {
  const node = snapshot.node;
  const system = snapshot.system || {};
  const cpu = system.cpu?.usagePercent ?? system.cpuPercent ?? system.cpuUsagePercent;
  const memory = system.memory?.usagePercent ?? system.memoryPercent ?? system.memoryUsagePercent;
  return makeCard({
    id: `machine:${node.id}`,
    type: "machine",
    title: node.name,
    subtitle: compactTags([node.os, node.version]).join(" / "),
    status: node.status,
    detail: `${snapshot.counts.sessions} sessions, ${snapshot.counts.ports} ports, ${snapshot.counts.approvals} approvals`,
    meta: node.lastSeenAt || snapshot.generatedAt,
    tags: [
      Number.isFinite(Number(cpu)) ? `cpu ${Math.round(Number(cpu))}%` : "",
      Number.isFinite(Number(memory)) ? `mem ${Math.round(Number(memory))}%` : "",
      `${snapshot.counts.artifacts} artifacts`,
    ],
    ref: { machineId: node.id },
    width: 320,
    height: 180,
  });
}

export function buildCanvasCards(payload) {
  const snapshot = normalizeNodeSnapshot(payload);
  const machineId = snapshot.node.id;
  const portCards = snapshot.ports.length > MAX_INDIVIDUAL_PORT_CARDS
    ? [portsSummaryCard(snapshot.ports, machineId)]
    : snapshot.ports.map((port, index) => portCard(port, index, machineId));
  return [
    machineCard(snapshot),
    ...snapshot.actionItems.map((item, index) => approvalCard(item, index, machineId)),
    ...snapshot.sessions.map((session, index) => sessionCard(session, index, machineId)),
    ...snapshot.browserSessions.map((session, index) => browserCard(session, index, machineId)),
    ...portCards,
    ...snapshot.canvases.map((canvas, index) => artifactCard(canvas, index, machineId)),
  ];
}

function fallbackPositionForCard(card, index, counters) {
  const type = card.type || "card";
  const next = counters[type] || 0;
  counters[type] = next + 1;

  if (type === "machine") {
    return { x: 120, y: 96 };
  }
  if (type === "agent") {
    const column = next % 3;
    const row = Math.floor(next / 3);
    return {
      x: 540 + column * 430 + (row % 2) * 58,
      y: 190 + row * 500 + (column === 1 ? 58 : 0),
    };
  }
  if (type === "browser") {
    const column = next % 2;
    const row = Math.floor(next / 2);
    return {
      x: 980 + column * 470,
      y: 80 + row * 350,
    };
  }
  if (type === "approval") {
    return {
      x: 120,
      y: 330 + next * 172,
    };
  }
  if (type === "app") {
    return {
      x: 120,
      y: 850 + next * 260,
    };
  }
  if (type === "artifact") {
    const column = next % 2;
    const row = Math.floor(next / 2);
    return {
      x: 1460 + column * 360,
      y: 210 + row * 260,
    };
  }
  return {
    x: 200 + (index % 4) * 360,
    y: 200 + Math.floor(index / 4) * 280,
  };
}

export function createFallbackCanvasLayout(cards) {
  const counters = {};
  return Object.fromEntries(cards.map((card, index) => {
    const { x, y } = fallbackPositionForCard(card, index, counters);
    return [
      card.id,
      {
        x,
        y,
        width: card.width,
        height: card.height,
        z: index + 1,
      },
    ];
  }));
}

export function sanitizeCanvasLayout(value) {
  const input = asObject(value);
  return Object.fromEntries(
    Object.entries(input)
      .map(([id, layout]) => {
        const item = asObject(layout);
        const x = normalizeNumber(item.x, 0);
        const y = normalizeNumber(item.y, 0);
        const width = normalizeNumber(item.width, DEFAULT_CARD_WIDTH);
        const height = normalizeNumber(item.height, DEFAULT_CARD_HEIGHT);
        const z = normalizeNumber(item.z, 0);
        if (!id) {
          return null;
        }
        return [
          id,
          {
            x: Math.round(Math.max(-2_000, Math.min(20_000, x))),
            y: Math.round(Math.max(-2_000, Math.min(20_000, y))),
            width: Math.round(Math.max(180, Math.min(720, width))),
            height: Math.round(Math.max(120, Math.min(540, height))),
            z: Math.round(Math.max(0, Math.min(100_000, z))),
          },
        ];
      })
      .filter(Boolean),
  );
}

export function mergeCanvasLayout(cards, savedLayout = {}) {
  const fallback = createFallbackCanvasLayout(cards);
  const saved = sanitizeCanvasLayout(savedLayout);
  return Object.fromEntries(cards.map((card, index) => {
    const base = fallback[card.id] || { x: 32, y: 32, width: card.width, height: card.height, z: index + 1 };
    const override = saved[card.id] || {};
    return [
      card.id,
      {
        ...base,
        ...override,
        width: override.width || card.width || base.width,
        height: override.height || card.height || base.height,
        z: override.z || base.z,
      },
    ];
  }));
}
