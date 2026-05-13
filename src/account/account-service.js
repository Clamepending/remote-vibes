import { normalizeAccountHttpUrl } from "./account-token-store.js";

const DEFAULT_ACCOUNT_BASE_URL = "https://vibe-research.net";

function buildHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeBaseUrl(value) {
  return normalizeAccountHttpUrl(value).replace(/\/+$/u, "");
}

function normalizeAccount(account = {}) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return null;
  }
  const id = String(account.id || account.accountId || "").trim();
  const login = String(account.login || account.username || "").trim();
  const email = String(account.email || "").trim();
  const name = String(account.name || account.displayName || "").trim();
  const profileUrl = normalizeAccountHttpUrl(account.profileUrl || account.url || account.htmlUrl);
  const avatarUrl = normalizeAccountHttpUrl(account.avatarUrl || account.avatar_url);
  const commandPublicKey = String(account.commandPublicKey || account.accountPublicKey || "").trim().slice(0, 8_000);
  if (!id && !login && !email && !name && !profileUrl) {
    return null;
  }
  return { id, login, email, name, profileUrl, avatarUrl, commandPublicKey };
}

function normalizeNode(node = {}) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }
  const id = String(node.id || node.nodeId || "").trim();
  const nodeId = String(node.nodeId || id || "").trim();
  const displayName = String(node.displayName || node.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const status = String(node.status || "").trim().toLowerCase();
  const lastSeenAt = String(node.lastSeenAt || node.updatedAt || "").trim();
  const connectionHints = normalizeConnectionHints(node.connectionHints || node.urls);
  if (!id && !nodeId && !displayName) {
    return null;
  }
  return {
    id,
    nodeId,
    displayName,
    status: ["online", "idle", "busy", "stale", "offline"].includes(status) ? status : "",
    lastSeenAt,
    connectionHints,
  };
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function normalizeNodeCounts(value = {}) {
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

function normalizeNodeCapabilities(value = {}) {
  const roles = Array.isArray(value.roles)
    ? value.roles
      .map((role) => String(role || "").replace(/\s+/g, "-").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20)
    : [];
  return {
    providerCount: normalizeNumber(value.providerCount),
    launcherCount: normalizeNumber(value.launcherCount),
    buildingCount: normalizeNumber(value.buildingCount),
    gpuCount: normalizeNumber(value.gpuCount),
    cameraCount: normalizeNumber(value.cameraCount),
    handoffCount: normalizeNumber(value.handoffCount),
    brainNoteCount: normalizeNumber(value.brainNoteCount),
    hasTailscale: Boolean(value.hasTailscale),
    roles,
  };
}

function normalizeNodeLaunchers(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((launcher) => {
      const id = String(launcher?.id || "").replace(/\s+/g, "-").trim().slice(0, 120);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: String(launcher?.label || id).replace(/\s+/g, " ").trim().slice(0, 80),
        kind: String(launcher?.kind || "app").replace(/\s+/g, "-").trim().slice(0, 40),
        category: String(launcher?.category || "").replace(/\s+/g, "-").trim().slice(0, 40),
        priority: normalizeNumber(launcher?.priority),
        description: String(launcher?.description || "").replace(/\s+/g, " ").trim().slice(0, 160),
        providerId: String(launcher?.providerId || "").replace(/\s+/g, "-").trim().slice(0, 80),
        appId: String(launcher?.appId || "").replace(/\s+/g, "-").trim().slice(0, 80),
        defaultName: String(launcher?.defaultName || launcher?.label || "").replace(/\s+/g, " ").trim().slice(0, 80),
        available: launcher?.available !== false,
        platform: String(launcher?.platform || "").replace(/\s+/g, "-").trim().slice(0, 40),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function isLocalConnectionHint(hint = {}) {
  try {
    const host = new URL(String(hint.url || "")).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function preferredConnectionHint(hints = []) {
  const entries = Array.isArray(hints) ? hints.filter((hint) => hint?.url) : [];
  return entries.find((hint) => ["tailscale", "public"].includes(String(hint.kind || "").toLowerCase()) && !isLocalConnectionHint(hint))
    || entries.find((hint) => !isLocalConnectionHint(hint))
    || entries[0]
    || {};
}

function normalizeAccountFleetNode(node = {}) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }
  const summary = node.summary && typeof node.summary === "object" ? node.summary : {};
  const summaryNode = summary.node && typeof summary.node === "object" ? summary.node : {};
  const id = String(node.id || node.nodeId || summaryNode.nodeId || summaryNode.id || "").trim();
  const nodeId = String(node.nodeId || summaryNode.nodeId || id || "").trim();
  const displayName = String(node.displayName || node.name || summaryNode.displayName || summaryNode.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const connectionHints = normalizeConnectionHints(
    node.connectionHints ||
      node.urls ||
      summary.connectionHints ||
      summary.urls ||
      [],
  );
  const baseUrl = preferredConnectionHint(connectionHints).url || "";
  if (!id && !nodeId && !displayName && !baseUrl) {
    return null;
  }
  return {
    id,
    nodeId,
    displayName,
    label: displayName,
    status: String(node.status || summary.status || "").trim().toLowerCase(),
    lastSeenAt: String(node.lastSeenAt || node.updatedAt || summary.generatedAt || "").trim(),
    os: String(node.os || summaryNode.os || summary.system?.platform || "").trim(),
    arch: String(node.arch || summaryNode.arch || summary.system?.arch || "").trim(),
    swarmlabVersion: String(node.swarmlabVersion || node.version || summaryNode.swarmlabVersion || "").trim(),
    commit: String(node.commit || summaryNode.commit || "").trim(),
    branch: String(node.branch || summaryNode.branch || "").trim(),
    hostnameHash: String(node.hostnameHash || summaryNode.hostnameHash || "").trim(),
    baseUrl,
    url: baseUrl,
    connectionHints,
    counts: normalizeNodeCounts(node.counts || summary.counts || {}),
    capabilities: normalizeNodeCapabilities(node.capabilities || summary.capabilities || {}),
    launchers: normalizeNodeLaunchers(node.launchers || summary.launchers || []),
  };
}

async function readJsonResponse(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function redactUrlToOrigin(value) {
  const normalized = normalizeAccountHttpUrl(value);
  if (!normalized) {
    return "";
  }
  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
}

export function normalizeConnectionHints(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const hints = [];
  for (const entry of source) {
    const rawKind = String(entry?.kind || "manual").trim().toLowerCase();
    const url = redactUrlToOrigin(entry?.url || entry?.baseUrl || entry?.href);
    if (!url) continue;
    const kind = ["local", "lan", "tailscale", "public", "relay", "manual"].includes(rawKind) ? rawKind : "manual";
    const key = `${kind}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({
      kind,
      url,
      label: String(entry?.label || "").replace(/\s+/g, " ").trim().slice(0, 80),
    });
  }
  return hints.slice(0, 20);
}

export function buildNodeSummaryFromSnapshot(snapshot = {}) {
  const counts = snapshot.counts || {};
  const capabilities = snapshot.capabilities || {};
  const system = snapshot.system || {};
  const roles = Array.isArray(capabilities.roles)
    ? capabilities.roles
      .map((role) => String(role || "").replace(/\s+/g, "-").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20)
    : [];
  return {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    mode: "redacted",
    node: {
      nodeId: String(snapshot.node?.nodeId || "").trim(),
      installId: String(snapshot.node?.installId || "").trim(),
      displayName: String(snapshot.node?.displayName || "Swarmlab node").trim(),
      swarmlabVersion: String(snapshot.node?.swarmlabVersion || "").trim(),
      commit: String(snapshot.node?.commit || "").trim(),
      branch: String(snapshot.node?.branch || "").trim(),
      os: String(snapshot.node?.os || system.platform || "").trim(),
      arch: String(snapshot.node?.arch || system.arch || "").trim(),
      hostnameHash: String(snapshot.node?.hostnameHash || "").trim(),
    },
    status: Number(counts.runningSessions || 0) > 0 ? "busy" : "idle",
    counts: {
      sessions: Number(counts.sessions || 0),
      runningSessions: Number(counts.runningSessions || 0),
      approvals: Number(counts.openActionItems || counts.approvals || 0),
      browserTasks: Number(counts.browserSessions || counts.browserTasks || 0),
      ports: Number(counts.ports || 0),
      canvases: Number(counts.canvases || 0),
      projects: Number(counts.projects || 0),
      handoffJobs: Number(counts.handoffJobs || capabilities.handoffCount || 0),
      brainNotes: Number(counts.brainNotes || capabilities.brainNoteCount || 0),
    },
    capabilities: {
      providerCount: Number(capabilities.providerCount || 0),
      launcherCount: Number(capabilities.launcherCount || 0),
      buildingCount: Number(capabilities.buildingCount || 0),
      gpuCount: Number(capabilities.gpuCount || system.gpuCount || 0),
      cameraCount: Number(capabilities.cameraCount || system.cameraCount || 0),
      handoffCount: Number(capabilities.handoffCount || counts.handoffJobs || 0),
      brainNoteCount: Number(capabilities.brainNoteCount || counts.brainNotes || 0),
      hasTailscale: Boolean(capabilities.hasTailscale),
      roles,
    },
    system: {
      platform: String(system.platform || snapshot.node?.os || "").trim(),
      arch: String(system.arch || snapshot.node?.arch || "").trim(),
      cpuCount: Number(system.cpuCount || 0) || null,
      gpuCount: Number(system.gpuCount || capabilities.gpuCount || 0),
      cameraCount: Number(system.cameraCount || capabilities.cameraCount || 0),
      memory: system.memory && typeof system.memory === "object"
        ? {
            total: system.memory.total ?? null,
            free: system.memory.free ?? null,
            used: system.memory.used ?? null,
          }
        : null,
    },
    portHints: snapshot.portHints && typeof snapshot.portHints === "object" ? { ...snapshot.portHints } : null,
    launchers: normalizeNodeLaunchers(snapshot.launchers || []),
    degraded: Array.isArray(snapshot.degraded) ? snapshot.degraded.slice(0, 10) : [],
  };
}

export function buildNodeRegistrationPayload({
  identity = {},
  snapshot = {},
  connectionHints = [],
} = {}) {
  const summary = buildNodeSummaryFromSnapshot(snapshot);
  return {
    schemaVersion: 1,
    nodeId: String(identity.nodeId || summary.node.nodeId || "").trim(),
    installId: String(identity.installId || summary.node.installId || "").trim(),
    publicKey: String(identity.publicKey || "").trim(),
    displayName: summary.node.displayName,
    connectionHints: normalizeConnectionHints(connectionHints),
    summary,
    generatedAt: summary.generatedAt,
  };
}

export class AccountService {
  constructor({
    tokenStore,
    nodeIdentityStore,
    fetchImpl = globalThis.fetch,
    env = process.env,
  } = {}) {
    if (!tokenStore) {
      throw new Error("AccountService requires a tokenStore.");
    }
    if (!nodeIdentityStore) {
      throw new Error("AccountService requires a nodeIdentityStore.");
    }
    this.tokenStore = tokenStore;
    this.nodeIdentityStore = nodeIdentityStore;
    this.fetch = fetchImpl;
    this.env = env || {};
  }

  getAppBaseUrl(settings = {}) {
    return normalizeBaseUrl(
      this.env.SWARMLAB_ACCOUNT_URL ||
        this.env.SWARMLAB_ACCOUNT_APP_URL ||
        this.env.VIBE_RESEARCH_ACCOUNT_URL ||
        this.env.VIBE_RESEARCH_ACCOUNT_APP_URL ||
        settings.swarmlabAccountUrl ||
        settings.vibeAccountUrl ||
        settings.accountBaseUrl ||
        DEFAULT_ACCOUNT_BASE_URL,
    );
  }

  getStatus(settings = {}) {
    return {
      ...this.tokenStore.getStatus(),
      appBaseUrl: this.tokenStore.getStatus().appBaseUrl || this.getAppBaseUrl(settings),
    };
  }

  async startPairing({
    settings = {},
    appBaseUrl: requestedAppBaseUrl = "",
    redirectUri = "",
    label = "Swarmlab",
    connectionHints = [],
  } = {}) {
    const appBaseUrl = normalizeBaseUrl(requestedAppBaseUrl || this.getAppBaseUrl(settings));
    if (!appBaseUrl) {
      throw buildHttpError("Vibe account URL is not configured.", 400);
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account pairing.", 500);
    }

    const response = await this.fetch(new URL("/api/account/nodes/pairing", appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "swarmlab",
      },
      body: JSON.stringify({
        label,
        redirectUri: normalizeAccountHttpUrl(redirectUri),
        identity: this.nodeIdentityStore.getPublicIdentity({ includeHostname: true }),
        connectionHints: normalizeConnectionHints(connectionHints),
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `Vibe account pairing failed (${response.status}).`, response.status || 400);
    }
    return {
      pairingId: String(payload.pairingId || payload.id || "").trim(),
      pairingCode: String(payload.pairingCode || payload.code || "").trim(),
      pairingUrl: normalizeAccountHttpUrl(payload.pairingUrl || payload.url),
      expiresAt: String(payload.expiresAt || "").trim(),
      appBaseUrl,
    };
  }

  async completePairing({
    settings = {},
    appBaseUrl: requestedAppBaseUrl = "",
    grant = "",
    pairingId = "",
    redirectUri = "",
    label = "Swarmlab",
    connectionHints = [],
  } = {}) {
    const appBaseUrl = normalizeBaseUrl(requestedAppBaseUrl || this.getAppBaseUrl(settings));
    const normalizedGrant = String(grant || "").trim();
    const normalizedPairingId = String(pairingId || "").trim();
    if (!normalizedGrant && !normalizedPairingId) {
      throw buildHttpError("A Vibe account pairing grant or pairing id is required.", 400);
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account pairing.", 500);
    }

    const response = await this.fetch(new URL("/api/account/nodes/pairing/complete", appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "swarmlab",
      },
      body: JSON.stringify({
        grant: normalizedGrant,
        pairingId: normalizedPairingId,
        label,
        redirectUri: normalizeAccountHttpUrl(redirectUri),
        identity: this.nodeIdentityStore.getPublicIdentity({ includeHostname: true }),
        connectionHints: normalizeConnectionHints(connectionHints),
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `Vibe account pairing completion failed (${response.status}).`, response.status || 400);
    }

    const accessToken = String(payload.accessToken || "").trim();
    const account = normalizeAccount(payload.account || payload.user);
    const node = normalizeNode(payload.node || payload.machine);
    const accountPublicKey = String(payload.commandPublicKey || payload.accountPublicKey || account?.commandPublicKey || "").trim();
    if (!accessToken || !account) {
      throw buildHttpError("Vibe account did not return an account token.", 502);
    }

    return this.tokenStore.setRecord({
      accessToken,
      appBaseUrl,
      accountPublicKey,
      account,
      node,
    });
  }

  async exchangeGrant(options = {}) {
    return this.completePairing(options);
  }

  async registerNode({
    settings = {},
    snapshot = {},
    connectionHints = [],
  } = {}) {
    const record = this.tokenStore.getRecord();
    const accessToken = String(record?.accessToken || "").trim();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    if (!accessToken || !appBaseUrl) {
      throw buildHttpError("Connect a Vibe account before registering this machine.", 401);
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account registration.", 500);
    }

    const registration = buildNodeRegistrationPayload({
      identity: this.nodeIdentityStore.getPublicIdentity({ includeHostname: false }),
      snapshot,
      connectionHints,
    });
    const unsigned = { type: "node.registration", registration };
    const signature = this.nodeIdentityStore.signPayload(unsigned);
    const response = await this.fetch(new URL("/api/account/nodes", appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "swarmlab",
      },
      body: JSON.stringify({
        ...unsigned,
        signature,
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `Vibe account node registration failed (${response.status}).`, response.status || 400);
    }

    const node = normalizeNode(payload.node || payload.machine || {
      nodeId: registration.nodeId,
      displayName: registration.displayName,
      status: registration.summary.status,
      connectionHints: registration.connectionHints,
    });
    await this.tokenStore.updateNode(node);
    return { node, registration };
  }

  async sendHeartbeat({ settings = {}, heartbeat } = {}) {
    const record = this.tokenStore.getRecord();
    const accessToken = String(record?.accessToken || "").trim();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    if (!accessToken || !appBaseUrl) {
      return { skipped: true, reason: "account-not-connected" };
    }
    if (!heartbeat || typeof heartbeat !== "object") {
      throw buildHttpError("Heartbeat payload is required.", 400);
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account heartbeat.", 500);
    }

    const nodeId = encodeURIComponent(String(heartbeat.nodeId || record?.node?.nodeId || "current").trim() || "current");
    const response = await this.fetch(new URL(`/api/account/nodes/${nodeId}/heartbeat`, appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "swarmlab",
      },
      body: JSON.stringify({ heartbeat }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const message = payload.error || payload.message || `Vibe account heartbeat failed (${response.status}).`;
      await this.tokenStore.recordHeartbeat({
        ok: false,
        at: heartbeat.generatedAt,
        error: message,
      });
      throw buildHttpError(message, response.status || 400);
    }

    const node = normalizeNode(payload.node || payload.machine);
    await this.tokenStore.recordHeartbeat({
      ok: true,
      at: heartbeat.generatedAt,
      status: payload.status || "ok",
      node,
    });
    return { ok: true, node, payload };
  }

  async listCommands({ settings = {}, limit = 10 } = {}) {
    const record = this.tokenStore.getRecord();
    const accessToken = String(record?.accessToken || "").trim();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    const nodeId = encodeURIComponent(String(record?.node?.nodeId || "").trim());
    if (!accessToken || !appBaseUrl || !nodeId) {
      return { skipped: true, reason: "account-not-connected", commands: [] };
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account commands.", 500);
    }

    const url = new URL(`/api/account/nodes/${nodeId}/commands/pending`, appBaseUrl);
    url.searchParams.set("limit", String(Math.max(1, Math.min(25, Number(limit) || 10))));
    const response = await this.fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "swarmlab",
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `Vibe account command poll failed (${response.status}).`, response.status || 400);
    }
    const commands = Array.isArray(payload.commands) ? payload.commands : [];
    return {
      commands,
      accountPublicKey: String(payload.accountPublicKey || record.accountPublicKey || "").trim(),
    };
  }

  async acknowledgeCommand({ settings = {}, commandId = "", ack = {} } = {}) {
    const record = this.tokenStore.getRecord();
    const accessToken = String(record?.accessToken || "").trim();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    const nodeId = encodeURIComponent(String(record?.node?.nodeId || ack?.nodeId || "").trim());
    const normalizedCommandId = encodeURIComponent(String(commandId || ack?.commandId || "").trim());
    if (!accessToken || !appBaseUrl || !nodeId || !normalizedCommandId) {
      return { skipped: true, reason: "account-not-connected" };
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account command ack.", 500);
    }

    const response = await this.fetch(new URL(`/api/account/nodes/${nodeId}/commands/${normalizedCommandId}/ack`, appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "swarmlab",
      },
      body: JSON.stringify(ack),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `Vibe account command ack failed (${response.status}).`, response.status || 400);
    }
    return payload;
  }

  async listNodes({ settings = {} } = {}) {
    const record = this.tokenStore.getRecord();
    const accessToken = String(record?.accessToken || "").trim();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    if (!accessToken || !appBaseUrl) {
      return { skipped: true, reason: "account-not-connected", nodes: [] };
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for Vibe account nodes.", 500);
    }

    const response = await this.fetch(new URL("/api/account/nodes", appBaseUrl).toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "swarmlab",
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `Vibe account nodes failed (${response.status}).`, response.status || 400);
    }
    const nodes = (Array.isArray(payload.nodes) ? payload.nodes : Array.isArray(payload.machines) ? payload.machines : [])
      .map(normalizeAccountFleetNode)
      .filter(Boolean);
    return { nodes };
  }

  async disconnect({ settings = {} } = {}) {
    const record = this.tokenStore.getRecord();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    const accessToken = String(record?.accessToken || "").trim();

    if (appBaseUrl && accessToken && typeof this.fetch === "function") {
      try {
        await this.fetch(new URL("/api/account/nodes/disconnect", appBaseUrl).toString(), {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "swarmlab",
          },
        });
      } catch {
        // Best-effort remote revoke; local disconnect should still succeed.
      }
    }

    await this.tokenStore.clear();
    return true;
  }
}

export { DEFAULT_ACCOUNT_BASE_URL, normalizeBaseUrl as normalizeAccountBaseUrl };
