import { generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const NODE_IDENTITY_VERSION = 1;
const NODE_IDENTITY_FILENAME = "node.json";

function nowIso() {
  return new Date().toISOString();
}

function atomicPath(targetPath) {
  return `${targetPath}.${process.pid}.${Date.now()}.tmp`;
}

function normalizeIdentityRecord(value = {}) {
  const nodeId = typeof value.nodeId === "string" && value.nodeId.trim()
    ? value.nodeId.trim()
    : randomUUID();
  const installId = typeof value.installId === "string" && value.installId.trim()
    ? value.installId.trim()
    : randomUUID();
  const { publicKey, privateKey } =
    typeof value.publicKey === "string" && value.publicKey.trim() &&
    typeof value.privateKey === "string" && value.privateKey.trim()
      ? { publicKey: value.publicKey, privateKey: value.privateKey }
      : generateSigningKeypair();
  const localApiToken = typeof value.localApiToken === "string" && value.localApiToken.trim()
    ? value.localApiToken.trim()
    : randomBytes(32).toString("base64url");
  const createdAt = typeof value.createdAt === "string" && value.createdAt.trim()
    ? value.createdAt.trim()
    : nowIso();

  return {
    version: NODE_IDENTITY_VERSION,
    nodeId,
    installId,
    publicKey,
    privateKey,
    localApiToken,
    createdAt,
    updatedAt: nowIso(),
  };
}

function generateSigningKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "pem", type: "spki" }),
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = atomicPath(filePath);
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

export class NodeIdentityStore {
  constructor({ stateDir, hostname = os.hostname } = {}) {
    if (!stateDir) {
      throw new Error("stateDir is required for NodeIdentityStore.");
    }
    this.stateDir = stateDir;
    this.hostnameProvider = typeof hostname === "function" ? hostname : () => String(hostname || "");
    this.identityPath = path.join(stateDir, NODE_IDENTITY_FILENAME);
    this.record = null;
  }

  async initialize() {
    let source = {};
    try {
      source = await readJsonFile(this.identityPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[swarmlab] could not read node identity; regenerating", error?.message || error);
      }
    }

    this.record = normalizeIdentityRecord(source);
    await writeJsonFile(this.identityPath, this.record);
    return this.getRecord();
  }

  getRecord() {
    if (!this.record) {
      throw new Error("Node identity has not been initialized.");
    }
    return { ...this.record };
  }

  getLocalApiToken() {
    return this.getRecord().localApiToken;
  }

  verifyLocalApiToken(token) {
    const candidate = String(token || "").trim();
    return Boolean(candidate && candidate === this.getLocalApiToken());
  }

  getPublicIdentity({ includeHostname = false } = {}) {
    const record = this.getRecord();
    return {
      nodeId: record.nodeId,
      installId: record.installId,
      publicKey: record.publicKey,
      createdAt: record.createdAt,
      ...(includeHostname ? { hostname: this.hostnameProvider() } : {}),
    };
  }

  signPayload(payload) {
    const record = this.getRecord();
    return sign(null, Buffer.from(stableStringify(payload)), record.privateKey).toString("base64url");
  }

  verifyPayloadSignature(payload, signature) {
    const record = this.getRecord();
    const signatureBuffer = Buffer.from(String(signature || ""), "base64url");
    if (!signatureBuffer.length) {
      return false;
    }
    return verify(null, Buffer.from(stableStringify(payload)), record.publicKey, signatureBuffer);
  }
}

export { stableStringify as canonicalizeNodePayload };
