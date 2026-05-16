export const CANVAS_LAYOUT_STORAGE_PREFIX = "swarmlab.canvas.layout.v7";
export const CANVAS_VIEWPORT_STORAGE_PREFIX = "swarmlab.canvas.viewport.v4";
export const CANVAS_REGION_RESIZE_LIMITS = Object.freeze({
  minWidth: 420,
  minHeight: 320,
  maxWidth: 4_000,
  maxHeight: 5_000,
});

const DEFAULT_CARD_WIDTH = 270;
const DEFAULT_CARD_HEIGHT = 170;
const AGENT_CARD_WIDTH = 640;
const AGENT_CARD_HEIGHT = 720;
const TERMINAL_CARD_WIDTH = 620;
const TERMINAL_CARD_HEIGHT = 520;
const BROWSER_CARD_WIDTH = 430;
const BROWSER_CARD_HEIGHT = 300;
const CANVAS_BROWSER_CARD_WIDTH = 660;
const CANVAS_BROWSER_CARD_HEIGHT = 500;
const MONITOR_CARD_WIDTH = 430;
const MONITOR_CARD_HEIGHT = 300;
const APP_CARD_WIDTH = 410;
const APP_CARD_HEIGHT = 270;
const LAUNCHER_CARD_WIDTH = 320;
const LAUNCHER_CARD_HEIGHT = 170;
const HANDOFF_CARD_WIDTH = 360;
const HANDOFF_CARD_HEIGHT = 230;
const BRAIN_CARD_WIDTH = 360;
const BRAIN_CARD_HEIGHT = 260;
const SUMMARY_CARD_WIDTH = 320;
const SUMMARY_CARD_HEIGHT = 170;
const MACHINE_REGION_COLUMNS = 2;
const MACHINE_REGION_WIDTH = 980;
const MACHINE_REGION_MIN_HEIGHT = 720;
const MACHINE_REGION_MARGIN_X = 96;
const MACHINE_REGION_MARGIN_Y = 96;
const MACHINE_REGION_GAP_X = 150;
const MACHINE_REGION_GAP_Y = 140;
const MACHINE_REGION_PADDING_X = 32;
const MACHINE_REGION_HEADER_HEIGHT = 78;
const MACHINE_REGION_BOTTOM_PADDING = 38;
const MACHINE_REGION_COLUMN_GAP = 42;
const MACHINE_REGION_ROW_GAP = 30;
const MACHINE_REGION_LEFT_WIDTH = 330;
const MAX_CANVAS_AGENT_CARDS = 4;
const MAX_CANVAS_BROWSER_CARDS = 2;
const MAX_CANVAS_MONITOR_CARDS = 4;
const MAX_CANVAS_ARTIFACT_CARDS = 1;
const MAX_CANVAS_APP_CARDS = 4;
const MAX_CANVAS_APP_INSTANCE_CARDS = 4;
const MAX_CANVAS_LAUNCHER_CARDS = 8;
const ACTIVE_STATUSES = new Set(["active", "busy", "connected", "launching", "open", "pending", "queued", "resuming", "running", "starting", "streaming", "working"]);
const QUIET_STATUSES = new Set(["archived", "closed", "completed", "dismissed", "done", "exited", "idle", "resolved", "stopped", "succeeded"]);
const PROBLEM_STATUSES = new Set(["blocked", "error", "failed", "failing", "needs_attention", "warning"]);
const COMMON_UI_PORTS = new Set([
  3000, 3001, 3100, 4173, 4178, 5000, 5050, 5173, 5178, 6006, 7860, 7861,
  7862, 7863, 8000, 8080, 8501, 8765, 8791,
]);
const DEBUG_OR_INFRA_PORTS = new Set([9229, 9230, 9231]);
const URL_SENSITIVE_PARAMS = new Set([
  "access_token",
  "api_key",
  "auth",
  "code",
  "key",
  "password",
  "secret",
  "state",
  "token",
]);
const MONITOR_HOSTS = [
  { kind: "wandb", label: "Weights & Biases", hostPattern: /(^|\.)wandb\.ai$/u },
  { kind: "tensorboard", label: "TensorBoard", hostPattern: /(^|\.)tensorboard\.dev$/u },
  { kind: "mlflow", label: "MLflow", hostPattern: /(^|\.)mlflow\./u },
  { kind: "comet", label: "Comet", hostPattern: /(^|\.)comet\.com$/u },
];

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

function normalizeUrl(value) {
  const raw = normalizeText(value)
    .replace(/[),.;]+$/u, "");
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (URL_SENSITIVE_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function classifyMonitorUrl(value) {
  const urlText = normalizeUrl(value);
  if (!urlText) {
    return null;
  }
  try {
    const url = new URL(urlText);
    const hostname = url.hostname.toLowerCase();
    const match = MONITOR_HOSTS.find((candidate) => candidate.hostPattern.test(hostname));
    if (!match) {
      return null;
    }
    return { ...match, url: urlText, host: hostname, pathParts: url.pathname.split("/").filter(Boolean) };
  } catch {
    return null;
  }
}

function isMonitorUrl(value) {
  return Boolean(classifyMonitorUrl(value));
}

function safePathSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
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

function hasIntentionalPortName(port) {
  const rawPort = getPortNumber(port);
  const fallback = rawPort ? String(rawPort) : "app";
  const name = portDisplayName(port, fallback);
  const normalized = name.toLowerCase().trim();
  if (!normalized || normalized === fallback || normalized === `localhost:${fallback}`) {
    return false;
  }
  return !/^(node|python|python\d+(\.\d+)?|ruby|java|go|server|localhost)$/u.test(normalized);
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
      hasIntentionalPortName(port),
  );
}

function scoreVisibleAppPort(port) {
  const rawPort = getPortNumber(port);
  let score = 0;
  if (port?.customName) score += 80;
  if (port?.canvasVisible === true) score += 70;
  if (hasIntentionalPortName(port)) score += 52;
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

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "_");
}

function hasAnyStatus(status, statuses) {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    return false;
  }
  return statuses.has(normalized) || [...statuses].some((candidate) => normalized.includes(candidate));
}

function isVisibleAppInstance(instance = {}) {
  return normalizeText(pickFirst(instance?.appId, instance?.launcherId, instance?.id)) &&
    !hasAnyStatus(pickFirst(instance?.status, instance?.state), QUIET_STATUSES) &&
    !instance?.dismissedAt;
}

