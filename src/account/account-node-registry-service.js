import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign as signPayload, verify as verifySignature } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeNodePayload } from "../node/identity-store.js";
import { buildNodeSummaryFromSnapshot, normalizeConnectionHints } from "./account-service.js";

const ACCOUNT_NODE_REGISTRY_VERSION = 1;
const ACCOUNT_NODE_REGISTRY_FILENAME = "account-node-registry.json";
const PAIRING_TTL_MS = 15 * 60 * 1000;
const NODE_STALE_MS = 2 * 60 * 1000;
const NODE_OFFLINE_MS = 10 * 60 * 1000;
const COMMAND_TTL_MS = 10 * 60 * 1000;
const COMMAND_LEASE_MS = 60 * 1000;
const COMMAND_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_NODE_STATUSES = new Set(["online", "idle", "busy", "stale", "offline", "unreachable", "unknown"]);
const ACCOUNT_NODE_COMMAND_OPERATIONS = new Set([
  "session.input.write",
  "session.create",
  "app.launch",
  "app.instance.dismiss",
]);
const ACCOUNT_NODE_COMMAND_STATUSES = new Set(["queued", "running", "completed", "failed", "expired", "canceled"]);

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

function hashSecret(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("base64url");
}

function randomToken(prefix) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function compactText(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactAccountText(value, max = 240) {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{6,}\b/g, "[redacted]")
    .replace(
      /\b(?:api[_-]?key|token|secret|password|authorization|bearer|ANTHROPIC_API_KEY|OPENAI_API_KEY|HF_TOKEN)=?[A-Za-z0-9_./:=@+-]{4,}\b/gi,
      "[redacted]",
    )
    .replace(/([?&](?:token|api_key|key|secret|password|auth|code)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+)(?:\/[^\s"'`)]*)?/g, "[path]")
    .replace(/(?:\/private\/var|\/var\/folders|\/tmp)(?:\/[^\s"'`)]*)?/g, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeOwnerAccountId(value) {
  return compactText(value || "local", 120)
    .toLowerCase()
    .replace(/[^a-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "local";
}

function normalizeStatus(value, fallback = "unknown") {
  const status = String(value || "").trim().toLowerCase();
  return ACCOUNT_NODE_STATUSES.has(status) ? status : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function normalizeRoles(value) {
  return Array.isArray(value)
    ? value
      .map((role) => compactText(role, 80).toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 20)
    : [];
}

function generateSigningKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "pem", type: "spki" }),
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    createdAt: nowIso(),
  };
}

function normalizeAccountSigningKey(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (typeof source.publicKey === "string" && source.publicKey.trim() && typeof source.privateKey === "string" && source.privateKey.trim()) {
    return {
      publicKey: source.publicKey.trim(),
      privateKey: source.privateKey.trim(),
      createdAt: compactText(source.createdAt, 80) || nowIso(),
    };
  }
  return generateSigningKeypair();
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

function normalizeCapabilities(value = {}) {
  return {
    providerCount: normalizeNumber(value.providerCount),
    launcherCount: normalizeNumber(value.launcherCount),
    buildingCount: normalizeNumber(value.buildingCount),
    gpuCount: normalizeNumber(value.gpuCount),
    cameraCount: normalizeNumber(value.cameraCount),
    handoffCount: normalizeNumber(value.handoffCount),
    brainNoteCount: normalizeNumber(value.brainNoteCount),
    hasTailscale: Boolean(value.hasTailscale),
    roles: normalizeRoles(value.roles),
  };
}

function normalizeLaunchers(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((launcher) => {
      const id = compactText(launcher?.id, 120);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: compactText(launcher?.label || id, 80),
        kind: compactText(launcher?.kind || "app", 40),
        category: compactText(launcher?.category, 40),
        priority: normalizeNumber(launcher?.priority, 0),
        description: compactText(launcher?.description, 160),
        providerId: compactText(launcher?.providerId, 80),
        appId: compactText(launcher?.appId, 80),
        defaultName: compactText(launcher?.defaultName || launcher?.label, 80),
        available: launcher?.available !== false,
        platform: compactText(launcher?.platform, 40),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeSessionNarrative(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      const text = compactAccountText(entry?.text || entry?.outputPreview, 700);
      if (!text) return null;
      return {
        id: compactText(entry?.id || `entry-${index}`, 180),
        kind: compactText(entry?.kind || "status", 40),
        label: compactAccountText(entry?.label || entry?.title || entry?.kind || "Session", 80),
        text,
        status: compactText(entry?.status, 40),
        timestamp: compactText(entry?.timestamp || entry?.createdAt, 80),
      };
    })
    .filter(Boolean)
    .slice(-6);
}

function normalizeSessions(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((session) => {
      const id = compactText(session?.id, 180);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name: compactText(session?.name || session?.title || session?.providerLabel || "Remote session", 120),
        providerId: compactText(session?.providerId, 80),
        providerLabel: compactText(session?.providerLabel, 80),
        status: compactText(session?.status || "unknown", 40),
        activityStatus: compactText(session?.activityStatus, 80),
        createdAt: compactText(session?.createdAt, 80),
        updatedAt: compactText(session?.updatedAt || session?.lastOutputAt || session?.lastPromptAt, 80),
        hasSubagents: Boolean(session?.hasSubagents || (Array.isArray(session?.subagents) && session.subagents.length)),
        recentNarrative: normalizeSessionNarrative(session?.recentNarrative || session?.recentNarrativeEntries || []),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeSystem(value = {}) {
  return {
    platform: compactText(value.platform, 40),
    arch: compactText(value.arch, 40),
    cpuCount: normalizeNumber(value.cpuCount, 0),
    gpuCount: normalizeNumber(value.gpuCount, 0),
    cameraCount: normalizeNumber(value.cameraCount, 0),
    memory: value.memory && typeof value.memory === "object"
      ? {
          total: Number.isFinite(Number(value.memory.total)) ? Number(value.memory.total) : null,
          free: Number.isFinite(Number(value.memory.free)) ? Number(value.memory.free) : null,
          used: Number.isFinite(Number(value.memory.used)) ? Number(value.memory.used) : null,
        }
      : null,
  };
}

function normalizePublicIdentity(value = {}) {
  const identity = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    nodeId: compactText(identity.nodeId, 160),
    installId: compactText(identity.installId, 160),
    publicKey: String(identity.publicKey || "").trim().slice(0, 8_000),
    createdAt: compactText(identity.createdAt, 80),
  };
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

function normalizeSummary(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const summary = buildNodeSummaryFromSnapshot({
    ...source,
    mode: "redacted",
    node: source.node || {},
    counts: source.counts || {},
    capabilities: source.capabilities || {},
    system: source.system || {},
    generatedAt: source.generatedAt || nowIso(),
  });
  return {
    ...summary,
    connectionHints: undefined,
  };
}

function normalizeNodeRecord(input = {}, existing = null, { ownerAccountId = "local" } = {}) {
  const timestamp = nowIso();
  const summary = normalizeSummary(input.summary || input.snapshot || {});
  const summaryNode = summary.node || {};
  const nodeId = compactText(input.nodeId || summaryNode.nodeId || existing?.nodeId, 160);
  if (!nodeId) {
    throw buildHttpError("nodeId is required.", 400);
  }

  const connectionHints = normalizeConnectionHints(
    input.connectionHints?.length
      ? input.connectionHints
      : summary.connectionHints?.length
      ? summary.connectionHints
      : existing?.connectionHints || [],
  );
  const counts = normalizeCounts(input.counts || summary.counts || existing?.counts || {});
  const capabilities = normalizeCapabilities(input.capabilities || summary.capabilities || existing?.capabilities || {});
  const system = normalizeSystem(input.system || summary.system || existing?.system || {});
  const launchers = normalizeLaunchers(input.launchers || summary.launchers || existing?.launchers || []);
  const sessions = normalizeSessions(summary.sessions || input.sessions || existing?.summary?.sessions || []);

  return {
    id: existing?.id || nodeId,
    ownerAccountId: normalizeOwnerAccountId(ownerAccountId || existing?.ownerAccountId),
    nodeId,
    installId: compactText(input.installId || summaryNode.installId || existing?.installId, 160),
    publicKey: String(input.publicKey || existing?.publicKey || "").trim().slice(0, 8_000),
    displayName: compactText(input.displayName || summaryNode.displayName || existing?.displayName || "Swarmlab node", 120),
    status: normalizeStatus(input.status || summary.status || existing?.status, "unknown"),
    lastSeenAt: compactText(input.lastSeenAt || summary.generatedAt || existing?.lastSeenAt || timestamp, 80),
    connectionHints,
    counts,
    capabilities,
    launchers,
    system,
    swarmlabVersion: compactText(input.swarmlabVersion || summaryNode.swarmlabVersion || existing?.swarmlabVersion, 80),
    commit: compactText(input.commit || summaryNode.commit || existing?.commit, 80),
    branch: compactText(input.branch || summaryNode.branch || existing?.branch, 80),
    os: compactText(input.os || summaryNode.os || system.platform || existing?.os, 40),
    arch: compactText(input.arch || summaryNode.arch || system.arch || existing?.arch, 40),
    hostnameHash: compactText(input.hostnameHash || summaryNode.hostnameHash || existing?.hostnameHash, 160),
    summary: {
      schemaVersion: 1,
      generatedAt: summary.generatedAt || timestamp,
      mode: "redacted",
      node: {
        nodeId,
        installId: compactText(input.installId || summaryNode.installId || existing?.installId, 160),
        displayName: compactText(input.displayName || summaryNode.displayName || existing?.displayName || "Swarmlab node", 120),
        swarmlabVersion: compactText(input.swarmlabVersion || summaryNode.swarmlabVersion || existing?.swarmlabVersion, 80),
        commit: compactText(input.commit || summaryNode.commit || existing?.commit, 80),
        branch: compactText(input.branch || summaryNode.branch || existing?.branch, 80),
        os: compactText(input.os || summaryNode.os || system.platform || existing?.os, 40),
        arch: compactText(input.arch || summaryNode.arch || system.arch || existing?.arch, 40),
        hostnameHash: compactText(input.hostnameHash || summaryNode.hostnameHash || existing?.hostnameHash, 160),
      },
      status: normalizeStatus(input.status || summary.status || existing?.status, "unknown"),
      counts,
      capabilities,
      launchers,
      sessions,
      system,
      degraded: Array.isArray(summary.degraded) ? summary.degraded.slice(0, 10).map((entry) => compactText(entry, 120)) : [],
    },
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    disconnectedAt: input.disconnectedAt === ""
      ? ""
      : compactText(input.disconnectedAt || existing?.disconnectedAt, 80),
  };
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
    launchers: Array.isArray(node.launchers) ? node.launchers.map((launcher) => ({ ...launcher })) : [],
    system: node.system && typeof node.system === "object" ? { ...node.system } : null,
    summary: node.summary && typeof node.summary === "object"
      ? JSON.parse(JSON.stringify(node.summary))
      : null,
  };
}

function cloneCommand(command) {
  return JSON.parse(JSON.stringify(command || {}));
}

function verifyNodeSignature(payload, signature, publicKey) {
  if (!publicKey || !signature) return false;
  try {
    const buffer = Buffer.from(String(signature || ""), "base64url");
    return Boolean(buffer.length && verifySignature(null, Buffer.from(canonicalizeNodePayload(payload)), publicKey, buffer));
  } catch {
    return false;
  }
}

function signAccountCommandPayload(payload, privateKey) {
  return signPayload(null, Buffer.from(canonicalizeNodePayload(payload)), privateKey).toString("base64url");
}

function normalizeCommandOperation(value) {
  const operation = compactText(value, 80);
  if (!ACCOUNT_NODE_COMMAND_OPERATIONS.has(operation)) {
    throw buildHttpError("Unsupported account node command operation.", 400);
  }
  return operation;
}

function normalizeCommandPayload(operation, value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (operation === "session.input.write") {
    const sessionId = compactText(source.sessionId || source.session_id, 180);
    const input = String(source.input || source.message || source.text || "").trim().slice(0, 12_000);
    if (!sessionId) {
      throw buildHttpError("session.input.write requires sessionId.", 400);
    }
    if (!input) {
      throw buildHttpError("session.input.write requires input.", 400);
    }
    return {
      sessionId,
      input,
      clientMessageId: compactText(source.clientMessageId || source.client_message_id, 180),
    };
  }
  if (operation === "session.create") {
    const payload = {
      providerId: compactText(source.providerId || source.provider_id, 80),
      name: compactText(source.name || source.title || "Remote agent", 120),
      cwd: compactText(source.cwd || source.workspace || source.workspacePath, 600),
      initialPrompt: String(source.initialPrompt || source.prompt || "").trim().slice(0, 24_000),
    };
    if (Number.isFinite(Number(source.initialPromptDelayMs))) {
      payload.initialPromptDelayMs = Math.max(0, Math.min(60_000, Math.round(Number(source.initialPromptDelayMs))));
    }
    return payload;
  }
  if (operation === "app.launch") {
    const appId = compactText(source.appId || source.app_id || source.launcherId || source.launcher_id || source.id, 80);
    if (!appId) {
      throw buildHttpError("app.launch requires appId.", 400);
    }
    return { appId };
  }
  if (operation === "app.instance.dismiss") {
    const instanceId = compactText(
      source.instanceId || source.instance_id || source.appInstanceId || source.app_instance_id || source.id,
      180,
    );
    if (!instanceId) {
      throw buildHttpError("app.instance.dismiss requires instanceId.", 400);
    }
    return {
      instanceId,
      appId: compactText(source.appId || source.app_id || source.launcherId || source.launcher_id || "", 80),
    };
  }
  return {};
}

function commandTargetFromPayload(operation, payload) {
  if (operation === "session.input.write") {
    return { sessionId: payload.sessionId };
  }
  if (operation === "session.create") {
    return {
      providerId: payload.providerId || "",
      cwdHint: payload.cwd ? createHash("sha256").update(payload.cwd).digest("hex").slice(0, 16) : "",
    };
  }
  if (operation === "app.launch") {
    return { appId: payload.appId || "" };
  }
  if (operation === "app.instance.dismiss") {
    return {
      instanceId: payload.instanceId || "",
      appId: payload.appId || "",
    };
  }
  return {};
}

function normalizeCommandAck(value = {}) {
  const ack = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = compactText(ack.status, 40).toLowerCase();
  if (!["completed", "failed"].includes(status)) {
    throw buildHttpError("Command ack status must be completed or failed.", 400);
  }
  const result = ack.result && typeof ack.result === "object" && !Array.isArray(ack.result)
    ? JSON.parse(JSON.stringify(ack.result))
    : {};
  return {
    commandId: compactText(ack.commandId || ack.command_id, 180),
    nodeId: compactText(ack.nodeId || ack.node_id, 180),
    leaseId: compactText(ack.leaseId || ack.lease_id, 180),
    status,
    result: result && typeof result === "object" && !Array.isArray(result) ? result : {},
    error: compactText(ack.error || ack.message, 500),
    generatedAt: compactText(ack.generatedAt || nowIso(), 80),
  };
}

function commandSigningEnvelope(command = {}) {
  return {
    schemaVersion: 1,
    id: command.id,
    nodeId: command.nodeId,
    ownerAccountId: command.ownerAccountId,
    operation: command.operation,
    scope: command.scope,
    target: command.target || {},
    payload: command.payload || {},
    clientCommandId: command.clientCommandId || "",
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
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

export class AccountNodeRegistryService {
  constructor({
    stateDir,
    now = () => new Date(),
    defaultOwnerAccountId = "local",
  } = {}) {
    if (!stateDir) {
      throw new Error("stateDir is required for AccountNodeRegistryService.");
    }
    this.storePath = path.join(stateDir, ACCOUNT_NODE_REGISTRY_FILENAME);
    this.now = now;
    this.defaultOwnerAccountId = normalizeOwnerAccountId(defaultOwnerAccountId);
    this.pairings = new Map();
    this.tokens = new Map();
    this.nodes = new Map();
    this.commands = new Map();
    this.accountSigningKey = generateSigningKeypair();
  }

  async initialize() {
    let parsed = {};
    try {
      parsed = await readJsonFile(this.storePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[swarmlab] could not read account node registry; starting empty", error?.message || error);
      }
    }

    this.pairings = new Map();
    this.tokens = new Map();
    this.nodes = new Map();
    this.commands = new Map();
    this.accountSigningKey = normalizeAccountSigningKey(parsed.accountSigningKey);
    for (const pairing of Array.isArray(parsed.pairings) ? parsed.pairings : []) {
      if (pairing?.id) this.pairings.set(pairing.id, { ...pairing });
    }
    for (const token of Array.isArray(parsed.tokens) ? parsed.tokens : []) {
      if (token?.tokenHash) this.tokens.set(token.tokenHash, { ...token });
    }
    for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : []) {
      if (node?.nodeId) this.nodes.set(node.nodeId, normalizeNodeRecord(node, node, { ownerAccountId: node.ownerAccountId }));
    }
    for (const command of Array.isArray(parsed.commands) ? parsed.commands : []) {
      if (command?.id) this.commands.set(command.id, cloneCommand(command));
    }
    await this.save();
  }

  async save() {
    await writeJsonFile(this.storePath, {
      version: ACCOUNT_NODE_REGISTRY_VERSION,
      pairings: [...this.pairings.values()],
      tokens: [...this.tokens.values()],
      nodes: [...this.nodes.values()],
      commands: [...this.commands.values()],
      accountSigningKey: this.accountSigningKey,
      updatedAt: nowIso(),
    });
  }

  getNowMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Date.now();
  }

  getNowIso() {
    const value = this.now();
    return value instanceof Date ? value.toISOString() : nowIso();
  }

  getAccountPublicKey() {
    return this.accountSigningKey.publicKey;
  }

  pruneExpiredCommands() {
    const nowMs = this.getNowMs();
    for (const command of this.commands.values()) {
      const expiresAtMs = Date.parse(command.expiresAt || "");
      if (["queued", "running"].includes(command.status) && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
        command.status = "expired";
        command.updatedAt = this.getNowIso();
      }
      const completedAtMs = Date.parse(command.completedAt || command.updatedAt || "");
      if (["completed", "failed", "expired", "canceled"].includes(command.status) && Number.isFinite(completedAtMs) && nowMs - completedAtMs > COMMAND_RESULT_TTL_MS) {
        this.commands.delete(command.id);
      }
    }
  }

  isExpired(pairing) {
    return Date.parse(pairing?.expiresAt || "") <= this.getNowMs();
  }

  getPairing(id) {
    const pairing = this.pairings.get(String(id || "").trim());
    return pairing ? { ...pairing, identity: { ...(pairing.identity || {}) }, connectionHints: [...(pairing.connectionHints || [])] } : null;
  }

  async createPairing({ label = "Swarmlab", redirectUri = "", identity = {}, connectionHints = [], ownerAccountId = "" } = {}) {
    const timestamp = this.getNowIso();
    const pairing = {
      id: `pair_${randomUUID()}`,
      pairingCode: randomBytes(4).toString("hex").toUpperCase().replace(/(.{4})/u, "$1-"),
      grantHash: "",
      ownerAccountId: normalizeOwnerAccountId(ownerAccountId || this.defaultOwnerAccountId),
      label: compactText(label || "Swarmlab", 120),
      redirectUri: compactText(redirectUri, 600),
      identity: normalizePublicIdentity(identity),
      connectionHints: normalizeConnectionHints(connectionHints),
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(this.getNowMs() + PAIRING_TTL_MS).toISOString(),
      approvedAt: "",
      claimedAt: "",
    };
    this.pairings.set(pairing.id, pairing);
    await this.save();
    return this.getPairing(pairing.id);
  }

  async approvePairing({ pairingId = "", pairingCode = "", ownerAccountId = "" } = {}) {
    const id = String(pairingId || "").trim();
    const pairing = this.pairings.get(id);
    if (!pairing) {
      throw buildHttpError("Pairing request not found.", 404);
    }
    if (this.isExpired(pairing)) {
      pairing.status = "expired";
      pairing.updatedAt = this.getNowIso();
      await this.save();
      throw buildHttpError("Pairing request expired.", 410);
    }
    const code = compactText(pairingCode, 40).toUpperCase();
    if (code && code !== String(pairing.pairingCode || "").toUpperCase()) {
      throw buildHttpError("Pairing code does not match.", 403);
    }
    const grant = randomToken("grant");
    pairing.grantHash = hashSecret(grant);
    pairing.ownerAccountId = normalizeOwnerAccountId(ownerAccountId || pairing.ownerAccountId || this.defaultOwnerAccountId);
    pairing.status = "approved";
    pairing.approvedAt = this.getNowIso();
    pairing.updatedAt = pairing.approvedAt;
    await this.save();
    return { pairing: this.getPairing(pairing.id), grant };
  }

  authenticateBearerToken(authorization = "") {
    const match = String(authorization || "").match(/^Bearer\s+(.+)$/iu);
    if (!match) {
      throw buildHttpError("Account bearer token is required.", 401);
    }
    const tokenHash = hashSecret(match[1]);
    const record = this.tokens.get(tokenHash);
    if (!record || record.revokedAt) {
      throw buildHttpError("Account bearer token is invalid.", 401);
    }
    return { ...record };
  }

  async completePairing({ grant = "", pairingId = "", ownerAccountId = "", identity = {}, connectionHints = [], label = "" } = {}) {
    const normalizedGrant = String(grant || "").trim();
    if (!normalizedGrant) {
      throw buildHttpError("Pairing grant is required.", 401);
    }
    const pairing = normalizedGrant
      ? [...this.pairings.values()].find((entry) => entry.grantHash && entry.grantHash === hashSecret(normalizedGrant))
      : this.pairings.get(String(pairingId || "").trim());
    if (!pairing) {
      throw buildHttpError("Pairing request not found.", 404);
    }
    if (this.isExpired(pairing)) {
      pairing.status = "expired";
      pairing.updatedAt = this.getNowIso();
      await this.save();
      throw buildHttpError("Pairing request expired.", 410);
    }
    if (pairing.status !== "approved") {
      throw buildHttpError("Pairing request has not been approved.", 409);
    }

    const publicIdentity = normalizePublicIdentity(identity);
    const pairingIdentity = normalizePublicIdentity(pairing.identity);
    const nodeId = publicIdentity.nodeId || pairingIdentity.nodeId;
    if (!nodeId) {
      throw buildHttpError("Pairing identity is missing nodeId.", 400);
    }
    const accessToken = randomToken("slnode");
    const tokenRecord = {
      tokenHash: hashSecret(accessToken),
      ownerAccountId: normalizeOwnerAccountId(ownerAccountId || pairing.ownerAccountId || this.defaultOwnerAccountId),
      nodeId,
      createdAt: this.getNowIso(),
      revokedAt: "",
    };
    this.tokens.set(tokenRecord.tokenHash, tokenRecord);

    const existing = this.nodes.get(nodeId);
    const node = normalizeNodeRecord({
      nodeId,
      installId: publicIdentity.installId || pairingIdentity.installId,
      publicKey: publicIdentity.publicKey || pairingIdentity.publicKey,
      displayName: label || pairing.label || "Swarmlab node",
      status: "online",
      lastSeenAt: this.getNowIso(),
      connectionHints: connectionHints?.length ? connectionHints : pairing.connectionHints,
      summary: {
        generatedAt: this.getNowIso(),
        node: {
          nodeId,
          installId: publicIdentity.installId || pairingIdentity.installId,
          displayName: label || pairing.label || "Swarmlab node",
        },
      },
    }, existing, { ownerAccountId: tokenRecord.ownerAccountId });
    this.nodes.set(node.nodeId, node);

    pairing.status = "claimed";
    pairing.claimedAt = this.getNowIso();
    pairing.updatedAt = pairing.claimedAt;
    await this.save();
    return {
      accessToken,
      account: {
        id: tokenRecord.ownerAccountId,
        login: tokenRecord.ownerAccountId,
        commandPublicKey: this.getAccountPublicKey(),
      },
      commandPublicKey: this.getAccountPublicKey(),
      node: this.presentNode(node),
    };
  }

  presentNode(node) {
    const cloned = cloneNode(node);
    const preferredHint = preferredConnectionHint(cloned.connectionHints);
    const lastSeenMs = Date.parse(cloned.lastSeenAt || "");
    const ageMs = Number.isFinite(lastSeenMs) ? this.getNowMs() - lastSeenMs : Infinity;
    const status = cloned.disconnectedAt
      ? "offline"
      : ageMs > NODE_OFFLINE_MS
      ? "offline"
      : ageMs > NODE_STALE_MS
      ? "stale"
      : normalizeStatus(cloned.status, "unknown");
    return {
      id: cloned.id,
      nodeId: cloned.nodeId,
      installId: cloned.installId,
      displayName: cloned.displayName,
      label: cloned.displayName,
      status,
      lastSeenAt: cloned.lastSeenAt,
      os: cloned.os,
      arch: cloned.arch,
      swarmlabVersion: cloned.swarmlabVersion,
      commit: cloned.commit,
      branch: cloned.branch,
      hostnameHash: cloned.hostnameHash,
      baseUrl: preferredHint.url || "",
      url: preferredHint.url || "",
      connectionHints: cloned.connectionHints,
      counts: cloned.counts,
      capabilities: cloned.capabilities,
      launchers: cloned.launchers,
      system: cloned.system,
      summary: cloned.summary,
      updatedAt: cloned.updatedAt,
    };
  }

  listNodesForToken(authorization = "") {
    const token = this.authenticateBearerToken(authorization);
    return this.listNodesForOwner(token.ownerAccountId);
  }

  listNodesForOwner(ownerAccountId = "") {
    const owner = normalizeOwnerAccountId(ownerAccountId || this.defaultOwnerAccountId);
    return [...this.nodes.values()]
      .filter((node) => node.ownerAccountId === owner)
      .map((node) => this.presentNode(node))
      .sort((left, right) => String(right.lastSeenAt || right.updatedAt || "").localeCompare(String(left.lastSeenAt || left.updatedAt || "")));
  }

  async registerNode({ authorization = "", body = {} } = {}) {
    const token = this.authenticateBearerToken(authorization);
    const registration = body?.registration && typeof body.registration === "object" ? body.registration : {};
    const signature = String(body?.signature || "").trim();
    const unsigned = { type: "node.registration", registration };
    const existing = this.nodes.get(registration.nodeId);
    const trustedPublicKey = existing?.publicKey || registration.publicKey;
    if (existing?.publicKey && registration.publicKey && existing.publicKey !== registration.publicKey) {
      throw buildHttpError("Node registration public key does not match pairing identity.", 403);
    }
    if (!verifyNodeSignature(unsigned, signature, trustedPublicKey)) {
      throw buildHttpError("Node registration signature is invalid.", 403);
    }
    if (token.nodeId && registration.nodeId && token.nodeId !== registration.nodeId) {
      throw buildHttpError("Node token does not match registration node.", 403);
    }

    const node = normalizeNodeRecord({
      nodeId: registration.nodeId,
      installId: registration.installId,
      publicKey: registration.publicKey,
      displayName: registration.displayName,
      connectionHints: registration.connectionHints,
      summary: registration.summary,
      status: registration.summary?.status || "online",
      disconnectedAt: "",
    }, existing, { ownerAccountId: token.ownerAccountId });
    this.nodes.set(node.nodeId, node);
    await this.save();
    return this.presentNode(node);
  }

  async recordHeartbeat({ authorization = "", nodeId = "", body = {} } = {}) {
    const token = this.authenticateBearerToken(authorization);
    const heartbeat = body?.heartbeat && typeof body.heartbeat === "object" ? body.heartbeat : {};
    const heartbeatSummary = heartbeat.summary && typeof heartbeat.summary === "object" && !Array.isArray(heartbeat.summary)
      ? heartbeat.summary
      : {};
    const requestedNodeId = compactText(nodeId || heartbeat.nodeId, 160);
    if (!requestedNodeId || requestedNodeId !== token.nodeId) {
      throw buildHttpError("Node token does not match heartbeat node.", 403);
    }
    const existing = this.nodes.get(requestedNodeId);
    if (!existing?.publicKey) {
      throw buildHttpError("Node is not registered.", 404);
    }
    const signature = String(heartbeat.signature || "").trim();
    const unsigned = { ...heartbeat };
    delete unsigned.signature;
    if (!verifyNodeSignature({ type: "node.heartbeat", heartbeat: unsigned }, signature, existing.publicKey)) {
      throw buildHttpError("Node heartbeat signature is invalid.", 403);
    }

    const node = normalizeNodeRecord({
      nodeId: requestedNodeId,
      installId: heartbeat.installId,
      publicKey: existing.publicKey,
      displayName: heartbeat.displayName,
      status: heartbeat.status,
      lastSeenAt: heartbeat.generatedAt || this.getNowIso(),
      connectionHints: heartbeat.connectionHints,
      counts: heartbeat.counts,
      capabilities: heartbeat.capabilities,
      launchers: heartbeat.launchers,
      system: heartbeat.system,
      swarmlabVersion: heartbeat.swarmlabVersion,
      commit: heartbeat.commit,
      branch: heartbeat.branch,
      os: heartbeat.os,
      arch: heartbeat.arch,
      hostnameHash: heartbeat.hostnameHash,
      summary: {
        generatedAt: heartbeat.generatedAt || this.getNowIso(),
        node: {
          nodeId: requestedNodeId,
          installId: heartbeat.installId,
          displayName: heartbeat.displayName,
          swarmlabVersion: heartbeat.swarmlabVersion,
          commit: heartbeat.commit,
          branch: heartbeat.branch,
          os: heartbeat.os,
          arch: heartbeat.arch,
          hostnameHash: heartbeat.hostnameHash,
        },
        status: heartbeat.status,
        counts: heartbeat.counts,
        capabilities: heartbeat.capabilities,
        launchers: heartbeat.launchers,
        sessions: Array.isArray(heartbeatSummary.sessions)
          ? heartbeatSummary.sessions
          : Array.isArray(heartbeat.sessions)
          ? heartbeat.sessions
          : existing.summary?.sessions || [],
        system: heartbeat.system,
        degraded: heartbeat.degraded,
      },
      disconnectedAt: "",
    }, existing, { ownerAccountId: token.ownerAccountId });
    this.nodes.set(node.nodeId, node);
    await this.save();
    const pendingCommands = this.countPendingCommandsForNode(token.nodeId);
    return {
      node: this.presentNode(node),
      pendingCommands,
    };
  }

  async disconnectToken(authorization = "") {
    const token = this.authenticateBearerToken(authorization);
    const existing = this.nodes.get(token.nodeId);
    if (existing) {
      this.nodes.set(existing.nodeId, normalizeNodeRecord({
        ...existing,
        status: "offline",
        disconnectedAt: this.getNowIso(),
      }, existing, { ownerAccountId: existing.ownerAccountId }));
    }
    const stored = this.tokens.get(token.tokenHash);
    if (stored) {
      stored.revokedAt = this.getNowIso();
    }
    await this.save();
    return true;
  }

  countPendingCommandsForNode(nodeId = "") {
    this.pruneExpiredCommands();
    const normalizedNodeId = compactText(nodeId, 160);
    return [...this.commands.values()].filter((command) =>
      command.nodeId === normalizedNodeId && ["queued", "running"].includes(command.status)
    ).length;
  }

  presentCommandForOwner(command) {
    const cloned = cloneCommand(command);
    return {
      id: cloned.id,
      nodeId: cloned.nodeId,
      operation: cloned.operation,
      status: cloned.status,
      target: cloned.target || {},
      clientCommandId: cloned.clientCommandId || "",
      createdAt: cloned.createdAt,
      updatedAt: cloned.updatedAt,
      expiresAt: cloned.expiresAt,
      claimedAt: cloned.claimedAt || "",
      completedAt: cloned.completedAt || "",
      result: cloned.result && typeof cloned.result === "object" ? cloned.result : {},
      error: cloned.error || "",
    };
  }

  presentCommandForNode(command) {
    const cloned = cloneCommand(command);
    return {
      ...commandSigningEnvelope(cloned),
      signature: cloned.signature,
      leaseId: cloned.leaseId || "",
      leaseExpiresAt: cloned.leaseExpiresAt || "",
    };
  }

  getCommandForOwner({ ownerAccountId = "", nodeId = "", commandId = "" } = {}) {
    this.pruneExpiredCommands();
    const owner = normalizeOwnerAccountId(ownerAccountId || this.defaultOwnerAccountId);
    const command = this.commands.get(String(commandId || "").trim());
    if (!command || command.ownerAccountId !== owner || command.nodeId !== compactText(nodeId, 160)) {
      throw buildHttpError("Account node command not found.", 404);
    }
    return this.presentCommandForOwner(command);
  }

  listCommandsForOwner({ ownerAccountId = "", nodeId = "", limit = 50 } = {}) {
    this.pruneExpiredCommands();
    const owner = normalizeOwnerAccountId(ownerAccountId || this.defaultOwnerAccountId);
    const normalizedNodeId = compactText(nodeId, 160);
    return [...this.commands.values()]
      .filter((command) => command.ownerAccountId === owner && command.nodeId === normalizedNodeId)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)))
      .map((command) => this.presentCommandForOwner(command));
  }

  async enqueueCommandForOwner({ ownerAccountId = "", nodeId = "", body = {} } = {}) {
    this.pruneExpiredCommands();
    const owner = normalizeOwnerAccountId(ownerAccountId || this.defaultOwnerAccountId);
    const normalizedNodeId = compactText(nodeId || body?.nodeId || body?.node_id, 160);
    const node = this.nodes.get(normalizedNodeId);
    if (!node || node.ownerAccountId !== owner) {
      throw buildHttpError("Account node not found.", 404);
    }
    if (node.disconnectedAt) {
      throw buildHttpError("Account node is disconnected.", 409);
    }
    const operation = normalizeCommandOperation(body?.operation || body?.type);
    const payload = normalizeCommandPayload(operation, body?.payload || body);
    const timestamp = this.getNowIso();
    const command = {
      schemaVersion: 1,
      id: `cmd_${randomUUID()}`,
      ownerAccountId: owner,
      nodeId: normalizedNodeId,
      operation,
      scope: operation,
      target: commandTargetFromPayload(operation, payload),
      payload,
      clientCommandId: compactText(body?.clientCommandId || body?.client_command_id, 180),
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(this.getNowMs() + COMMAND_TTL_MS).toISOString(),
      claimedAt: "",
      leaseId: "",
      leaseExpiresAt: "",
      deliveryAttempts: 0,
      completedAt: "",
      result: {},
      error: "",
      signature: "",
    };
    command.signature = signAccountCommandPayload({
      type: "node.command",
      command: commandSigningEnvelope(command),
    }, this.accountSigningKey.privateKey);
    this.commands.set(command.id, command);
    await this.save();
    return this.presentCommandForOwner(command);
  }

  async leaseCommandsForNode({ authorization = "", nodeId = "", limit = 10 } = {}) {
    this.pruneExpiredCommands();
    const token = this.authenticateBearerToken(authorization);
    const normalizedNodeId = compactText(nodeId || token.nodeId, 160);
    if (!normalizedNodeId || normalizedNodeId !== token.nodeId) {
      throw buildHttpError("Node token does not match command node.", 403);
    }
    const nowMs = this.getNowMs();
    const max = Math.max(1, Math.min(25, Number(limit) || 10));
    const leased = [];
    for (const command of [...this.commands.values()].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))) {
      if (leased.length >= max) break;
      if (command.nodeId !== normalizedNodeId || command.ownerAccountId !== token.ownerAccountId) continue;
      if (command.status === "running" && Date.parse(command.leaseExpiresAt || "") > nowMs) continue;
      if (!["queued", "running"].includes(command.status)) continue;
      command.status = "running";
      command.leaseId = randomToken("lease");
      command.claimedAt = this.getNowIso();
      command.leaseExpiresAt = new Date(nowMs + COMMAND_LEASE_MS).toISOString();
      command.updatedAt = command.claimedAt;
      command.deliveryAttempts = normalizeNumber(command.deliveryAttempts) + 1;
      leased.push(this.presentCommandForNode(command));
    }
    if (leased.length) {
      await this.save();
    }
    return leased;
  }

  async acknowledgeCommandFromNode({ authorization = "", nodeId = "", commandId = "", body = {} } = {}) {
    this.pruneExpiredCommands();
    const token = this.authenticateBearerToken(authorization);
    const normalizedNodeId = compactText(nodeId || token.nodeId, 160);
    if (!normalizedNodeId || normalizedNodeId !== token.nodeId) {
      throw buildHttpError("Node token does not match command node.", 403);
    }
    const command = this.commands.get(String(commandId || "").trim());
    if (!command || command.nodeId !== normalizedNodeId || command.ownerAccountId !== token.ownerAccountId) {
      throw buildHttpError("Account node command not found.", 404);
    }
    const node = this.nodes.get(normalizedNodeId);
    if (!node?.publicKey) {
      throw buildHttpError("Node is not registered.", 404);
    }
    const ack = normalizeCommandAck(body?.ack || body);
    const signature = String(body?.signature || ack.signature || "").trim();
    const unsignedAck = { ...ack };
    delete unsignedAck.signature;
    if (ack.commandId !== command.id || ack.nodeId !== normalizedNodeId) {
      throw buildHttpError("Command ack does not match command.", 403);
    }
    if (command.leaseId && ack.leaseId !== command.leaseId) {
      throw buildHttpError("Command ack lease does not match.", 403);
    }
    if (!verifyNodeSignature({ type: "node.command.ack", ack: unsignedAck }, signature, node.publicKey)) {
      throw buildHttpError("Command ack signature is invalid.", 403);
    }
    command.status = ACCOUNT_NODE_COMMAND_STATUSES.has(ack.status) ? ack.status : "failed";
    command.result = ack.result && typeof ack.result === "object" ? ack.result : {};
    command.error = ack.error || "";
    command.completedAt = ack.generatedAt || this.getNowIso();
    command.updatedAt = this.getNowIso();
    command.ackSignature = signature;
    await this.save();
    return this.presentCommandForOwner(command);
  }
}

export {
  ACCOUNT_NODE_REGISTRY_FILENAME,
  ACCOUNT_NODE_REGISTRY_VERSION,
};
