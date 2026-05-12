export const CANVAS_LAYOUT_STORAGE_PREFIX = "swarmlab.canvas.layout.v2";
export const CANVAS_VIEWPORT_STORAGE_PREFIX = "swarmlab.canvas.viewport.v1";

const DEFAULT_CARD_WIDTH = 270;
const DEFAULT_CARD_HEIGHT = 170;
const AGENT_CARD_WIDTH = 380;
const AGENT_CARD_HEIGHT = 430;
const BROWSER_CARD_WIDTH = 430;
const BROWSER_CARD_HEIGHT = 300;
const APP_CARD_WIDTH = 430;
const APP_CARD_HEIGHT = 310;
const APP_SUMMARY_CARD_WIDTH = 320;
const APP_SUMMARY_CARD_HEIGHT = 190;
const HANDOFF_CARD_WIDTH = 360;
const HANDOFF_CARD_HEIGHT = 230;
const BRAIN_CARD_WIDTH = 360;
const BRAIN_CARD_HEIGHT = 260;
const MAX_CANVAS_APP_CARDS = 4;
const COMMON_UI_PORTS = new Set([
  3000, 3001, 3100, 4173, 4178, 5000, 5050, 5173, 5178, 6006, 7860, 7861,
  7862, 7863, 8000, 8080, 8501, 8765, 8791,
]);
const DEBUG_OR_INFRA_PORTS = new Set([9229, 9230, 9231]);

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

function getPortNumber(port) {
  const rawPort = Number(port?.port || port?.number || port?.id);
  return Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65_536 ? rawPort : null;
}

function portHref(port) {
  const rawPort = getPortNumber(port);
  return pickFirst(
    port?.preferredUrl,
    port?.directUrl,
    port?.tailscaleUrl,
    port?.url,
    port?.proxyPath,
    rawPort ? `/proxy/${rawPort}/` : "",
  );
}

function portDisplayName(port, fallback) {
  return normalizeText(pickFirst(port?.name, port?.label, port?.customName, port?.processName, fallback), fallback);
}

function isLikelyVisibleAppPort(port) {
  const rawPort = getPortNumber(port);
  if (!rawPort || DEBUG_OR_INFRA_PORTS.has(rawPort) || !portHref(port)) {
    return false;
  }
  if (port?.hidden === true || port?.canvasHidden === true || port?.canvasVisible === false) {
    return false;
  }
  return Boolean(
    port?.customName ||
      port?.canvasVisible === true ||
      port?.previewKind === "preview" ||
      port?.preferredAccess ||
      port?.hasDirectUrl ||
      port?.hasTailscaleUrl ||
      COMMON_UI_PORTS.has(rawPort),
  );
}