function timestampMs(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
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
  const appInstances = asArray(snapshot.appInstances || snapshot.applicationInstances || input.appInstances)
    .filter(isVisibleAppInstance);
  const rawLaunchers = asArray(snapshot.launchers || snapshot.appLaunchers || snapshot.applicationLaunchers || input.launchers);
  const canvases = asArray(snapshot.canvases || snapshot.artifacts || input.canvases || input.artifacts);
  const resources = asArray(snapshot.resources || snapshot.monitors || snapshot.researchResources || input.resources || input.monitors);
  const projects = asArray(snapshot.projects || input.projects);
  const buildings = asArray(snapshot.buildings || input.buildings);
  const handoffJobs = asArray(snapshot.handoffJobs || snapshot.jobs || input.handoffJobs || input.jobs);
  const brain = asObject(snapshot.brain || input.brain);
  const system = asObject(snapshot.system || input.system);
  const capabilities = asObject(snapshot.capabilities || input.capabilities);
  const providerLaunchers = rawLaunchers.length
    ? []
    : asArray(capabilities.providers)
      .filter((provider) => provider?.available && provider?.id)
      .map((provider) => {
        const providerId = normalizeText(provider.id);
        const isShell = providerId === "shell";
        const label = isShell ? "Terminal" : normalizeText(provider.label || provider.id, providerId);
        return {
          id: `provider:${providerId}`,
          label,
          kind: "agent-provider",
          category: isShell ? "terminal" : "agent",
          priority: isShell ? 96 : 100,
          description: isShell
            ? "Open a persistent terminal inside the canvas on this machine."
            : `Start a new ${label} agent on this machine.`,
          providerId,
          defaultName: isShell ? "Terminal" : normalizeText(provider.defaultName || provider.label || provider.id, label),
          available: true,
        };
      });
  const launchers = rawLaunchers.length ? rawLaunchers : providerLaunchers;
  const generatedAt = normalizeOptionalDate(snapshot.generatedAt || input.generatedAt) || new Date(0).toISOString();

  return {
    schemaVersion: Number(snapshot.schemaVersion || 1),
    mode: normalizeText(pickFirst(snapshot.mode, input.mode)),
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
    resources,
    ports,
    appInstances,
    launchers,
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
      appInstances: appInstances.length,
      launchers: countFromSummary(snapshot, "launchers", launchers.length),
      artifacts: countFromSummary(snapshot, "artifacts", canvases.length),
      resources: countFromSummary(snapshot, "resources", resources.length),
      projects: countFromSummary(snapshot, "projects", projects.length),
      buildings: countFromSummary(snapshot, "buildings", buildings.length),
      handoffJobs: countFromSummary(snapshot, "handoffJobs", handoffJobs.length),
      brainNotes: countFromSummary(snapshot, "brainNotes", Number(brain.noteCount || brain.notes?.length || 0)),
    },
    generatedAt,
  };
}

export function getCanvasCardMachineId(card) {
  return normalizeId(card?.ref?.machineId || card?.ref?.remoteMachineId || card?.ref?.remoteUrl || card?.id || "local", "local");
}

export function getCanvasCardRegionId(card, layout = {}) {
  const fallback = getCanvasCardMachineId(card);
  return normalizeId(layout?.regionId || fallback, fallback);
}

export function isCanvasRegionMetadataCard(card) {
  return String(card?.type || "") === "machine";
}

export function isRenderableCanvasCard(card) {
  return Boolean(card) && !isCanvasRegionMetadataCard(card);
}

export function getRenderableCanvasCards(cards = []) {
  return Array.isArray(cards) ? cards.filter(isRenderableCanvasCard) : [];
}

export function getRenderableCanvasCardIds(cards = []) {
  return new Set(getRenderableCanvasCards(cards).map((card) => card.id));
}

