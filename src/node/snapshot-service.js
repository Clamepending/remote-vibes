import { createHash } from "node:crypto";
import os from "node:os";

const DEFAULT_DEPENDENCY_TIMEOUT_MS = 1_500;
const REDACTED_NAME = "redacted";
const SNAPSHOT_MODES = new Set(["redacted", "privileged"]);
const SECRET_TEXT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{6,}\b/g,
  /\b(?:api[_-]?key|token|secret|password|authorization|bearer|ANTHROPIC_API_KEY|OPENAI_API_KEY|HF_TOKEN)=?[A-Za-z0-9_./:=@+-]{4,}\b/gi,
  /([?&](?:token|api_key|key|secret|password|auth|code)=)[^&#\s]+/gi,
];

function nowIso() {
  return new Date().toISOString();
}

function stableHash(value) {
  const text = String(value || "");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function compactText(value, max = 160) {
  const text = scrubSensitiveText(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

function scrubSensitiveText(value) {
  let text = String(value || "");
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, (match, prefix = "") => (
      typeof prefix === "string" && prefix.startsWith("?")
        ? `${prefix}[redacted]`
        : "[redacted]"
    ));
  }
  return text;
}

function originOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function countByStatus(entries = []) {
  return entries.reduce((counts, entry) => {
    const status = String(entry?.status || "unknown").trim() || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

async function withTimeout(label, producer, fallback, timeoutMs) {
  let timeoutHandle;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({ ok: false, label, timedOut: true, value: fallback });
    }, timeoutMs);
  });

  const operation = Promise.resolve()
    .then(producer)
    .then((value) => ({ ok: true, label, value }))
    .catch((error) => ({
      ok: false,
      label,
      error: error?.message || String(error),
      value: fallback,
    }))
    .finally(() => clearTimeout(timeoutHandle));

  return Promise.race([operation, timeout]);
}

function summarizeSession(session, mode) {
  const base = {
    id: String(session?.id || ""),
    status: String(session?.status || "unknown"),
    providerId: String(session?.providerId || ""),
    providerLabel: String(session?.providerLabel || ""),
    activityStatus: String(session?.activityStatus || ""),
    createdAt: session?.createdAt || null,
    updatedAt: session?.updatedAt || null,
  };

  if (mode === "redacted") {
    return {
      ...base,
      name: REDACTED_NAME,
      cwd: null,
      hasSubagents: Array.isArray(session?.subagents) && session.subagents.length > 0,
    };
  }

  return {
    ...base,
    name: compactText(session?.name || session?.providerLabel || "Session", 120),
    cwd: session?.cwd || "",
    workspaceId: session?.workspaceId || "",
    projectPath: session?.projectPath || "",
    lastPromptAt: session?.lastPromptAt || null,
    lastOutputAt: session?.lastOutputAt || null,
    subagents: arrayOrEmpty(session?.subagents).slice(0, 12).map((subagent) => ({
      id: String(subagent?.id || ""),
      name: compactText(subagent?.name || "Subagent", 100),
      status: String(subagent?.status || ""),
      source: String(subagent?.source || ""),
      updatedAt: subagent?.updatedAt || null,
    })),
  };
}

function summarizeBrowserSession(session, mode) {
  const base = {
    id: String(session?.id || ""),
    status: String(session?.status || "unknown"),
    createdAt: session?.createdAt || null,
    updatedAt: session?.updatedAt || null,
  };

  if (mode === "redacted") {
    return {
      ...base,
      name: REDACTED_NAME,
      latestUrl: "",
      callerSessionId: session?.callerSessionId || "",
    };
  }

  return {
    ...base,
    name: compactText(session?.name || "Browser task", 120),
    hasTaskPrompt: Boolean(String(session?.taskPrompt || "").trim()),
    latestOrigin: originOnly(session?.latestUrl || session?.url),
    callerSessionId: session?.callerSessionId || "",
    headless: Boolean(session?.headless),
    keepTabs: Boolean(session?.keepTabs),
  };
}

