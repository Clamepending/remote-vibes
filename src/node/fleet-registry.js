import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FLEET_REGISTRY_VERSION = 1;
const FLEET_REGISTRY_FILENAME = "fleet-registry.json";

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
  return ["manual", "query", "import", "account"].includes(source) ? source : "manual";
}

function normalizeTimestamp(value, fallback) {
  const timestamp = String(value || "").trim();
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : fallback;
}

function normalizeFleetNodeRecord(value = {}, existing = null) {
  const url = normalizeFleetNodeUrl(value.url || value.baseUrl || value.href);
  if (!url) {
    throw buildHttpError("A valid http(s) Swarmlab machine URL is required.", 400);
  }
  const timestamp = nowIso();
  const label = normalizeLabel(value.label || value.name || existing?.label);
  return {
    id: existing?.id || fleetNodeIdForUrl(url),
    url,
    baseUrl: url,
    label,
    source: normalizeSource(value.source || existing?.source),
    addedAt: normalizeTimestamp(existing?.addedAt || value.addedAt, timestamp),
    updatedAt: normalizeTimestamp(value.updatedAt, timestamp),
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
      .map((node) => ({ ...node }))
      .sort((left, right) => String(left.addedAt).localeCompare(String(right.addedAt)));
  }

  async addNode(input = {}) {
    const url = normalizeFleetNodeUrl(input.url || input.baseUrl || input.href);
    if (!url) {
      throw buildHttpError("A valid http(s) Swarmlab machine URL is required.", 400);
    }
    const node = normalizeFleetNodeRecord({ ...input, url }, this.nodes.get(url));
    this.nodes.set(url, node);
    await this.save();
    return { ...node };
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