export function buildCanvasRegions(cards, layout = {}) {
  const regionMap = new Map();

  const ensureRegion = (id) => {
    const regionId = normalizeId(id, "local");
    if (!regionMap.has(regionId)) {
      regionMap.set(regionId, {
        id: regionId,
        title: regionId,
        subtitle: "",
        status: "",
        detail: "",
        meta: "",
        tags: [],
        remoteNodeId: "",
        remoteUrl: "",
        x: Infinity,
        y: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        index: regionMap.size,
      });
    }
    return regionMap.get(regionId);
  };
  const finiteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const extendRegion = (region, x, y, width, height) => {
    if (![x, y, width, height].every((value) => Number.isFinite(value))) return;
    region.x = Math.min(region.x, x);
    region.y = Math.min(region.y, y);
    region.maxX = Math.max(region.maxX, x + width);
    region.maxY = Math.max(region.maxY, y + height);
  };

  cards.forEach((card) => {
    const machineId = getCanvasCardMachineId(card);
    const region = ensureRegion(machineId);
    if (isCanvasRegionMetadataCard(card)) {
      region.title = card.title || region.title;
      region.subtitle = card.subtitle || region.subtitle;
      region.status = card.status || region.status;
      region.detail = card.detail || region.detail;
      region.meta = card.meta || region.meta;
      region.tags = card.tags || region.tags;
      region.remoteNodeId = card.ref?.remoteNodeId || region.remoteNodeId;
      region.remoteUrl = card.ref?.remoteUrl || region.remoteUrl;
    } else {
      region.remoteNodeId = region.remoteNodeId || card.ref?.remoteNodeId || "";
      region.remoteUrl = region.remoteUrl || card.ref?.remoteUrl || "";
    }
  });

  cards.forEach((card) => {
    const item = layout?.[card.id] || {};
    const machineId = getCanvasCardMachineId(card);
    const regionId = getCanvasCardRegionId(card, item);
    const region = ensureRegion(regionId);
    const regionX = finiteNumber(item.regionX);
    const regionY = finiteNumber(item.regionY);
    const regionWidth = finiteNumber(item.regionWidth);
    const regionHeight = finiteNumber(item.regionHeight);
    if (regionId === machineId && regionX != null && regionY != null && regionWidth != null && regionHeight != null) {
      extendRegion(region, regionX, regionY, regionWidth, regionHeight);
    }
    if (item.hidden) {
      return;
    }
    const cardX = finiteNumber(item.x);
    const cardY = finiteNumber(item.y);
    const cardWidth = finiteNumber(item.width) || card.width || DEFAULT_CARD_WIDTH;
    const cardHeight = finiteNumber(item.height) || card.height || DEFAULT_CARD_HEIGHT;
    if (cardX != null && cardY != null) {
      extendRegion(region, cardX - 34, cardY - 62, cardWidth + 68, cardHeight + 108);
    }
  });

  return [...regionMap.values()]
    .sort((left, right) => left.index - right.index)
    .map((region, index) => {
      const fallbackX = MACHINE_REGION_MARGIN_X + (index % MACHINE_REGION_COLUMNS) * (MACHINE_REGION_WIDTH + MACHINE_REGION_GAP_X);
      const fallbackY = MACHINE_REGION_MARGIN_Y + Math.floor(index / MACHINE_REGION_COLUMNS) * (MACHINE_REGION_MIN_HEIGHT + MACHINE_REGION_GAP_Y);
      const x = Number.isFinite(region.x) ? Math.round(region.x) : fallbackX;
      const y = Number.isFinite(region.y) ? Math.round(region.y) : fallbackY;
      return {
        id: region.id,
        title: region.title,
        subtitle: region.subtitle,
        status: region.status,
        detail: region.detail,
        meta: region.meta,
        tags: region.tags,
        remoteNodeId: region.remoteNodeId,
        remoteUrl: region.remoteUrl,
        x,
        y,
        width: Math.round(Math.max(MACHINE_REGION_WIDTH, (Number.isFinite(region.maxX) ? region.maxX - x : MACHINE_REGION_WIDTH))),
        height: Math.round(Math.max(MACHINE_REGION_MIN_HEIGHT, (Number.isFinite(region.maxY) ? region.maxY - y : MACHINE_REGION_MIN_HEIGHT))),
        colorIndex: index % 6,
      };
    });
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

function compactSummaryItems(items, mapper) {
  return items
    .map(mapper)
    .filter((item) => item && (item.title || item.status || item.meta))
    .slice(0, 12);
}

function summaryCard({
  id,
  title,
  subtitle = "",
  status = "compact",
  detail = "",
  meta = "",
  tags = [],
  items = [],
  machineId,
  summaryKind,
}) {
  return makeCard({
    id: `summary:${id}`,
    type: "summary",
    title,
    subtitle,
    status,
    detail,
    meta,
    tags,
    ref: { machineId, summaryKind, items },
    width: SUMMARY_CARD_WIDTH,
    height: SUMMARY_CARD_HEIGHT,
  });
}

function sessionCard(session, index, machineId) {
  const id = normalizeText(pickFirst(session.id, session.sessionId, session.name), `session-${index + 1}`);
  const provider = normalizeText(pickFirst(session.providerLabel, session.providerId, session.kind));
  const providerId = normalizeText(session.providerId);
  const isShell = providerId === "shell";
  const shellActivity = asObject(session.shellActivity);
  const shellActivityCount = Math.max(0, Math.round(Number(shellActivity.count || 0) || 0));
  const activity = normalizeText(pickFirst(session.activityStatus, session.status));
  const cwd = normalizeText(session.cwd || session.projectPath || session.workspace);
  return makeCard({
    id: `session:${id}`,
    type: session.kind === "browser" ? "browser" : "agent",
    title: isShell ? pickFirst(session.name, session.title, "Terminal") : pickFirst(session.name, session.title, id),
    subtitle: isShell ? "Terminal" : (provider || "agent session"),
    status: activity,
    detail: cwd,
    meta: normalizeOptionalDate(pickFirst(session.updatedAt, session.lastActivityAt, session.createdAt)),
    tags: [session.model, session.branch, providerId, isShell ? "shell" : "", shellActivityCount ? `${shellActivityCount} shell` : ""],
    ref: {
      machineId,
      sessionId: id,
      providerId,
      providerLabel: normalizeText(session.providerLabel),
      cwd,
      name: normalizeText(pickFirst(session.name, session.title, isShell ? "Terminal" : id), isShell ? "Terminal" : id),
      status: activity,
      shellSession: isShell,
      shellActivityCount,
      shellActivityLabel: normalizeText(shellActivity.lastLabel),
      shellActivityStatus: normalizeText(shellActivity.lastStatus),
    },
    width: isShell ? TERMINAL_CARD_WIDTH : AGENT_CARD_WIDTH,
    height: isShell ? TERMINAL_CARD_HEIGHT : AGENT_CARD_HEIGHT,
  });
}

function sessionStatus(session) {
  return pickFirst(session.activityStatus, session.status, session.phase);
}

function sessionTitle(session, index) {
  const id = normalizeText(pickFirst(session.id, session.sessionId, session.name), `session-${index + 1}`);
  return normalizeText(pickFirst(session.name, session.title, id), id);
}

function sessionId(session, index = 0) {
  return normalizeText(pickFirst(session?.id, session?.sessionId, session?.name), `session-${index + 1}`);
}

function sessionHasMonitorResource(session) {
  return asArray(session?.resources).some((resource) => isMonitorUrl(resource?.url || resource?.href || resource));
}

function sessionShellActivityCount(session) {
  return Math.max(0, Math.round(Number(asObject(session?.shellActivity).count || 0) || 0));
}

function sessionSignalScore(session, index, { total = 0, redacted = false, linkedSessionIds = new Set() } = {}) {
  if (session?.canvasHidden === true || session?.hidden === true) {
    return -Infinity;
  }
  const id = sessionId(session, index);
  const status = sessionStatus(session);
  const title = sessionTitle(session, index).toLowerCase();
  const providerId = normalizeText(session?.providerId);
  const isShell = providerId === "shell";
  const shellActivityCount = sessionShellActivityCount(session);
  let score = 0;
  if (isShell) score += 125;
  if (hasAnyStatus(status, ACTIVE_STATUSES)) score += 120;
  if (hasAnyStatus(status, PROBLEM_STATUSES)) score += 105;
  if (linkedSessionIds.has(id)) score += 85;
  if (sessionHasMonitorResource(session)) score += 80;
  if (shellActivityCount) score += Math.min(95, 55 + shellActivityCount * 8);
  if (title.includes("handoff")) score += 90;
  if (session?.lastMessage || session?.messageCount || session?.narrativeCount) score += 35;
  if (!normalizeStatus(status) && total <= 2 && !redacted) score += 55;
  if (!score && total <= 1 && !redacted) score += 45;
  if (hasAnyStatus(status, QUIET_STATUSES)) score -= isShell ? 10 : (redacted ? 70 : 35);
  score += Math.min(20, Math.max(0, timestampMs(session?.updatedAt, session?.lastActivityAt, session?.createdAt) / 1_000_000_000_000));
  return score;
}

function sessionSummaryCard(sessions, machineId) {
  const items = compactSummaryItems(sessions, (entry) => ({
    title: sessionTitle(entry.session, entry.index),
    status: normalizeText(sessionStatus(entry.session), "quiet"),
    meta: normalizeOptionalDate(pickFirst(entry.session.updatedAt, entry.session.lastActivityAt, entry.session.createdAt)),
  }));
  const sample = items.slice(0, 3).map((item) => item.title).join(" · ");
  return summaryCard({
    id: "agents-archive",
    title: "Quiet agents",
    subtitle: `${sessions.length} hidden`,
    detail: sample,
    meta: "Idle and finished agent windows are collapsed.",
    tags: ["agents", "archive"],
    items,
    machineId,
    summaryKind: "agent",
  });
}

function buildSessionCards(sessions, machineId, { redacted = false, linkedSessionIds = new Set() } = {}) {
  const entries = sessions.map((session, index) => ({
    session,
    index,
    score: sessionSignalScore(session, index, { total: sessions.length, redacted, linkedSessionIds }),
  }));
  const visible = entries
    .filter((entry) => entry.score >= 50)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_CANVAS_AGENT_CARDS);

  if (!visible.length && entries.length && !redacted) {
    visible.push([...entries].sort((left, right) => right.score - left.score || left.index - right.index)[0]);
  }

  const visibleIndexes = new Set(visible.map((entry) => entry.index));
  const hidden = entries.filter((entry) => !visibleIndexes.has(entry.index));
  const cards = visible
    .sort((left, right) => left.index - right.index)
    .map((entry) => sessionCard(entry.session, entry.index, machineId));
  if (hidden.length) {
    cards.push(sessionSummaryCard(hidden, machineId));
  }
  return cards;
}

