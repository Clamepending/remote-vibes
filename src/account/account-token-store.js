import { promises as fsPromises } from "node:fs";
import path from "node:path";

const STORE_FILENAME = "account.json";
const STORE_VERSION = 1;
const FILE_MODE = 0o600;

function normalizeHttpUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return "";
  }
}

function normalizeAccount(account = {}) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return null;
  }

  const id = String(account.id || account.accountId || "").trim();
  const login = String(account.login || account.username || "").trim();
  const email = String(account.email || "").trim();
  const name = String(account.name || account.displayName || "").trim();
  const profileUrl = normalizeHttpUrl(account.profileUrl || account.url || account.htmlUrl);
  const avatarUrl = normalizeHttpUrl(account.avatarUrl || account.avatar_url);

  if (!id && !login && !email && !name && !profileUrl) {
    return null;
  }

  return {
    id,
    login,
    email,
    name,
    profileUrl,
    avatarUrl,
  };
}

function normalizeConnectionHints(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const hints = [];
  for (const entry of source) {
    const kind = String(entry?.kind || "manual").trim().toLowerCase();
    const normalized = normalizeHttpUrl(entry?.url || entry?.baseUrl || entry?.href);
    if (!normalized) continue;
    let url = "";
    try {
      url = new URL(normalized).origin;
    } catch {
      continue;
    }
    const key = `${kind}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({
      kind: ["local", "lan", "tailscale", "public", "relay", "manual"].includes(kind) ? kind : "manual",
      url,
      label: String(entry?.label || "").replace(/\s+/g, " ").trim().slice(0, 80),
    });
  }
  return hints.slice(0, 20);
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

function normalizeHeartbeat(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const lastHeartbeatAt = String(value.lastHeartbeatAt || value.at || "").trim();
  const lastHeartbeatStatus = String(value.lastHeartbeatStatus || value.status || "").trim().slice(0, 80);
  const lastHeartbeatError = String(value.lastHeartbeatError || value.error || "").trim().slice(0, 240);
  if (!lastHeartbeatAt && !lastHeartbeatStatus && !lastHeartbeatError) {
    return null;
  }
  return {
    lastHeartbeatAt,
    lastHeartbeatStatus,
    lastHeartbeatError,
  };
}

function normalizeRecord(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const accessToken = String(record.accessToken || "").trim();
  const appBaseUrl = normalizeHttpUrl(record.appBaseUrl || record.baseUrl || record.accountBaseUrl);
  const account = normalizeAccount(record.account || record.user);
  const node = normalizeNode(record.node || record.machine);
  const heartbeat = normalizeHeartbeat(record.heartbeat || record);
  const accountPublicKey = String(
    record.accountPublicKey ||
      record.commandPublicKey ||
      record.account?.commandPublicKey ||
      record.account?.publicKey ||
      "",
  ).trim().slice(0, 8_000);

  if (!accessToken && !account && !node) {
    return null;
  }

  return {
    accessToken,
    appBaseUrl,
    accountPublicKey,
    account,
    node,
    heartbeat,
  };
}

export class AccountTokenStore {
  constructor({ stateDir, fsImpl = fsPromises } = {}) {
    if (!stateDir) {
      throw new Error("stateDir is required for AccountTokenStore.");
    }
    this.fs = fsImpl;
    this.storePath = path.join(stateDir, STORE_FILENAME);
    this.record = null;
  }

  async load() {
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.storePath, "utf8"));
      this.record = parsed?.version === STORE_VERSION ? normalizeRecord(parsed.record) : null;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      this.record = null;
    }
  }

  async save() {
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await this.fs.mkdir(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
    await this.fs.writeFile(
      tempPath,
      `${JSON.stringify({
        version: STORE_VERSION,
        record: this.record,
      }, null, 2)}\n`,
      { encoding: "utf8", mode: FILE_MODE },
    );
    await this.fs.rename(tempPath, this.storePath);
  }

  getRecord() {
    return this.record
      ? {
          accessToken: this.record.accessToken,
          appBaseUrl: this.record.appBaseUrl,
          accountPublicKey: this.record.accountPublicKey,
          account: this.record.account ? { ...this.record.account } : null,
          node: this.record.node
            ? { ...this.record.node, connectionHints: [...this.record.node.connectionHints] }
            : null,
          heartbeat: this.record.heartbeat ? { ...this.record.heartbeat } : null,
        }
      : null;
  }

  async setRecord(record = {}) {
    this.record = normalizeRecord(record);
    await this.save();
    return this.getRecord();
  }

  async updateNode(node = {}) {
    const current = this.getRecord() || {};
    return this.setRecord({
      ...current,
      node,
    });
  }

  async recordHeartbeat({ ok = false, at = "", status = "", error = "", node = null } = {}) {
    const current = this.getRecord() || {};
    return this.setRecord({
      ...current,
      ...(node ? { node } : {}),
      heartbeat: {
        lastHeartbeatAt: at || new Date().toISOString(),
        lastHeartbeatStatus: ok ? (status || "ok") : "failed",
        lastHeartbeatError: ok ? "" : String(error || "Heartbeat failed.").slice(0, 240),
      },
    });
  }

  async clear() {
    if (!this.record) {
      return false;
    }
    this.record = null;
    await this.save();
    return true;
  }

  getStatus() {
    const record = this.getRecord();
    return {
      configured: Boolean(record?.accessToken),
      appBaseUrl: record?.appBaseUrl || "",
      account: record?.account || null,
      node: record?.node || null,
      heartbeat: record?.heartbeat || null,
    };
  }
}

export { normalizeHttpUrl as normalizeAccountHttpUrl };