function scoreVisibleAppPort(port) {
  const rawPort = getPortNumber(port);
  let score = 0;
  if (port?.customName) score += 80;
  if (port?.canvasVisible === true) score += 70;
  if (COMMON_UI_PORTS.has(rawPort)) score += 45;
  if (port?.preferredAccess === "direct") score += 12;
  if (port?.preferredAccess === "proxy") score += 8;
  if (port?.hasDirectUrl) score += 6;
  if (rawPort && rawPort >= 49_000) score -= 20;
  if (rawPort && rawPort >= 9_000 && rawPort < 10_000) score -= 12;
  return score;
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
  const handoffJobs = asArray(snapshot.handoffJobs || snapshot.jobs || input.handoffJobs || input.jobs);
  const brain = asObject(snapshot.brain || input.brain);
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
    handoffJobs,
    brain,
    counts: {
      sessions: countFromSummary(snapshot, "sessions", sessions.length),
      browserSessions: countFromSummary(snapshot, "browserSessions", browserSessions.length),
      approvals: countFromSummary(snapshot, "approvals", actionItems.length),
      ports: countFromSummary(snapshot, "ports", ports.length),
      artifacts: countFromSummary(snapshot, "artifacts", canvases.length),
      projects: countFromSummary(snapshot, "projects", projects.length),
      buildings: countFromSummary(snapshot, "buildings", buildings.length),
      handoffJobs: countFromSummary(snapshot, "handoffJobs", handoffJobs.length),
      brainNotes: countFromSummary(snapshot, "brainNotes", Number(brain.noteCount || brain.notes?.length || 0)),
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
  const rawPort = getPortNumber(port);
  const portLabel = rawPort ? String(rawPort) : `port-${index + 1}`;
  const href = portHref(port);
  const name = portDisplayName(port, portLabel);
  return makeCard({
    id: `port:${portLabel}`,
    type: "app",
    title: name,
    subtitle: Number.isInteger(rawPort) ? `localhost:${rawPort}` : "local app",
    status: pickFirst(port.preferredAccess, port.status, port.protocol),
    detail: "Live app preview",
    meta: href,
    tags: [port.localOnly ? "local only" : "", port.exposedWithTailscale ? "tailscale" : "", port.customName ? "named" : ""],
    href,
    ref: {
      machineId,
      port: Number.isInteger(rawPort) ? rawPort : undefined,
      embedUrl: href,
      actionLabel: "Open app",
    },
    width: APP_CARD_WIDTH,
    height: APP_CARD_HEIGHT,
  });
}

function portsSummaryCard(ports, machineId, { visibleCount = 0 } = {}) {
  const normalizedPorts = ports
    .map((port, index) => {
      const rawPort = getPortNumber(port);
      const label = rawPort
        ? String(rawPort)
        : portDisplayName(port, `app-${index + 1}`);
      const name = portDisplayName(port, label);
      const access = normalizeText(pickFirst(port.preferredAccess, port.status, port.protocol));
      return { label, name, access };
    })
    .filter((port) => port.label || port.name);
  const hiddenCount = Math.max(0, ports.length - visibleCount);
  const sample = normalizedPorts
    .slice(0, 6)
    .map((port) => [port.label, port.name === port.label ? "" : port.name].filter(Boolean).join(" "))
    .join(" · ");
  return makeCard({
    id: "app:local-ports",
    type: "app",
    title: visibleCount ? "More local apps" : "Local apps",
    subtitle: visibleCount ? `${hiddenCount} more ports` : `${ports.length} previewable ports`,
    status: "compact",
    detail: sample,
    meta: "Hidden from the main board until named or opened.",
    tags: normalizedPorts.slice(0, 8).map((port) => port.access || port.label),
    href: "",
    ref: {
      machineId,
      ports: normalizedPorts,
    },
    width: APP_SUMMARY_CARD_WIDTH,
    height: APP_SUMMARY_CARD_HEIGHT,
  });
}

function buildPortCards(ports, machineId) {
  const visiblePorts = ports
    .filter(isLikelyVisibleAppPort)
    .map((port, index) => ({ port, index, score: scoreVisibleAppPort(port) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_CANVAS_APP_CARDS)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.port);

  const cards = visiblePorts.map((port, index) => portCard(port, index, machineId));
  if (ports.length > visiblePorts.length) {
    cards.push(portsSummaryCard(ports, machineId, { visibleCount: visiblePorts.length }));
  }
  return cards;
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

function handoffCard(job, index, machineId) {
  const id = normalizeText(pickFirst(job.id, job.title), `handoff-${index + 1}`);
  const target = asObject(job.target);
  const steps = asArray(job.steps);
  const stepSummary = steps.length
    ? steps
      .slice(0, 4)
      .map((step) => `${normalizeText(step.title, "step")}: ${normalizeText(step.status, "pending")}`)
      .join(" · ")
    : "";
  return makeCard({
    id: `handoff:${id}`,
    type: "handoff",
    title: pickFirst(job.title, "Machine handoff"),
    subtitle: pickFirst(target.label, target.sshTarget, target.url, "target machine"),
    status: pickFirst(job.status, "planned"),
    detail: pickFirst(job.objectivePreview, job.objective, stepSummary),
    meta: normalizeOptionalDate(pickFirst(job.updatedAt, job.createdAt)),
    tags: [
      target.sshTarget ? "ssh" : "",
      target.url ? "canvas" : "",
      job.providerId || "",
      `${steps.length || 0} steps`,
    ],
    href: job.launchedSessionId ? "" : "",
    ref: {
      machineId,
      jobId: id,
      target,
      launchedSessionId: job.launchedSessionId || "",
      actionLabel: job.launchedSessionId ? "Open agent" : "Launch",
      steps,
    },
    width: HANDOFF_CARD_WIDTH,
    height: HANDOFF_CARD_HEIGHT,
  });
}

function brainCard(brain, machineId) {
  const notes = asArray(brain.notes);
  if (!notes.length && !Number(brain.noteCount || 0)) {
    return null;
  }
  const visible = notes.slice(0, 4).map((note) => ({
    title: normalizeText(note.title || note.relativePath, "Note"),
    path: normalizeText(note.relativePath),
    excerpt: normalizeText(note.takeaway || note.excerpt),
  }));
  return makeCard({
    id: "brain:markdown",
    type: "brain",
    title: "Markdown brain",
    subtitle: normalizeText(brain.relativeRoot || "library"),
    status: `${Number(brain.noteCount || notes.length) || 0} notes`,
    detail: visible.map((note) => note.title).join(" · "),
    meta: `${Number(brain.edgeCount || 0) || 0} links`,
    tags: visible.map((note) => note.path).filter(Boolean).slice(0, 4),
    href: "/?view=library",
    ref: {
      machineId,
      notes: visible,
      noteCount: Number(brain.noteCount || notes.length) || 0,
      edgeCount: Number(brain.edgeCount || 0) || 0,
      actionLabel: "Open brain",
    },
    width: BRAIN_CARD_WIDTH,
    height: BRAIN_CARD_HEIGHT,
  });
}

function machineCard(snapshot) {
  const node = snapshot.node;
  const system = snapshot.system || {};
  const cpu = system.cpu?.usagePercent ?? system.cpuPercent ?? system.cpuUsagePercent;
  const memory = system.memory?.usagePercent ?? system.memoryPercent ?? system.memoryUsagePercent;
  const roles = compactTags(snapshot.capabilities?.roles || []);
  const gpuCount = Number(snapshot.capabilities?.gpuCount || snapshot.system?.gpuCount || 0);
  const providerCount = Number(snapshot.capabilities?.providerCount || 0);
  return makeCard({
    id: `machine:${node.id}`,
    type: "machine",
    title: node.name,
    subtitle: compactTags([node.os, node.version]).join(" / "),
    status: node.status,
    detail: `${snapshot.counts.sessions} sessions, ${snapshot.counts.ports} apps, ${snapshot.counts.handoffJobs} handoffs`,
    meta: node.lastSeenAt || snapshot.generatedAt,
    tags: [
      Number.isFinite(Number(cpu)) ? `cpu ${Math.round(Number(cpu))}%` : "",
      Number.isFinite(Number(memory)) ? `mem ${Math.round(Number(memory))}%` : "",
      gpuCount ? `${gpuCount} gpu${gpuCount === 1 ? "" : "s"}` : "",
      providerCount ? `${providerCount} providers` : "",
      ...roles,
    ],
    ref: { machineId: node.id },
    width: 320,
    height: 180,
  });
}

export function buildCanvasCards(payload) {
  const snapshot = normalizeNodeSnapshot(payload);
  const machineId = snapshot.node.id;
  const portCards = buildPortCards(snapshot.ports, machineId);
  const cards = [
    machineCard(snapshot),
    brainCard(snapshot.brain, machineId),
    ...snapshot.actionItems.map((item, index) => approvalCard(item, index, machineId)),
    ...snapshot.handoffJobs.map((job, index) => handoffCard(job, index, machineId)),
    ...snapshot.sessions.map((session, index) => sessionCard(session, index, machineId)),
    ...snapshot.browserSessions.map((session, index) => browserCard(session, index, machineId)),
    ...portCards,
    ...snapshot.canvases.map((canvas, index) => artifactCard(canvas, index, machineId)),
  ];
  return cards.filter(Boolean);
}

function fallbackPositionForCard(card, index, counters) {
  const type = card.type || "card";
  const next = counters[type] || 0;
  counters[type] = next + 1;

  if (type === "machine") {
    return {
      x: 120,
      y: 96 + next * 220,
    };
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
  if (type === "handoff") {
    return {
      x: 120,
      y: 330 + next * 250,
    };
  }
  if (type === "brain") {
    return {
      x: 120,
      y: 590 + next * 280,
    };
  }
  if (type === "app") {
    return {
      x: 120,
      y: 900 + next * 260,
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
