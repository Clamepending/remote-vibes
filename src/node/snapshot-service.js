import { createHash } from "node:crypto";
import os from "node:os";

const DEFAULT_DEPENDENCY_TIMEOUT_MS = 1_500;
const REDACTED_NAME = "redacted";
const SNAPSHOT_MODES = new Set(["redacted", "privileged"]);
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
const MONITOR_URL_HOSTS = [
  { kind: "wandb", label: "Weights & Biases", hostPattern: /(^|\.)wandb\.ai$/u },
  { kind: "tensorboard", label: "TensorBoard", hostPattern: /(^|\.)tensorboard\.dev$/u },
  { kind: "mlflow", label: "MLflow", hostPattern: /(^|\.)mlflow\./u },
  { kind: "comet", label: "Comet", hostPattern: /(^|\.)comet\.com$/u },
];
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

function sanitizeUrlForSnapshot(value) {
  const raw = String(value || "")
    .trim()
    .replace(/[),.;]+$/u, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
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
  const urlText = sanitizeUrlForSnapshot(value);
  if (!urlText) return null;
  try {
    const url = new URL(urlText);
    const hostname = url.hostname.toLowerCase();
    const match = MONITOR_URL_HOSTS.find((candidate) => candidate.hostPattern.test(hostname));
    return match ? { ...match, url: urlText, host: hostname } : null;
  } catch {
    return null;
  }
}

function summarizeSessionResource(resource, index, session) {
  const rawUrl = typeof resource === "string" ? resource : resource?.url || resource?.href;
  const monitor = classifyMonitorUrl(rawUrl);
  if (!monitor) return null;
  return {
    id: String(resource?.id || `${monitor.kind}:${stableHash(monitor.url)}:${index}`),
    kind: String(resource?.kind || monitor.kind),
    label: compactText(resource?.label || monitor.label, 80),
    title: compactText(resource?.title || resource?.name || resource?.label || monitor.label, 120),
    url: monitor.url,
    host: monitor.host,
    source: compactText(resource?.source || "session", 80),
    sourceSessionId: String(resource?.sourceSessionId || session?.id || ""),
    createdAt: resource?.createdAt || session?.createdAt || null,
    updatedAt: resource?.updatedAt || session?.updatedAt || null,
  };
}

function summarizeSessionResources(session) {
  const rawResources = [
    ...arrayOrEmpty(session?.resources),
    ...arrayOrEmpty(session?.resourceUrls),
    ...arrayOrEmpty(session?.monitorUrls),
    session?.monitorUrl,
    session?.wandbUrl,
  ].filter(Boolean);
  const seen = new Set();
  return rawResources
    .map((resource, index) => summarizeSessionResource(resource, index, session))
    .filter((resource) => {
      if (!resource || seen.has(resource.url)) return false;
      seen.add(resource.url);
      return true;
    })
    .slice(0, 8);
}