function browserSessionUrl(session) {
  const snapshot = asObject(session?.latestSnapshot || session?.snapshot);
  const tabs = asArray(snapshot.tabs);
  const activeTab = tabs.find((tab) => tab?.active) || tabs[0] || {};
  return normalizeUrl(pickFirst(
    snapshot.url,
    activeTab.url,
    session?.latestUrl,
    session?.url,
    session?.latestOrigin,
  ));
}

function browserSourceSessionId(session) {
  return normalizeText(pickFirst(session?.callerSessionId, session?.sourceSessionId, session?.sessionId));
}

function sourceCardIdForSession(sourceSessionId) {
  return sourceSessionId ? `session:${normalizeId(sourceSessionId, sourceSessionId)}` : "";
}

function monitorSubtitle(monitor) {
  if (monitor?.kind === "wandb") {
    const [entity, project, maybeRuns, runId] = monitor.pathParts || [];
    const projectName = safePathSegment(project);
    const runName = safePathSegment(runId);
    if (maybeRuns === "runs" && projectName) {
      return runName ? `${projectName} / run ${runName}` : `${projectName} / run`;
    }
    if (projectName) {
      return `${projectName} / project`;
    }
    return safePathSegment(entity) || "wandb";
  }
  return monitor?.host || "monitor";
}

function monitorTitle(monitor, fallback = "") {
  if (monitor?.kind === "wandb") return "Weights & Biases";
  return normalizeText(fallback, monitor?.label || "Live monitor");
}

function browserCard(session, index, machineId) {
  const id = normalizeText(pickFirst(session.id, session.browserUseSessionId, session.taskId), `browser-${index + 1}`);
  const snapshot = asObject(session.latestSnapshot || session.snapshot);
  const url = browserSessionUrl(session);
  const sourceSessionId = browserSourceSessionId(session);
  return makeCard({
    id: `browser:${id}`,
    type: "browser",
    title: pickFirst(session.name, session.title, snapshot.title, id),
    subtitle: "browser",
    status: pickFirst(session.status, session.phase),
    detail: pickFirst(url, session.taskPreview, session.task, session.prompt),
    meta: normalizeOptionalDate(pickFirst(session.updatedAt, session.createdAt)),
    tags: [session.provider, session.model],
    href: url,
    ref: {
      machineId,
      browserSessionId: id,
      sessionId: session.sessionId || sourceSessionId || "",
      sourceSessionId,
      sourceCardId: sourceCardIdForSession(sourceSessionId),
      actionLabel: "Open tab",
    },
    width: BROWSER_CARD_WIDTH,
    height: BROWSER_CARD_HEIGHT,
  });
}

function isMonitorBrowserSession(session) {
  return isMonitorUrl(browserSessionUrl(session));
}

function resourceCardId(resource, index) {
  return normalizeId(
    pickFirst(resource.id, resource.resourceId, resource.browserSessionId, resource.url, resource.href),
    `monitor-${index + 1}`,
  );
}

function monitorCard(resource, index, machineId) {
  const url = normalizeUrl(pickFirst(resource.url, resource.href, resource.latestUrl));
  const monitor = classifyMonitorUrl(url);
  const sourceSessionId = normalizeText(pickFirst(resource.sourceSessionId, resource.callerSessionId, resource.sessionId));
  return makeCard({
    id: `monitor:${resourceCardId(resource, index)}`,
    type: "monitor",
    title: monitorTitle(monitor, resource.title || resource.name),
    subtitle: monitorSubtitle(monitor),
    status: pickFirst(resource.status, resource.phase, "linked"),
    detail: url,
    meta: normalizeOptionalDate(pickFirst(resource.updatedAt, resource.createdAt)),
    tags: [monitor?.kind, resource.source, sourceSessionId ? "from agent" : ""],
    href: url,
    ref: {
      machineId,
      resourceId: resourceCardId(resource, index),
      resourceKind: monitor?.kind || "monitor",
      source: normalizeText(resource.source),
      sourceSessionId,
      sourceCardId: sourceCardIdForSession(sourceSessionId),
      actionLabel: monitor?.kind === "wandb" ? "Open W&B" : "Open monitor",
    },
    width: MONITOR_CARD_WIDTH,
    height: MONITOR_CARD_HEIGHT,
  });
}

