import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FLEET_REGISTRY_VERSION = 2;
const FLEET_REGISTRY_FILENAME = "fleet-registry.json";
const FLEET_NODE_STATUSES = new Set(["online", "idle", "busy", "stale", "offline", "unreachable", "unknown"]);

function nowIso() {
  return new Date().toISOString();
}

function atomicPath(targetPath) {
  return `${targetPath}.${process.pid}.${Date.now()}.tmp`;
}

function buildHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function normalizeFleetNodeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/iu.test(raw);
  if (hasExplicitScheme && !/^https?:\/\//iu.test(raw)) {
    return "";
  }
  const withScheme = hasExplicitScheme ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/iu.test(url.protocol) || !url.hostname) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function fleetNodeIdForUrl(url) {
  return createHash("sha256").update(url).digest("base64url").slice(0, 18);
}

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return ["manual", "query", "import", "account", "snapshot", "heartbeat"].includes(source) ? source : "manual";
}

function normalizeTimestamp(value, fallback) {
  const timestamp = String(value || "").trim();
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : fallback;
}

function normalizeStatus(value, fallback = "") {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return fallback;
  return FLEET_NODE_STATUSES.has(status) ? status : fallback || "unknown";
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function compactStringArray(value, maxItems = 12, maxLength = 80) {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((entry) => String(entry || "").replace(/\s+/g, "-").trim().toLowerCase().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeConnectionHints(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const hints = [];
  for (const entry of source) {
    const url = normalizeFleetNodeUrl(entry?.url || entry?.baseUrl || entry?.href);
    if (!url) continue;
    const kind = String(entry?.kind || "manual").trim().toLowerCase();
    const normalizedKind = ["local", "lan", "tailscale", "public", "relay", "manual"].includes(kind) ? kind : "manual";
    const key = `${normalizedKind}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({
      kind: normalizedKind,
      url,
      label: normalizeLabel(entry?.label).slice(0, 80),
    });
  }
  return hints.slice(0, 20);
}

function firstConnectionHintUrl(value) {
  return normalizeConnectionHints(value)[0]?.url || "";
}

function cloneNode(node) {
  return {
    ...node,
    connectionHints: Array.isArray(node.connectionHints) ? node.connectionHints.map((hint) => ({ ...hint })) : [],
    counts: { ...(node.counts || {}) },
    capabilities: {
      ...(node.capabilities || {}),
      roles: Array.isArray(node.capabilities?.roles) ? [...node.capabilities.roles] : [],
    },
  };
}

function snapshotFromInput(value = {}) {
  const snapshot = value?.snapshot || value?.nodeSnapshot || value?.summary || value;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
}

function normalizeCounts(value = {}) {
  return {
    sessions: normalizeNumber(value.sessions),
    runningSessions: normalizeNumber(value.runningSessions),
    approvals: normalizeNumber(value.approvals ?? value.openActionItems),
    browserTasks: normalizeNumber(value.browserTasks ?? value.browserSessions),
    ports: normalizeNumber(value.ports),
    canvases: normalizeNumber(value.canvases ?? value.artifacts),
    projects: normalizeNumber(value.projects),
    handoffJobs: normalizeNumber(value.handoffJobs),
    brainNotes: normalizeNumber(value.brainNotes),
  };
}

function normalizeCapabilities(value = {}, system = {}) {
  const commandOperations = compactStringArray(value.commandOperations || value.command_operations).slice(0, 20);
  return {
    providerCount: normalizeNumber(value.providerCount),
    buildingCount: normalizeNumber(value.buildingCount),
    gpuCount: normalizeNumber(value.gpuCount ?? system.gpuCount),
    cameraCount: normalizeNumber(value.cameraCount ?? system.cameraCount),
    handoffCount: normalizeNumber(value.handoffCount),
    brainNoteCount: normalizeNumber(value.brainNoteCount),
    hasTailscale: Boolean(value.hasTailscale),
    commandOperations,
    roles: compactStringArray(value.roles),
  };
}

function buildFleetNodeSummary(input = {}) {
  const snapshot = snapshotFromInput(input);
  const node = snapshot.node && typeof snapshot.node === "object" ? snapshot.node : {};
  const system = snapshot.system && typeof snapshot.system === "object" ? snapshot.system : {};
  const counts = normalizeCounts(snapshot.counts || input.counts || {});
  const capabilities = normalizeCapabilities(snapshot.capabilities || input.capabilities || {}, system);
  const connectionHints = normalizeConnectionHints(
    input.connectionHints || snapshot.connectionHints || snapshot.urls || node.connectionHints || node.urls,
  );
  const runningSessions = counts.runningSessions;
  const inferredStatus = runningSessions > 0 ? "busy" : (counts.sessions > 0 ? "idle" : "");
  return {
    nodeId: normalizeLabel(input.nodeId || node.nodeId || node.id),
    installId: normalizeLabel(input.installId || node.installId),
    displayName: normalizeLabel(input.displayName || input.name || node.displayName || node.name),
    status: normalizeStatus(input.status || snapshot.status || node.status, inferredStatus),
    lastSeenAt: normalizeTimestamp(input.lastSeenAt || snapshot.generatedAt || node.lastSeenAt || node.updatedAt, ""),
    os: normalizeLabel(input.os || node.os || node.platform || system.platform).slice(0, 40),
    arch: normalizeLabel(input.arch || node.arch || system.arch).slice(0, 40),
    swarmlabVersion: normalizeLabel(input.swarmlabVersion || input.version || node.swarmlabVersion || node.version).slice(0, 80),
    commit: normalizeLabel(input.commit || node.commit).slice(0, 80),
    branch: normalizeLabel(input.branch || node.branch).slice(0, 80),
    hostnameHash: normalizeLabel(input.hostnameHash || node.hostnameHash).slice(0, 120),
    connectionHints,
    counts,
    capabilities,
    lastSnapshotAt: normalizeTimestamp(input.lastSnapshotAt || snapshot.generatedAt, ""),
  };
}

function normalizeFleetNodeRecord(value = {}, existing = null) {
  const summary = buildFleetNodeSummary(value);
  const hasSummaryInput = Boolean(
    value.snapshot ||
      value.nodeSnapshot ||
      value.summary ||
      value.counts ||
      value.capabilities ||
      value.connectionHints ||
      value.nodeId ||
      value.displayName ||
      value.status ||
      value.lastSeenAt,
  );
  const url = normalizeFleetNodeUrl(value.url || value.baseUrl || value.href || firstConnectionHintUrl(summary.connectionHints) || existing?.url);
  if (!url) {
    throw buildHttpError("A valid http(s) Swarmlab machine URL is required.", 400);
  }
  const timestamp = nowIso();
  const label = normalizeLabel(value.label || existing?.label || summary.displayName || value.name);
  const errorText = normalizeLabel(value.lastError || value.error || "");
  const connectionHints = normalizeConnectionHints([
    ...(summary.connectionHints || []),
    ...(Array.isArray(existing?.connectionHints) ? existing.connectionHints : []),
    { kind: "manual", url },
  ]);
  return {
    id: existing?.id || fleetNodeIdForUrl(url),
    url,
    baseUrl: url,
    label,
    source: normalizeSource(value.source || existing?.source),
    addedAt: normalizeTimestamp(existing?.addedAt || value.addedAt, timestamp),
    updatedAt: normalizeTimestamp(value.updatedAt, timestamp),
    nodeId: summary.nodeId || existing?.nodeId || "",
    installId: summary.installId || existing?.installId || "",
    displayName: summary.displayName || existing?.displayName || label || "",
    status: normalizeStatus(summary.status, existing?.status || "unknown"),
    lastSeenAt: normalizeTimestamp(summary.lastSeenAt || existing?.lastSeenAt, ""),
    os: summary.os || existing?.os || "",
    arch: summary.arch || existing?.arch || "",
    swarmlabVersion: summary.swarmlabVersion || existing?.swarmlabVersion || "",
    commit: summary.commit || existing?.commit || "",
    branch: summary.branch || existing?.branch || "",
    hostnameHash: summary.hostnameHash || existing?.hostnameHash || "",
    connectionHints,
    counts: hasSummaryInput
      ? {
          ...normalizeCounts(existing?.counts || {}),
          ...summary.counts,
        }
      : normalizeCounts(existing?.counts || {}),
    capabilities: hasSummaryInput
      ? {
          ...normalizeCapabilities(existing?.capabilities || {}),
          ...summary.capabilities,
          roles: summary.capabilities.roles.length
            ? summary.capabilities.roles
            : compactStringArray(existing?.capabilities?.roles),
        }
      : normalizeCapabilities(existing?.capabilities || {}),
    lastSnapshotAt: normalizeTimestamp(summary.lastSnapshotAt || existing?.lastSnapshotAt, ""),
    lastError: errorText || (hasSummaryInput ? "" : existing?.lastError || ""),
    lastErrorAt: errorText ? timestamp : (hasSummaryInput ? "" : normalizeTimestamp(existing?.lastErrorAt, "")),
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = atomicPath(filePath);
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

export class FleetRegistryStore {
  constructor({ stateDir } = {}) {
    if (!stateDir) {
      throw new Error("stateDir is required for FleetRegistryStore.");
    }
    this.registryPath = path.join(stateDir, FLEET_REGISTRY_FILENAME);
    this.nodes = new Map();
  }

  async initialize() {
    let parsed = {};
    try {
      parsed = await readJsonFile(this.registryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[swarmlab] could not read fleet registry; starting empty", error?.message || error);
      }
    }

    const rawNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    this.nodes = new Map();
    for (const rawNode of rawNodes) {
      try {
        const node = normalizeFleetNodeRecord(rawNode);
        this.nodes.set(node.url, node);
      } catch {
        // Drop corrupt or unsupported legacy rows rather than blocking startup.
      }
    }
    await this.save();
    return this.listNodes();
  }

  async save() {
    await writeJsonFile(this.registryPath, {
      version: FLEET_REGISTRY_VERSION,
      nodes: this.listNodes(),
      updatedAt: nowIso(),
    });
  }

  listNodes() {
    return [...this.nodes.values()]
      .map((node) => cloneNode(node))
      .sort((left, right) => String(left.addedAt).localeCompare(String(right.addedAt)));
  }

  async addNode(input = {}) {
    const summary = buildFleetNodeSummary(input);
    const url = normalizeFleetNodeUrl(input.url || input.baseUrl || input.href || firstConnectionHintUrl(summary.connectionHints));
    if (!url) {
      throw buildHttpError("A valid http(s) Swarmlab machine URL is required.", 400);
    }
    const node = normalizeFleetNodeRecord({ ...input, url }, this.nodes.get(url));
    this.nodes.set(url, node);
    await this.save();
    return cloneNode(node);
  }

  async removeNode(idOrUrl) {
    const key = String(idOrUrl || "").trim();
    if (!key) return false;
    const normalizedUrl = normalizeFleetNodeUrl(key);
    if (normalizedUrl && this.nodes.delete(normalizedUrl)) {
      await this.save();
      return true;
    }
    for (const [url, node] of this.nodes.entries()) {
      if (node.id === key) {
        this.nodes.delete(url);
        await this.save();
        return true;
      }
    }
    return false;
  }
}
