import {
  buildNodeRegistrationPayload,
  buildNodeSummaryFromSnapshot,
  normalizeConnectionHints,
} from "./account-service.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const MIN_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeIntervalMs(value, fallback = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.round(parsed)));
}

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === false) {
    return value;
  }
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function scrubSensitivePayload(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

export function buildNodeHeartbeatPayload({
  identity = {},
  snapshot = {},
  connectionHints = [],
  signature = "",
} = {}) {
  const summary = buildNodeSummaryFromSnapshot(snapshot);
  const heartbeat = {
    schemaVersion: 1,
    nodeId: String(identity.nodeId || summary.node.nodeId || "").trim(),
    installId: String(identity.installId || summary.node.installId || "").trim(),
    publicKey: String(identity.publicKey || "").trim(),
    displayName: summary.node.displayName,
    swarmlabVersion: summary.node.swarmlabVersion,
    commit: summary.node.commit,
    branch: summary.node.branch,
    os: summary.node.os || summary.system.platform,
    arch: summary.node.arch || summary.system.arch,
    hostnameHash: summary.node.hostnameHash,
    connectionHints: normalizeConnectionHints(connectionHints),
    status: summary.status,
    counts: summary.counts,
    capabilities: summary.capabilities,
    system: summary.system,
    portHints: summary.portHints,
    degraded: summary.degraded,
    generatedAt: summary.generatedAt || nowIso(),
  };

  return {
    ...scrubSensitivePayload(heartbeat),
    ...(signature ? { signature } : {}),
  };
}

export class NodeHeartbeatService {
  constructor({
    accountService,
    tokenStore,
    nodeIdentityStore,
    nodeSnapshotService,
    settingsProvider = () => ({}),
    connectionHintsProvider = () => [],
    intervalMs = null,
    log = console,
  } = {}) {
    if (!accountService) {
      throw new Error("NodeHeartbeatService requires an accountService.");
    }
    if (!tokenStore) {
      throw new Error("NodeHeartbeatService requires a tokenStore.");
    }
    if (!nodeIdentityStore) {
      throw new Error("NodeHeartbeatService requires a nodeIdentityStore.");
    }
    if (!nodeSnapshotService) {
      throw new Error("NodeHeartbeatService requires a nodeSnapshotService.");
    }
    this.accountService = accountService;
    this.tokenStore = tokenStore;
    this.nodeIdentityStore = nodeIdentityStore;
    this.nodeSnapshotService = nodeSnapshotService;
    this.settingsProvider = settingsProvider;
    this.connectionHintsProvider = connectionHintsProvider;
    this.intervalOverrideMs = intervalMs;
    this.log = log || console;
    this.timer = null;
    this.inFlight = null;
  }

  getSettings() {
    const settings = this.settingsProvider();
    return settings && typeof settings === "object" ? settings : {};
  }

  getIntervalMs() {
    const settings = this.getSettings();
    return normalizeIntervalMs(
      this.intervalOverrideMs ??
        settings.swarmlabAccountHeartbeatIntervalMs ??
        settings.vibeAccountHeartbeatIntervalMs,
    );
  }

  isEnabled() {
    const settings = this.getSettings();
    return normalizeBoolean(
      settings.swarmlabAccountHeartbeatEnabled ??
        settings.vibeAccountHeartbeatEnabled,
      true,
    );
  }

  isConnected() {
    return Boolean(this.tokenStore.getRecord()?.accessToken);
  }

  async getConnectionHints() {
    return normalizeConnectionHints(await this.connectionHintsProvider());
  }

  async getRedactedSnapshot() {
    return this.nodeSnapshotService.getSnapshot({ mode: "redacted" });
  }

  async buildRegistrationPayload() {
    const [snapshot, connectionHints] = await Promise.all([
      this.getRedactedSnapshot(),
      this.getConnectionHints(),
    ]);
    return buildNodeRegistrationPayload({
      identity: this.nodeIdentityStore.getPublicIdentity({ includeHostname: false }),
      snapshot,
      connectionHints,
    });
  }

  async buildHeartbeat({ reason = "" } = {}) {
    const [snapshot, connectionHints] = await Promise.all([
      this.getRedactedSnapshot(),
      this.getConnectionHints(),
    ]);
    const unsigned = {
      ...buildNodeHeartbeatPayload({
        identity: this.nodeIdentityStore.getPublicIdentity({ includeHostname: false }),
        snapshot,
        connectionHints,
      }),
      ...(reason ? { reason } : {}),
    };
    const signature = this.nodeIdentityStore.signPayload({
      type: "node.heartbeat",
      heartbeat: unsigned,
    });
    return { ...unsigned, signature };
  }

  async register({ force = false } = {}) {
    if (!this.isEnabled()) {
      return { skipped: true, reason: "heartbeat-disabled" };
    }
    if (!this.isConnected()) {
      return { skipped: true, reason: "account-not-connected" };
    }
    if (!force && this.tokenStore.getRecord()?.node?.nodeId) {
      return { skipped: true, reason: "already-registered" };
    }

    const snapshot = await this.getRedactedSnapshot();
    return this.accountService.registerNode({
      settings: this.getSettings(),
      snapshot,
      connectionHints: await this.getConnectionHints(),
    });
  }

  async tick({ reason = "manual", forceRegister = false } = {}) {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = (async () => {
      if (!this.isEnabled()) {
        return { skipped: true, reason: "heartbeat-disabled" };
      }
      if (!this.isConnected()) {
        return { skipped: true, reason: "account-not-connected" };
      }

      try {
        const record = this.tokenStore.getRecord();
        if (forceRegister || !record?.node?.nodeId) {
          await this.register({ force: true });
        }
        const heartbeat = await this.buildHeartbeat({ reason });
        return await this.accountService.sendHeartbeat({
          settings: this.getSettings(),
          heartbeat,
        });
      } catch (error) {
        try {
          await this.tokenStore.recordHeartbeat({
            ok: false,
            at: nowIso(),
            error: error?.message || String(error),
          });
        } catch {
          // Status persistence must not turn a failed heartbeat into a crash.
        }
        throw error;
      }
    })().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  start({ immediate = true } = {}) {
    if (this.timer) {
      return false;
    }
    if (!this.isEnabled() || !this.isConnected()) {
      return false;
    }
    this.timer = setInterval(() => {
      void this.tick({ reason: "timer" }).catch((error) => {
        this.log?.warn?.("[swarmlab] Vibe account heartbeat failed", error?.message || error);
      });
    }, this.getIntervalMs());
    this.timer.unref?.();
    if (immediate) {
      void this.tick({ reason: "startup" }).catch((error) => {
        this.log?.warn?.("[swarmlab] Vibe account startup heartbeat failed", error?.message || error);
      });
    }
    return true;
  }

  stop() {
    if (!this.timer) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      connected: this.isConnected(),
      running: Boolean(this.timer),
      intervalMs: this.getIntervalMs(),
      ...this.tokenStore.getStatus(),
    };
  }
}

export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  normalizeIntervalMs as normalizeHeartbeatIntervalMs,
};