function collectMonitorResources({ sessions = [], browserSessions = [], resources = [] } = {}) {
  const entries = [];
  const seen = new Set();
  const add = (resource, fallback = {}) => {
    const url = normalizeUrl(pickFirst(resource?.url, resource?.href, resource?.latestUrl, fallback.url));
    if (!url || !isMonitorUrl(url) || seen.has(url)) {
      return;
    }
    seen.add(url);
    entries.push({ ...fallback, ...resource, url });
  };

  resources.forEach((resource, index) => add(resource, { id: `resource-${index + 1}`, source: "resource" }));
  sessions.forEach((session, sessionIndex) => {
    const sourceSessionId = sessionId(session, sessionIndex);
    asArray(session.resources).forEach((resource, resourceIndex) => add(resource, {
      id: `${sourceSessionId}:resource-${resourceIndex + 1}`,
      source: "agent",
      sourceSessionId,
      status: sessionStatus(session),
      createdAt: session.createdAt,
      updatedAt: pickFirst(session.updatedAt, session.lastOutputAt),
    }));
  });
  browserSessions.forEach((session, index) => {
    const url = browserSessionUrl(session);
    if (!isMonitorUrl(url)) {
      return;
    }
    add({
      id: pickFirst(session.id, session.browserUseSessionId, `browser-${index + 1}`),
      title: pickFirst(session.name, session.title),
      url,
      source: "browser",
      sourceSessionId: browserSourceSessionId(session),
      status: pickFirst(session.status, session.phase),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });
  return entries;
}

function buildMonitorCards(snapshot, machineId) {
  return collectMonitorResources(snapshot)
    .slice(0, MAX_CANVAS_MONITOR_CARDS)
    .map((resource, index) => monitorCard(resource, index, machineId));
}

function collectLinkedSessionIds(snapshot) {
  const ids = new Set();
  collectMonitorResources(snapshot).forEach((resource) => {
    const sourceSessionId = normalizeText(pickFirst(resource.sourceSessionId, resource.callerSessionId, resource.sessionId));
    if (sourceSessionId) ids.add(sourceSessionId);
  });
  asArray(snapshot.browserSessions).forEach((session) => {
    const sourceSessionId = browserSourceSessionId(session);
    if (sourceSessionId) ids.add(sourceSessionId);
  });
  return ids;
}

function browserSignalScore(session, index, { total = 0, redacted = false } = {}) {
  if (session?.canvasHidden === true || session?.hidden === true) {
    return -Infinity;
  }
  const status = pickFirst(session.status, session.phase);
  let score = 0;
  if (hasAnyStatus(status, ACTIVE_STATUSES)) score += 110;
  if (hasAnyStatus(status, PROBLEM_STATUSES)) score += 100;
  if (session?.latestSnapshot || session?.snapshot) score += 25;
  if (browserSourceSessionId(session)) score += 55;
  if (browserSessionUrl(session)) score += 35;
  if (!normalizeStatus(status) && total <= 1 && !redacted) score += 45;
  if (hasAnyStatus(status, QUIET_STATUSES)) score -= redacted ? 70 : 30;
  score += Math.min(20, Math.max(0, timestampMs(session?.updatedAt, session?.createdAt) / 1_000_000_000_000));
  score -= index * 0.01;
  return score;
}

function browserSummaryCard(sessions, machineId) {
  const items = compactSummaryItems(sessions, (entry) => ({
    title: normalizeText(pickFirst(entry.session.name, entry.session.title, entry.session.id), `Browser ${entry.index + 1}`),
    status: normalizeText(pickFirst(entry.session.status, entry.session.phase), "quiet"),
    meta: normalizeOptionalDate(pickFirst(entry.session.updatedAt, entry.session.createdAt)),
  }));
  return summaryCard({
    id: "browsers-archive",
    title: "Quiet browsers",
    subtitle: `${sessions.length} hidden`,
    detail: items.slice(0, 3).map((item) => item.title).join(" · "),
    meta: "Inactive browser windows are collapsed.",
    tags: ["browsers", "archive"],
    items,
    machineId,
    summaryKind: "browser",
  });
}

function buildBrowserCards(sessions, machineId, { redacted = false } = {}) {
  const entries = sessions
    .filter((session) => !isMonitorBrowserSession(session))
    .map((session, index) => ({
      session,
      index,
      score: browserSignalScore(session, index, { total: sessions.length, redacted }),
    }));
  const visible = entries
    .filter((entry) => entry.score >= 60)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_CANVAS_BROWSER_CARDS);
  if (!visible.length && entries.length && !redacted) {
    visible.push([...entries].sort((left, right) => right.score - left.score || left.index - right.index)[0]);
  }
  const visibleIndexes = new Set(visible.map((entry) => entry.index));
  const hidden = entries.filter((entry) => !visibleIndexes.has(entry.index));
  const cards = visible
    .sort((left, right) => left.index - right.index)
    .map((entry) => browserCard(entry.session, entry.index, machineId));
  if (hidden.length) {
    cards.push(browserSummaryCard(hidden, machineId));
  }
  return cards;
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

function isOpenActionItem(item) {
  if (item?.completedAt || item?.resolvedAt || item?.dismissedAt || item?.archivedAt) {
    return false;
  }
  if (item?.open === false || item?.active === false) {
    return false;
  }
  const status = pickFirst(item?.status, item?.state);
  if (!normalizeStatus(status)) {
    return true;
  }
  return !hasAnyStatus(status, QUIET_STATUSES);
}

function actionItemSummaryCard(items, machineId) {
  const summaryItems = compactSummaryItems(items, (entry) => ({
    title: normalizeText(pickFirst(entry.item.title, entry.item.name, entry.item.id), `Request ${entry.index + 1}`),
    status: normalizeText(pickFirst(entry.item.status, entry.item.state), "resolved"),
    meta: normalizeOptionalDate(pickFirst(entry.item.updatedAt, entry.item.completedAt, entry.item.createdAt)),
  }));
  return summaryCard({
    id: "requests-archive",
    title: "Resolved requests",
    subtitle: `${items.length} hidden`,
    detail: summaryItems.slice(0, 3).map((item) => item.title).join(" · "),
    meta: "Completed setup and approval cards are collapsed.",
    tags: ["requests", "archive"],
    items: summaryItems,
    machineId,
    summaryKind: "approval",
  });
}

function buildApprovalCards(items, machineId) {
  const open = [];
  const hidden = [];
  items.forEach((item, index) => {
    if (isOpenActionItem(item)) {
      open.push({ item, index });
    } else {
      hidden.push({ item, index });
    }
  });
  const cards = open.map((entry) => approvalCard(entry.item, entry.index, machineId));
  if (hidden.length) {
    cards.push(actionItemSummaryCard(hidden, machineId));
  }
  return cards;
}

function portCard(port, index, machineId) {
  const rawPort = getPortNumber(port);
  const portLabel = rawPort ? String(rawPort) : `port-${index + 1}`;
  const href = portHref(port);
  const name = portDisplayName(port, portLabel);
  const appId = normalizeText(pickFirst(port.appId, port.applicationId, port.desktopAppId));
  const previewTrusted = Boolean(
    port?.customName ||
      port?.canvasVisible === true ||
      port?.previewKind === "preview" ||
      hasIntentionalPortName(port),
  );
  return makeCard({
    id: `port:${portLabel}`,
    type: "app",
    title: name,
    subtitle: Number.isInteger(rawPort) ? `localhost:${rawPort}` : "local app",
    status: pickFirst(port.preferredAccess, port.status, port.protocol),
    detail: "Live app preview",
    meta: href,
    tags: [port.localOnly ? "local only" : "", port.exposedWithTailscale ? "tailscale" : "", port.customName ? "named" : "", appId],
    href,
    ref: {
      machineId,
      port: Number.isInteger(rawPort) ? rawPort : undefined,
      appId,
      launchCommandId: normalizeText(pickFirst(port.launchCommandId, port.commandId, port.sourceCommandId)),
      embedUrl: href,
      previewTrusted,
      actionLabel: "Open app",
    },
    width: APP_CARD_WIDTH,
    height: APP_CARD_HEIGHT,
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

  return visiblePorts.map((port, index) => portCard(port, index, machineId));
}

function appInstanceCard(instance, index, machineId) {
  const appId = normalizeText(pickFirst(instance.appId, instance.launcherId, instance.id), `app-${index + 1}`);
  const id = normalizeText(instance.id, appId);
  const href = normalizeUrl(pickFirst(instance.url, instance.href));
  const status = normalizeText(pickFirst(instance.status, "launched"));
  const appSurface = normalizeText(pickFirst(instance.surface, instance.canvasSurface, instance.appSurface));
  const isCanvasBrowser = appSurface === "browser" || (instance.kind === "canvas-app" && instance.category === "browser");
  return makeCard({
    id: `app-instance:${id}`,
    type: "app",
    title: pickFirst(instance.label, instance.title, appId),
    subtitle: isCanvasBrowser ? "canvas browser" : "app instance",
    status,
    detail: instance.launchCount && Number(instance.launchCount) > 1
      ? `Launched ${Number(instance.launchCount)} times from Swarmlab.`
      : "Launched from Swarmlab.",
    meta: normalizeOptionalDate(pickFirst(instance.updatedAt, instance.launchedAt)),
    tags: [appId, instance.category, appSurface || "instance", status],
    href,
    ref: {
      machineId,
      appInstance: true,
      appInstanceId: id,
      appId,
      launcherId: normalizeText(instance.launcherId || appId),
      appSurface,
      machineBound: true,
      launchCommandId: normalizeText(instance.clientCommandId || instance.commandId),
      embedUrl: href,
      previewTrusted: Boolean(href) || isCanvasBrowser,
      actionLabel: href ? "Open app" : "",
    },
    width: isCanvasBrowser ? CANVAS_BROWSER_CARD_WIDTH : APP_CARD_WIDTH,
    height: isCanvasBrowser ? CANVAS_BROWSER_CARD_HEIGHT : APP_CARD_HEIGHT,
  });
}

function buildAppInstanceCards(instances, machineId) {
  return instances
    .filter(isVisibleAppInstance)
    .sort((left, right) => timestampMs(right?.updatedAt, right?.launchedAt) - timestampMs(left?.updatedAt, left?.launchedAt))
    .slice(0, MAX_CANVAS_APP_INSTANCE_CARDS)
    .map((instance, index) => appInstanceCard(instance, index, machineId));
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

function artifactSummaryCard(canvases, machineId) {
  const items = compactSummaryItems(canvases, (entry) => ({
    title: normalizeText(pickFirst(entry.canvas.title, entry.canvas.name, entry.canvas.id), `Artifact ${entry.index + 1}`),
    status: normalizeText(pickFirst(entry.canvas.kind, entry.canvas.type, entry.canvas.status), "artifact"),
    meta: normalizeOptionalDate(pickFirst(entry.canvas.updatedAt, entry.canvas.createdAt)),
  }));
  return summaryCard({
    id: "artifacts-archive",
    title: "Artifact archive",
    subtitle: `${canvases.length} hidden`,
    detail: items.slice(0, 3).map((item) => item.title).join(" · "),
    meta: "Older canvas outputs are collapsed.",
    tags: ["artifacts", "archive"],
    items,
    machineId,
    summaryKind: "artifact",
  });
}

function buildArtifactCards(canvases, machineId) {
  const entries = canvases.map((canvas, index) => ({
    canvas,
    index,
    score: timestampMs(canvas?.updatedAt, canvas?.createdAt) + (canvas?.imagePath ? 1_000 : 0) - index,
  }));
  const visible = [...entries]
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_CANVAS_ARTIFACT_CARDS);
  const visibleIndexes = new Set(visible.map((entry) => entry.index));
  const hidden = entries.filter((entry) => !visibleIndexes.has(entry.index));
  const cards = visible
    .sort((left, right) => left.index - right.index)
    .map((entry) => artifactCard(entry.canvas, entry.index, machineId));
  if (hidden.length) {
    cards.push(artifactSummaryCard(hidden, machineId));
  }
  return cards;
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

function launcherCard(launcher, index, machineId) {
  const rawId = normalizeText(pickFirst(launcher.id, launcher.providerId, launcher.appId, launcher.label), `launcher-${index + 1}`);
  const launcherKind = normalizeText(launcher.kind || (launcher.providerId ? "agent-provider" : "app"));
  const providerId = normalizeText(launcher.providerId);
  const appId = normalizeText(launcher.appId || (launcherKind !== "agent-provider" ? rawId.replace(/^app:/u, "") : ""));
  const label = normalizeText(pickFirst(launcher.label, launcher.defaultName, providerId, appId, rawId), "Launcher");
  const isAgentProvider = launcherKind === "agent-provider" || Boolean(providerId);
  const isCanvasApp = launcherKind === "canvas-app" || Boolean(launcher.canvasSurface);
  const category = normalizeText(launcher.category || (isAgentProvider ? "agent" : "app"));
  const description = normalizeText(launcher.description);
  return makeCard({
    id: `launcher:${rawId}`,
    type: "launcher",
    title: label,
    subtitle: isAgentProvider ? "agent launcher" : (isCanvasApp ? "canvas app" : "desktop app"),
    status: launcher.available === false ? "unavailable" : "available",
    detail: description || (isAgentProvider
      ? `Start a new ${label} agent on this machine.`
      : isCanvasApp
        ? `Open ${label} inside this machine region.`
        : `Open ${label} on this machine.`),
    meta: launcher.platform || "",
    tags: [
      isAgentProvider ? "agent" : "app",
      providerId || appId,
      category,
    ],
    ref: {
      machineId,
      launcherId: rawId,
      launcherKind,
      providerId,
      appId,
      category,
      appSurface: normalizeText(launcher.canvasSurface || launcher.surface || ""),
      machineBound: !isAgentProvider,
      defaultName: normalizeText(launcher.defaultName || label, label),
      actionLabel: "Launch",
    },
    width: LAUNCHER_CARD_WIDTH,
    height: LAUNCHER_CARD_HEIGHT,
  });
}

function launcherSummaryCard(launchers, machineId) {
  const items = compactSummaryItems(launchers, (entry) => ({
    title: normalizeText(pickFirst(entry.launcher.label, entry.launcher.id), `Launcher ${entry.index + 1}`),
    status: normalizeText(entry.launcher.kind || "app"),
    meta: entry.launcher.available === false ? "unavailable" : "available",
  }));
  return summaryCard({
    id: "launchers-archive",
    title: "More launchers",
    subtitle: `${items.length} hidden`,
    detail: items.slice(0, 3).map((item) => item.title).join(" · "),
    meta: "Available apps and agent providers are collapsed.",
    tags: ["launchers"],
    items,
    machineId,
    summaryKind: "launcher",
  });
}

function buildLauncherCards(launchers, machineId, { limit = MAX_CANVAS_LAUNCHER_CARDS, includeSummary = true } = {}) {
  const entries = launchers
    .map((launcher, index) => ({ launcher, index }))
    .filter((entry) => entry.launcher?.available !== false)
    .sort((left, right) => normalizeNumber(right.launcher?.priority, 0) - normalizeNumber(left.launcher?.priority, 0) || left.index - right.index);
  const visible = Number.isFinite(limit) ? entries.slice(0, Math.max(0, limit)) : entries;
  const cards = visible.map((entry) => launcherCard(entry.launcher, entry.index, machineId));
  if (includeSummary && entries.length > visible.length) {
    cards.push(launcherSummaryCard(entries.slice(visible.length), machineId));
  }
  return cards;
}

export function buildCanvasLauncherCards(payload) {
  const snapshot = normalizeNodeSnapshot(payload);
  return buildLauncherCards(snapshot.launchers, snapshot.node.id, { limit: Infinity, includeSummary: false });
}

function machineCard(snapshot) {
  const node = snapshot.node;
  const system = snapshot.system || {};
  const cpu = system.cpu?.usagePercent ?? system.cpuPercent ?? system.cpuUsagePercent;
  const memory = system.memory?.usagePercent ?? system.memoryPercent ?? system.memoryUsagePercent;
  const roles = compactTags(snapshot.capabilities?.roles || []);
  const gpuCount = Number(snapshot.capabilities?.gpuCount || snapshot.system?.gpuCount || 0);
  const providerCount = Number(snapshot.capabilities?.providerCount || 0);
  const appCount = Number(snapshot.counts.ports || 0) + Number(snapshot.counts.appInstances || 0);
  return makeCard({
    id: `machine:${node.id}`,
    type: "machine",
    title: node.name,
    subtitle: compactTags([node.os, node.version]).join(" / "),
    status: node.status,
    detail: `${snapshot.counts.sessions} sessions, ${appCount} apps, ${snapshot.counts.handoffJobs} handoffs`,
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
  const isRedacted = snapshot.mode === "redacted";
  const linkedSessionIds = collectLinkedSessionIds(snapshot);
  const portCards = buildPortCards(snapshot.ports, machineId);
  const approvalCards = buildApprovalCards(snapshot.actionItems, machineId);
  const sessionCards = buildSessionCards(snapshot.sessions, machineId, { redacted: isRedacted, linkedSessionIds });
  const monitorCards = buildMonitorCards(snapshot, machineId);
  const browserCards = buildBrowserCards(snapshot.browserSessions, machineId, { redacted: isRedacted });
  const appInstanceCards = buildAppInstanceCards(snapshot.appInstances, machineId);
  const artifactCards = buildArtifactCards(snapshot.canvases, machineId);
  const cards = [
    machineCard(snapshot),
    brainCard(snapshot.brain, machineId),
    ...approvalCards,
    ...snapshot.handoffJobs.map((job, index) => handoffCard(job, index, machineId)),
    ...sessionCards,
    ...monitorCards,
    ...browserCards,
    ...portCards,
    ...appInstanceCards,
    ...artifactCards,
  ];
  return cards.filter(Boolean);
}

export function createFallbackCanvasLayout(cards) {
  const machineGroups = new Map();
  const machineOrder = [];
  cards.forEach((card, index) => {
    const machineId = getCanvasCardMachineId(card);
    if (!machineGroups.has(machineId)) {
      machineGroups.set(machineId, []);
      machineOrder.push(machineId);
    }
    machineGroups.get(machineId).push({ card, index });
  });

  const layout = {};
  const lanePriority = (card) => {
    if (card.type === "handoff") return 0;
    if (card.type === "approval") return 1;
    if (card.type === "brain") return 2;
    if (card.type === "artifact") return 3;
    if (card.type === "summary") return 4;
    return 5;
  };
  const applyRegionMeta = (ids, region) => {
    ids.forEach((id) => {
      if (!layout[id]) return;
      layout[id].regionId = region.id;
      layout[id].regionX = region.x;
      layout[id].regionY = region.y;
      layout[id].regionWidth = MACHINE_REGION_WIDTH;
      layout[id].regionHeight = region.height;
    });
  };
  const placeStack = (entries, x, y, laneWidth, region) => {
    let cursor = y;
    const ids = [];
    entries
      .sort((left, right) => lanePriority(left.card) - lanePriority(right.card) || left.index - right.index)
      .forEach(({ card, index }) => {
        const width = card.width || laneWidth;
        const height = card.height || DEFAULT_CARD_HEIGHT;
        layout[card.id] = {
          x,
          y: cursor,
          width,
          height,
          z: index + 1,
        };
        ids.push(card.id);
        cursor += height + MACHINE_REGION_ROW_GAP;
      });
    return { height: Math.max(0, cursor - y - MACHINE_REGION_ROW_GAP), ids };
  };
  const placeColumn = (entries, x, y, region) => {
    let cursor = y;
    const ids = [];
    entries
      .sort((left, right) => left.index - right.index)
      .forEach(({ card, index }) => {
        const width = card.width || DEFAULT_CARD_WIDTH;
        const height = card.height || DEFAULT_CARD_HEIGHT;
        layout[card.id] = {
          x,
          y: cursor,
          width,
          height,
          z: index + 1,
        };
        ids.push(card.id);
        cursor += height + (card.type === "agent" ? 46 : MACHINE_REGION_ROW_GAP);
      });
    return { height: Math.max(0, cursor - y - MACHINE_REGION_ROW_GAP), ids };
  };
  const placeMetadata = (entries, x, y) => {
    const ids = [];
    entries.forEach(({ card, index }) => {
      layout[card.id] = {
        x,
        y,
        width: 1,
        height: 1,
        z: index + 1,
        hidden: true,
      };
      ids.push(card.id);
    });
    return ids;
  };
  const isRightLane = (card) => ["agent", "monitor", "browser", "app"].includes(card.type);

  let column = 0;
  let rowY = MACHINE_REGION_MARGIN_Y;
  let rowHeight = 0;

  machineOrder.forEach((machineId) => {
    const entries = machineGroups.get(machineId) || [];
    const metadataOnly = [];
    const left = [];
    const right = [];
    entries.forEach((entry) => {
      if (isCanvasRegionMetadataCard(entry.card)) {
        metadataOnly.push(entry);
        return;
      }
      if (isRightLane(entry.card)) {
        right.push(entry);
      } else {
        left.push(entry);
      }
    });

    const region = {
      id: machineId,
      x: MACHINE_REGION_MARGIN_X + column * (MACHINE_REGION_WIDTH + MACHINE_REGION_GAP_X),
      y: rowY,
      height: MACHINE_REGION_MIN_HEIGHT,
    };
    const contentY = region.y + MACHINE_REGION_HEADER_HEIGHT;
    const leftX = region.x + MACHINE_REGION_PADDING_X;
    const rightX = leftX + MACHINE_REGION_LEFT_WIDTH + MACHINE_REGION_COLUMN_GAP;
    const metadataIds = placeMetadata(metadataOnly, leftX, region.y + 16);
    const leftResult = placeStack(left, leftX, contentY, MACHINE_REGION_LEFT_WIDTH, region);
    const rightResult = placeColumn(right, rightX, contentY + (left.length && right.length ? 22 : 0), region);
    region.height = Math.max(
      MACHINE_REGION_MIN_HEIGHT,
      MACHINE_REGION_HEADER_HEIGHT + MACHINE_REGION_BOTTOM_PADDING + leftResult.height,
      MACHINE_REGION_HEADER_HEIGHT + MACHINE_REGION_BOTTOM_PADDING + (left.length && right.length ? 22 : 0) + rightResult.height,
    );
    applyRegionMeta([...metadataIds, ...leftResult.ids, ...rightResult.ids], region);
    rowHeight = Math.max(rowHeight, region.height);
    column += 1;
    if (column >= MACHINE_REGION_COLUMNS) {
      rowY += rowHeight + MACHINE_REGION_GAP_Y;
      rowHeight = 0;
      column = 0;
    }
  });

  return layout;
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
        const regionId = normalizeText(item.regionId) ? normalizeId(item.regionId, "") : "";
        const regionX = normalizeNumber(item.regionX, NaN);
        const regionY = normalizeNumber(item.regionY, NaN);
        const regionWidth = normalizeNumber(item.regionWidth, NaN);
        const regionHeight = normalizeNumber(item.regionHeight, NaN);
        if (!id) {
          return null;
        }
        const sanitized = {
          x: Math.round(Math.max(-2_000, Math.min(20_000, x))),
          y: Math.round(Math.max(-2_000, Math.min(20_000, y))),
          width: Math.round(Math.max(180, Math.min(960, width))),
          height: Math.round(Math.max(120, Math.min(920, height))),
          z: Math.round(Math.max(0, Math.min(100_000, z))),
        };
        if (regionId) sanitized.regionId = regionId;
        if (Number.isFinite(regionX)) sanitized.regionX = Math.round(Math.max(-2_000, Math.min(20_000, regionX)));
        if (Number.isFinite(regionY)) sanitized.regionY = Math.round(Math.max(-2_000, Math.min(20_000, regionY)));
        if (Number.isFinite(regionWidth)) {
          sanitized.regionWidth = Math.round(Math.max(CANVAS_REGION_RESIZE_LIMITS.minWidth, Math.min(CANVAS_REGION_RESIZE_LIMITS.maxWidth, regionWidth)));
        }
        if (Number.isFinite(regionHeight)) {
          sanitized.regionHeight = Math.round(Math.max(CANVAS_REGION_RESIZE_LIMITS.minHeight, Math.min(CANVAS_REGION_RESIZE_LIMITS.maxHeight, regionHeight)));
        }
        return [id, sanitized];
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
    const homeRegionId = getCanvasCardMachineId(card);
    const overrideRegionX = Number.isFinite(override.regionX) ? override.regionX : null;
    const overrideRegionY = Number.isFinite(override.regionY) ? override.regionY : null;
    const overrideRegionWidth = Number.isFinite(override.regionWidth) ? override.regionWidth : null;
    const overrideRegionHeight = Number.isFinite(override.regionHeight) ? override.regionHeight : null;
    return [
      card.id,
      {
        ...base,
        ...override,
        regionId: override.regionId || base.regionId || homeRegionId,
        regionX: overrideRegionX ?? base.regionX,
        regionY: overrideRegionY ?? base.regionY,
        regionWidth: overrideRegionWidth ?? base.regionWidth,
        regionHeight: overrideRegionHeight ?? base.regionHeight,
        width: override.width || card.width || base.width,
        height: override.height || card.height || base.height,
        z: override.z || base.z,
      },
    ];
  }));
}