function summarizeActionItem(item, mode) {
  const base = {
    id: String(item?.id || ""),
    kind: String(item?.kind || item?.type || "action"),
    priority: String(item?.priority || "normal"),
    status: String(item?.status || "open"),
    sourceSessionId: item?.sourceSessionId || "",
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || null,
  };

  if (mode === "redacted") {
    return {
      ...base,
      title: REDACTED_NAME,
      detail: "",
      choiceCount: arrayOrEmpty(item?.choices).length,
      capabilityIds: arrayOrEmpty(item?.capabilityIds).map(String).slice(0, 20),
    };
  }

  return {
    ...base,
    title: compactText(item?.title || "Action required", 140),
    detailPreview: compactText(item?.detail || item?.description || "", 260),
    target: item?.target || null,
    choices: arrayOrEmpty(item?.choices).slice(0, 12),
    capabilityIds: arrayOrEmpty(item?.capabilityIds).map(String).slice(0, 20),
  };
}

function summarizeCanvas(canvas, mode) {
  const base = {
    id: String(canvas?.id || ""),
    sourceSessionId: canvas?.sourceSessionId || "",
    createdAt: canvas?.createdAt || null,
    updatedAt: canvas?.updatedAt || null,
  };

  if (mode === "redacted") {
    return {
      ...base,
      title: REDACTED_NAME,
      imageUrl: "",
      artifactKind: String(canvas?.kind || canvas?.artifactKind || "artifact"),
    };
  }

  return {
    ...base,
    title: compactText(canvas?.title || "Artifact", 140),
    caption: compactText(canvas?.caption || "", 220),
    hasImage: Boolean(canvas?.imageUrl || canvas?.imagePath),
    origin: originOnly(canvas?.url || canvas?.imageUrl),
    artifactKind: String(canvas?.kind || canvas?.artifactKind || "artifact"),
  };
}

function summarizePort(port, mode) {
  const base = {
    id: `port:${String(port?.port || "")}`,
    status: port?.previewStatus || port?.status || "",
    localOnly: Boolean(port?.localOnly),
    canExposeWithTailscale: Boolean(port?.canExposeWithTailscale),
    exposedWithTailscale: Boolean(port?.exposedWithTailscale),
    preferredAccess: port?.preferredAccess || "",
  };

  if (mode === "redacted") {
    return base;
  }

  return {
    ...base,
    port: port?.port || null,
    name: compactText(port?.name || String(port?.port || "Port"), 80),
    customName: Boolean(port?.customName),
    command: compactText(port?.command || "", 80),
    hosts: arrayOrEmpty(port?.hosts).slice(0, 20),
    hasDirectUrl: Boolean(port?.directUrl),
    proxyPath: port?.proxyPath || "",
    hasTailscaleUrl: Boolean(port?.tailscaleUrl),
  };
}

function summarizeProject(project, mode) {
  if (mode === "redacted") {
    return {
      id: stableHash(project?.path || project?.name || project?.id || ""),
      name: REDACTED_NAME,
      status: project?.status || "",
    };
  }

  return {
    id: String(project?.id || stableHash(project?.path || project?.name || "")),
    name: compactText(project?.name || project?.id || "Project", 140),
    path: project?.path || "",
    status: project?.status || "",
  };
}

function summarizeBuilding(building, mode) {
  const id = String(building?.id || building?.buildingId || building?.name || "");
  if (mode === "redacted") {
    return { id: stableHash(id), installed: Boolean(building?.installed) };
  }
  return {
    id,
    name: compactText(building?.name || id, 120),
    installed: Boolean(building?.installed),
    category: String(building?.category || ""),
  };
}

function summarizeSystem(system, mode) {
  const gpus = arrayOrEmpty(system?.gpus);
  const cameras = arrayOrEmpty(system?.cameras);
  const base = {
    platform: os.platform(),
    arch: os.arch(),
    cpuCount: os.cpus()?.length || null,
    gpuCount: gpus.length,
    cameraCount: cameras.length,
    memory: system?.memory
      ? {
          total: system.memory.total ?? null,
          free: system.memory.free ?? null,
          used: system.memory.used ?? null,
        }
      : null,
  };

  if (mode === "redacted") {
    return base;
  }

  return {
    ...base,
    hostname: os.hostname(),
    uptimeSec: Math.round(os.uptime()),
    gpus: gpus.slice(0, 16).map((gpu) => ({
      index: gpu?.index,
      name: compactText(gpu?.name || "", 100),
      usedByOtherUser: Boolean(gpu?.usedByOtherUser),
    })),
  };
}