function summarizeSessionShellActivity(session, mode) {
  const activity = session?.shellActivity && typeof session.shellActivity === "object" ? session.shellActivity : null;
  const count = Number(activity?.count || 0);
  if (!activity || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  const base = { count };
  if (mode === "redacted") {
    return base;
  }
  return {
    ...base,
    lastLabel: compactText(activity.lastLabel || "Shell", 80),
    lastStatus: compactText(activity.lastStatus || "", 40),
    updatedAt: activity.updatedAt || null,
  };
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
      shellActivity: summarizeSessionShellActivity(session, mode),
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
    shellActivity: summarizeSessionShellActivity(session, mode),
    resources: summarizeSessionResources(session),
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
    taskPreview: compactText(session?.taskPrompt || "", 220),
    hasTaskPrompt: Boolean(String(session?.taskPrompt || "").trim()),
    latestUrl: sanitizeUrlForSnapshot(session?.latestUrl || session?.url),
    url: sanitizeUrlForSnapshot(session?.url || session?.latestUrl),
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

function summarizeHandoffJob(job, mode) {
  const base = {
    id: String(job?.id || ""),
    kind: String(job?.kind || "agent-handoff"),
    status: String(job?.status || "planned"),
    sourceNodeId: String(job?.sourceNodeId || ""),
    target: {
      nodeId: String(job?.target?.nodeId || ""),
      url: mode === "privileged" ? String(job?.target?.url || job?.target?.baseUrl || "") : "",
    },
    stepCounts: countByStatus(arrayOrEmpty(job?.steps).map((step) => ({ status: step?.status || "pending" }))),
    createdAt: job?.createdAt || null,
    updatedAt: job?.updatedAt || null,
  };

  if (mode === "redacted") {
    return {
      ...base,
      title: REDACTED_NAME,
      objectivePreview: "",
      target: {
        ...base.target,
        label: REDACTED_NAME,
        sshTarget: "",
      },
      commandCount: arrayOrEmpty(job?.commands).length,
      artifactCount: arrayOrEmpty(job?.artifactPaths).length,
      steps: arrayOrEmpty(job?.steps).slice(0, 8).map((step) => ({
        id: String(step?.id || ""),
        title: REDACTED_NAME,
        status: String(step?.status || "pending"),
      })),
    };
  }

  return {
    ...base,
    title: compactText(job?.title || "Machine handoff", 140),
    objectivePreview: compactText(job?.objective || "", 360),
    target: {
      ...base.target,
      label: compactText(job?.target?.label || job?.target?.sshTarget || job?.target?.url || "Target machine", 140),
      sshTarget: compactText(job?.target?.sshTarget || "", 160),
    },
    providerId: String(job?.providerId || ""),
    workspacePath: job?.workspacePath || "",
    artifactPaths: arrayOrEmpty(job?.artifactPaths).map((entry) => compactText(entry, 500)).slice(0, 20),
    commands: arrayOrEmpty(job?.commands).map((entry) => compactText(entry, 1_500)).slice(0, 12),
    launchedSessionId: String(job?.launchedSessionId || ""),
    steps: arrayOrEmpty(job?.steps).slice(0, 12).map((step) => ({
      id: String(step?.id || ""),
      title: compactText(step?.title || "Step", 120),
      status: String(step?.status || "pending"),
      command: compactText(step?.command || "", 1_500),
      artifactPath: compactText(step?.artifactPath || "", 500),
      note: compactText(step?.note || "", 1_000),
    })),
  };
}

function summarizeBrain(brain, mode) {
  const notes = arrayOrEmpty(brain?.notes);
  const edges = arrayOrEmpty(brain?.edges);
  const base = {
    relativeRoot: String(brain?.relativeRoot || ""),
    noteCount: Number(brain?.noteCount ?? notes.length) || 0,
    edgeCount: Number(brain?.edgeCount ?? edges.length) || 0,
    skippedEntries: Number(brain?.skippedEntries || 0) || 0,
  };

  if (mode === "redacted") {
    return {
      ...base,
      rootPath: "",
      notes: notes.slice(0, 8).map((note) => ({
        relativePath: "",
        title: REDACTED_NAME,
        hasHeadlineImage: Boolean(note?.headlineImageUrl),
        linkCount: arrayOrEmpty(note?.links).length,
      })),
    };
  }

  return {
    ...base,
    rootPath: brain?.rootPath || "",
    notes: notes.slice(0, 12).map((note) => ({
      relativePath: String(note?.relativePath || ""),
      title: compactText(note?.title || note?.relativePath || "Note", 140),
      excerpt: compactText(note?.excerpt || "", 220),
      takeaway: compactText(note?.takeaway || "", 280),
      headlineImageUrl: String(note?.headlineImageUrl || ""),
      headlineImageAlt: compactText(note?.headlineImageAlt || "", 120),
      linkCount: arrayOrEmpty(note?.links).length,
    })),
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

function summarizeProviderLauncher(provider = {}) {
  if (!provider?.available) return null;
  const id = compactText(provider.id, 80);
  if (!id) return null;
  const isShell = id === "shell";
  const label = isShell ? "Terminal" : compactText(provider.label || provider.defaultName || id, 80);
  return {
    id: `provider:${id}`,
    label,
    kind: "agent-provider",
    category: isShell ? "terminal" : "agent",
    priority: isShell ? 96 : 100,
    description: isShell
      ? "Open a persistent terminal inside the canvas on this machine."
      : `Start a new ${label} agent on this machine.`,
    providerId: id,
    defaultName: isShell ? "Terminal" : compactText(provider.defaultName || provider.label || id, 80),
    available: true,
  };
}

function summarizeAppLauncher(launcher = {}) {
  if (!launcher?.available) return null;
  const id = compactText(launcher.id, 80);
  if (!id) return null;
  return {
    id: `app:${id}`,
    label: compactText(launcher.label || id, 80),
    kind: compactText(launcher.kind || "desktop-app", 40),
    category: compactText(launcher.category || "app", 40),
    priority: Number.isFinite(Number(launcher.priority)) ? Math.round(Number(launcher.priority)) : 0,
    description: compactText(launcher.description || "", 160),
    appId: id,
    available: true,
    platform: compactText(launcher.platform, 40),
  };
}

function suppressDesktopLauncherForCanvasProvider(launcher, providerIds = new Set()) {
  if (!launcher || !providerIds?.size) return false;
  const appId = compactText(launcher.appId || launcher.id || "", 80).toLowerCase();
  const category = compactText(launcher.category || "", 40).toLowerCase();
  if (!appId) return false;
  if (category === "agent-app") {
    if (providerIds.has(appId)) return true;
    if (appId === "claude" && providerIds.has("claude-ollama")) return true;
  }
  if (providerIds.has("shell") && (category === "terminal" || appId === "terminal" || appId === "iterm")) {
    return true;
  }
  return false;
}

function summarizeAppInstance(instance = {}, mode) {
  const appId = compactText(instance.appId || instance.launcherId || instance.id, 80);
  if (!appId) return null;
  const base = {
    id: compactText(instance.id || `app:${appId}`, 80),
    appId,
    launcherId: compactText(instance.launcherId || appId, 80),
    label: compactText(instance.label || appId, 100),
    kind: compactText(instance.kind || "desktop-app", 40),
    category: compactText(instance.category || "app", 40),
    status: compactText(instance.status || "launched", 40),
    source: compactText(instance.source || "local", 40),
    launchCount: Number.isFinite(Number(instance.launchCount)) ? Math.max(1, Math.round(Number(instance.launchCount))) : 1,
    launchedAt: instance.launchedAt || null,
    updatedAt: instance.updatedAt || null,
  };

  if (mode === "redacted") {
    return base;
  }

  return {
    ...base,
    clientCommandId: compactText(instance.clientCommandId || "", 160),
    url: sanitizeUrlForSnapshot(instance.url || instance.href),
    origin: originOnly(instance.url || instance.href),
  };
}

function buildLaunchers(providers = [], appLaunchers = []) {
  const seen = new Set();
  const providerLaunchers = arrayOrEmpty(providers).map(summarizeProviderLauncher).filter(Boolean);
  const canvasProviderIds = new Set(providerLaunchers.map((launcher) => launcher.providerId).filter(Boolean));
  const desktopLaunchers = arrayOrEmpty(appLaunchers)
    .map(summarizeAppLauncher)
    .filter((launcher) => launcher && !suppressDesktopLauncherForCanvasProvider(launcher, canvasProviderIds));
  return [
    ...providerLaunchers,
    ...desktopLaunchers,
  ]
    .filter((launcher) => {
      const key = launcher?.id || "";
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (right.priority || 0) - (left.priority || 0) || String(left.label || "").localeCompare(String(right.label || "")))
    .slice(0, 24);
}

export class NodeSnapshotService {
  constructor({
    nodeIdentityStore,
    metadataProvider,
    providersProvider,
    appLaunchersProvider,
    appInstancesProvider,
    sessionsProvider,
    browserSessionsProvider,
    agentTownStateProvider,
    portsProvider,
    systemProvider,
    buildingsProvider,
    projectsProvider,
    handoffJobsProvider,
    brainProvider,
    timeoutMs = DEFAULT_DEPENDENCY_TIMEOUT_MS,
  } = {}) {
    this.nodeIdentityStore = nodeIdentityStore;
    this.metadataProvider = metadataProvider || (() => ({}));
    this.providersProvider = providersProvider || (() => []);
    this.appLaunchersProvider = appLaunchersProvider || (() => []);
    this.appInstancesProvider = appInstancesProvider || (() => []);
    this.sessionsProvider = sessionsProvider || (() => []);
    this.browserSessionsProvider = browserSessionsProvider || (() => []);
    this.agentTownStateProvider = agentTownStateProvider || (() => ({}));
    this.portsProvider = portsProvider || (() => []);
    this.systemProvider = systemProvider || (() => ({}));
    this.buildingsProvider = buildingsProvider || (() => []);
    this.projectsProvider = projectsProvider || (() => []);
    this.handoffJobsProvider = handoffJobsProvider || (() => []);
    this.brainProvider = brainProvider || (() => ({}));
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
        handoffs: 1,
        brain: 1,
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
      appLaunchersResult,
      appInstancesResult,
      handoffJobsResult,
      brainResult,
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
      withTimeout("appLaunchers", this.appLaunchersProvider, [], this.timeoutMs),
      withTimeout("appInstances", this.appInstancesProvider, [], this.timeoutMs),
      withTimeout("handoffJobs", this.handoffJobsProvider, [], this.timeoutMs),
      withTimeout("brain", this.brainProvider, {}, this.timeoutMs),
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
    const appLaunchers = arrayOrEmpty(appLaunchersResult.value);
    const appInstances = arrayOrEmpty(appInstancesResult.value);
    const launchers = buildLaunchers(providers, appLaunchers);
    const handoffJobs = arrayOrEmpty(handoffJobsResult.value);
    const brain = brainResult.value || {};
    const degraded = [
      sessionsResult,
      browserResult,
      agentTownResult,
      portsResult,
      systemResult,
      buildingsResult,
      projectsResult,
      providersResult,
      appLaunchersResult,
      appInstancesResult,
      handoffJobsResult,
      brainResult,
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
        launcherCount: launchers.length,
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
        handoffCount: handoffJobs.length,
        appInstanceCount: appInstances.length,
        brainNoteCount: Number(brain?.noteCount ?? brain?.notes?.length ?? 0) || 0,
        roles: [
          providers.some((provider) => provider?.available && provider?.id !== "shell") ? "agent-host" : "",
          arrayOrEmpty(systemResult.value?.gpus).length ? "gpu-worker" : "",
          ports.some((port) => port?.previewKind === "preview" || port?.preferredAccess) ? "app-host" : "",
          Number(brain?.noteCount ?? brain?.notes?.length ?? 0) ? "brain-host" : "",
          handoffJobs.length ? "handoff-coordinator" : "",
        ].filter(Boolean),
        hardware: normalizedMode === "privileged"
          ? {
              platform: os.platform(),
              arch: os.arch(),
              cpuCount: os.cpus()?.length || null,
              memoryTotalBytes: systemResult.value?.memory?.totalBytes ?? systemResult.value?.memory?.total ?? null,
              gpus: arrayOrEmpty(systemResult.value?.gpus).slice(0, 12).map((gpu) => ({
                index: gpu?.index,
                name: compactText(gpu?.name || "", 100),
              })),
            }
          : null,
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
        appInstances: appInstances.length,
        projects: projects.length,
        buildings: buildings.length,
        handoffJobs: handoffJobs.length,
        brainNotes: Number(brain?.noteCount ?? brain?.notes?.length ?? 0) || 0,
      },
      sessions: sessions.slice(0, 100).map((session) => summarizeSession(session, normalizedMode)),
      launchers,
      appInstances: appInstances.slice(0, 80).map((instance) => summarizeAppInstance(instance, normalizedMode)).filter(Boolean),
      browserSessions: browserSessions.slice(0, 100).map((session) => summarizeBrowserSession(session, normalizedMode)),
      actionItems: actionItems.slice(0, 100).map((item) => summarizeActionItem(item, normalizedMode)),
      canvases: canvases.slice(0, 100).map((canvas) => summarizeCanvas(canvas, normalizedMode)),
      ports: normalizedMode === "redacted" ? [] : ports.slice(0, 120).map((port) => summarizePort(port, normalizedMode)),
      handoffJobs: handoffJobs.slice(0, 80).map((job) => summarizeHandoffJob(job, normalizedMode)),
      brain: summarizeBrain(brain, normalizedMode),
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
