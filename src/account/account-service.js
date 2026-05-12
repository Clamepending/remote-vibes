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
  if (!id && !login && !email && !name && !profileUrl) {
    return null;
  }
  return { id, login, email, name, profileUrl, avatarUrl };
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
    },
    capabilities: {
      providerCount: Number(capabilities.providerCount || 0),
      buildingCount: Number(capabilities.buildingCount || 0),
      gpuCount: Number(capabilities.gpuCount || system.gpuCount || 0),
      cameraCount: Number(capabilities.cameraCount || system.cameraCount || 0),
      hasTailscale: Boolean(capabilities.hasTailscale),
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
    redirectUri = "",
    label = "Swarmlab",
    connectionHints = [],
  } = {}) {
    const appBaseUrl = this.getAppBaseUrl(settings);
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
    grant = "",
    pairingId = "",
    redirectUri = "",
    label = "Swarmlab",
    connectionHints = [],
  } = {}) {
    const appBaseUrl = this.getAppBaseUrl(settings);
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
    if (!accessToken || !account) {
      throw buildHttpError("Vibe account did not return an account token.", 502);
    }

    return this.tokenStore.setRecord({
      accessToken,
      appBaseUrl,
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