export class NodeSnapshotService {
  constructor({
    nodeIdentityStore,
    metadataProvider,
    providersProvider,
    sessionsProvider,
    browserSessionsProvider,
    agentTownStateProvider,
    portsProvider,
    systemProvider,
    buildingsProvider,
    projectsProvider,
    timeoutMs = DEFAULT_DEPENDENCY_TIMEOUT_MS,
  } = {}) {
    this.nodeIdentityStore = nodeIdentityStore;
    this.metadataProvider = metadataProvider || (() => ({}));
    this.providersProvider = providersProvider || (() => []);
    this.sessionsProvider = sessionsProvider || (() => []);
    this.browserSessionsProvider = browserSessionsProvider || (() => []);
    this.agentTownStateProvider = agentTownStateProvider || (() => ({}));
    this.portsProvider = portsProvider || (() => []);
    this.systemProvider = systemProvider || (() => ({}));
    this.buildingsProvider = buildingsProvider || (() => []);
    this.projectsProvider = projectsProvider || (() => []);
    this.timeoutMs = timeoutMs;
  }

  normalizeMode(mode) {
    const normalized = String(mode || "redacted").trim().toLowerCase();
    return SNAPSHOT_MODES.has(normalized) ? normalized : "redacted";
  }

  async getManifest({ privileged = false } = {}) {
    const metadata = await this.metadataProvider();
    const identity = this.nodeIdentityStore.getPublicIdentity({ includeHostname: privileged });
    return {
      schemaVersion: 1,
      nodeId: identity.nodeId,
      installId: identity.installId,
      displayName: privileged ? (identity.hostname || "This machine") : "Swarmlab node",
      swarmlabVersion: metadata.version || "",
      commit: metadata.commit || "",
      branch: metadata.branch || "",
      os: os.platform(),
      arch: os.arch(),
      hostnameHash: stableHash(os.hostname()),
      ...(privileged ? { hostname: os.hostname() } : {}),
      publicKey: identity.publicKey,
      api: {
        manifest: 1,
        status: 1,
        snapshot: 1,
        events: 1,
        canvas: 1,
        actions: 1,
      },
      generatedAt: nowIso(),
    };
  }

  async getStatus() {
    const [sessionsResult, agentTownResult, browserResult, portsResult] = await Promise.all([
      withTimeout("sessions", this.sessionsProvider, [], this.timeoutMs),
      withTimeout("agentTown", this.agentTownStateProvider, {}, this.timeoutMs),
      withTimeout("browserSessions", this.browserSessionsProvider, [], this.timeoutMs),
      withTimeout("ports", this.portsProvider, [], this.timeoutMs),
    ]);
    const sessions = arrayOrEmpty(sessionsResult.value);
    const actionItems = arrayOrEmpty(agentTownResult.value?.actionItems);
    const browserSessions = arrayOrEmpty(browserResult.value);
    const ports = arrayOrEmpty(portsResult.value);

    return {
      schemaVersion: 1,
      nodeId: this.nodeIdentityStore.getRecord().nodeId,
      status: sessions.some((session) => session?.status === "running") ? "busy" : "idle",
      generatedAt: nowIso(),
      counts: {
        sessions: sessions.length,
        runningSessions: sessions.filter((session) => session?.status === "running").length,
        approvals: actionItems.filter((item) => item?.status === "open").length,
        browserTasks: browserSessions.length,
        ports: ports.length,
      },
      degraded: [sessionsResult, agentTownResult, browserResult, portsResult]
        .filter((result) => !result.ok)
        .map((result) => ({ source: result.label, timedOut: Boolean(result.timedOut), error: "unavailable" })),
    };
  }

