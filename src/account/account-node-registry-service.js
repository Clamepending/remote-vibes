import { createHash, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeNodePayload } from "../node/identity-store.js";
import { buildNodeSummaryFromSnapshot, normalizeConnectionHints } from "./account-service.js";

const ACCOUNT_NODE_REGISTRY_VERSION = 1;
const ACCOUNT_NODE_REGISTRY_FILENAME = "account-node-registry.json";
const PAIRING_TTL_MS = 15 * 60 * 1000;
const NODE_STALE_MS = 2 * 60 * 1000;
const NODE_OFFLINE_MS = 10 * 60 * 1000;
const ACCOUNT_NODE_STATUSES = new Set(["online", "idle", "busy", "stale", "offline", "unreachable", "unknown"]);

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
    buildingCount: normalizeNumber(value.buildingCount),
    gpuCount: normalizeNumber(value.gpuCount),
    cameraCount: normalizeNumber(value.cameraCount),
    handoffCount: normalizeNumber(value.handoffCount),
    brainNoteCount: normalizeNumber(value.brainNoteCount),
    hasTailscale: Boolean(value.hasTailscale),
    roles: normalizeRoles(value.roles),
  };
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
    system: node.system && typeof node.system === "object" ? { ...node.system } : null,
    summary: node.summary && typeof node.summary === "object"
      ? JSON.parse(JSON.stringify(node.summary))
      : null,
  };
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
    for (const pairing of Array.isArray(parsed.pairings) ? parsed.pairings : []) {
      if (pairing?.id) this.pairings.set(pairing.id, { ...pairing });
    }
    for (const token of Array.isArray(parsed.tokens) ? parsed.tokens : []) {
      if (token?.tokenHash) this.tokens.set(token.tokenHash, { ...token });
    }
    for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : []) {
      if (node?.nodeId) this.nodes.set(node.nodeId, normalizeNodeRecord(node, node, { ownerAccountId: node.ownerAccountId }));
    }
    await this.save();
  }

  async save() {
    await writeJsonFile(this.storePath, {
      version: ACCOUNT_NODE_REGISTRY_VERSION,
      pairings: [...this.pairings.values()],
      tokens: [...this.tokens.values()],
      nodes: [...this.nodes.values()],
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
      },
      node: this.presentNode(node),
    };
  }

  presentNode(node) {
    const cloned = cloneNode(node);
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
      baseUrl: cloned.connectionHints[0]?.url || "",
      url: cloned.connectionHints[0]?.url || "",
      connectionHints: cloned.connectionHints,
      counts: cloned.counts,
      capabilities: cloned.capabilities,
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
        system: heartbeat.system,
        degraded: heartbeat.degraded,
      },
      disconnectedAt: "",
    }, existing, { ownerAccountId: token.ownerAccountId });
    this.nodes.set(node.nodeId, node);
    await this.save();
    return this.presentNode(node);
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
}

export {
  ACCOUNT_NODE_REGISTRY_FILENAME,
  ACCOUNT_NODE_REGISTRY_VERSION,
};