  async getSnapshot({ mode = "redacted" } = {}) {
    const normalizedMode = this.normalizeMode(mode);
    const [
      manifest,
      sessionsResult,
      browserResult,
      agentTownResult,
      portsResult,
      systemResult,
      buildingsResult,
      projectsResult,
      providersResult,
    ] = await Promise.all([
      this.getManifest({ privileged: normalizedMode === "privileged" }),
      withTimeout("sessions", this.sessionsProvider, [], this.timeoutMs),
      withTimeout("browserSessions", this.browserSessionsProvider, [], this.timeoutMs),
      withTimeout("agentTown", this.agentTownStateProvider, {}, this.timeoutMs),
      withTimeout("ports", this.portsProvider, [], this.timeoutMs),
      withTimeout("system", this.systemProvider, {}, this.timeoutMs),
      withTimeout("buildings", this.buildingsProvider, [], this.timeoutMs),
      withTimeout("projects", this.projectsProvider, [], this.timeoutMs),
      withTimeout("providers", this.providersProvider, [], this.timeoutMs),
    ]);

    const sessions = arrayOrEmpty(sessionsResult.value);
    const browserSessions = arrayOrEmpty(browserResult.value);
    const agentTown = agentTownResult.value || {};
    const actionItems = arrayOrEmpty(agentTown.actionItems);
    const canvases = arrayOrEmpty(agentTown.canvases);
    const ports = arrayOrEmpty(portsResult.value);
    const buildings = arrayOrEmpty(buildingsResult.value);
    const projects = arrayOrEmpty(projectsResult.value);
    const providers = arrayOrEmpty(providersResult.value);
    const degraded = [
      sessionsResult,
      browserResult,
      agentTownResult,
      portsResult,
      systemResult,
      buildingsResult,
      projectsResult,
      providersResult,
    ]
      .filter((result) => !result.ok)
      .map((result) => ({
        source: result.label,
        timedOut: Boolean(result.timedOut),
        error: normalizedMode === "privileged" ? compactText(result.error || "unavailable", 160) : "unavailable",
      }));

    return {
      schemaVersion: 1,
      mode: normalizedMode,
      node: manifest,
      capabilities: {
        providerCount: providers.length,
        providers: normalizedMode === "privileged"
          ? providers.map((provider) => ({
              id: provider?.id || "",
              label: compactText(provider?.label || provider?.id || "", 80),
              available: Boolean(provider?.available),
            }))
          : [],
        buildingCount: buildings.length,
        gpuCount: arrayOrEmpty(systemResult.value?.gpus).length,
        cameraCount: arrayOrEmpty(systemResult.value?.cameras).length,
        hasTailscale: ports.some((port) => Boolean(port?.tailscaleUrl)),
      },
      counts: {
        sessions: sessions.length,
        sessionStatuses: countByStatus(sessions),
        runningSessions: sessions.filter((session) => session?.status === "running").length,
        browserSessions: browserSessions.length,
        actionItems: actionItems.length,
        openActionItems: actionItems.filter((item) => item?.status === "open").length,
        canvases: canvases.length,
        ports: ports.length,
        projects: projects.length,
        buildings: buildings.length,
      },
      sessions: sessions.slice(0, 100).map((session) => summarizeSession(session, normalizedMode)),
      browserSessions: browserSessions.slice(0, 100).map((session) => summarizeBrowserSession(session, normalizedMode)),
      actionItems: actionItems.slice(0, 100).map((item) => summarizeActionItem(item, normalizedMode)),
      canvases: canvases.slice(0, 100).map((canvas) => summarizeCanvas(canvas, normalizedMode)),
      ports: normalizedMode === "redacted" ? [] : ports.slice(0, 120).map((port) => summarizePort(port, normalizedMode)),
      portHints: normalizedMode === "redacted"
        ? {
            count: ports.length,
            previewableCount: ports.filter((port) => port?.previewKind === "preview" || port?.preferredAccess).length,
            tailscaleEligibleCount: ports.filter((port) => port?.canExposeWithTailscale).length,
          }
        : null,
      projects: projects.slice(0, 80).map((project) => summarizeProject(project, normalizedMode)),
      system: summarizeSystem(systemResult.value, normalizedMode),
      buildings: buildings.slice(0, 120).map((building) => summarizeBuilding(building, normalizedMode)),
      generatedAt: nowIso(),
      degraded,
    };
  }
}
