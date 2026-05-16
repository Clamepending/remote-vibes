import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_FILENAME = "app-instances.json";
const STORE_VERSION = 1;
const MAX_INSTANCES = 80;

function nowIso(now) {
  return now().toISOString();
}

function stableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function compactText(value, max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

function normalizeInstance(value = {}) {
  const appId = compactText(value.appId || value.launcherId || value.id, 80);
  if (!appId) return null;
  const launchedAt = compactText(value.launchedAt || value.createdAt || "", 40);
  const updatedAt = compactText(value.updatedAt || launchedAt || "", 40);
  const dismissedAt = compactText(value.dismissedAt || "", 40);
  return {
    id: compactText(value.id || `appinst_${stableHash(`${appId}:${launchedAt}:${value.clientCommandId || ""}`)}`, 80),
    appId,
    launcherId: compactText(value.launcherId || appId, 80),
    label: compactText(value.label || value.title || appId, 100),
    kind: compactText(value.kind || "desktop-app", 40),
    category: compactText(value.category || "app", 40),
    surface: compactText(value.surface || value.canvasSurface || value.appSurface || "", 80),
    status: compactText(value.status || "launched", 40),
    source: compactText(value.source || "local", 40),
    clientCommandId: compactText(value.clientCommandId || "", 160),
    url: compactText(value.url || value.href || "", 2048),
    launchCount: Math.max(1, Math.round(Number(value.launchCount || 1))),
    launchedAt,
    updatedAt,
    dismissedAt,
  };
}

function appInstanceIdentityMatches(entry = {}, candidate = {}) {
  if (!entry || !candidate) return false;
  if (entry.appId !== candidate.appId) return false;
  if ((entry.source || "local") !== (candidate.source || "local")) return false;
  const entryUrl = String(entry.url || "").trim();
  const candidateUrl = String(candidate.url || "").trim();
  if (entryUrl || candidateUrl) return entryUrl === candidateUrl;
  return true;
}

function isDismissedInstance(instance = {}) {
  return compactText(instance.status || "", 40).toLowerCase() === "dismissed" || Boolean(instance.dismissedAt);
}

function normalizePayload(payload = {}) {
  const instances = Array.isArray(payload.instances)
    ? payload.instances
    : Array.isArray(payload.appInstances)
      ? payload.appInstances
      : [];
  return instances
    .map(normalizeInstance)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))
    .slice(0, MAX_INSTANCES);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

export class AppInstanceStore {
  constructor({ stateDir, now = () => new Date() } = {}) {
    if (!stateDir) {
      throw new Error("stateDir is required for AppInstanceStore.");
    }
    this.storePath = path.join(stateDir, STORE_FILENAME);
    this.now = now;
    this.instances = [];
  }

  async initialize() {
    try {
      this.instances = normalizePayload(await readJson(this.storePath));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      this.instances = [];
    }
  }

  listInstances({ limit = MAX_INSTANCES, includeDismissed = false } = {}) {
    const safeLimit = Math.max(0, Math.min(MAX_INSTANCES, Math.round(Number(limit) || MAX_INSTANCES)));
    const instances = includeDismissed
      ? this.instances
      : this.instances.filter((instance) => !isDismissedInstance(instance));
    return clone(instances.slice(0, safeLimit));
  }

  async recordLaunch({ launcherId = "", launcher = {}, result = {}, clientCommandId = "", source = "local" } = {}) {
    const resultLauncher = result?.launcher && typeof result.launcher === "object" ? result.launcher : {};
    const launcherSummary = { ...launcher, ...resultLauncher };
    const appId = compactText(launcherSummary.appId || launcherSummary.id || launcherId, 80);
    if (!appId) {
      throw new Error("App launcher id is required.");
    }

    const now = nowIso(this.now);
    const commandId = compactText(clientCommandId || result?.clientCommandId || "", 160);
    const candidate = normalizeInstance({
      appId,
      launcherId: compactText(launcherSummary.id || launcherId || appId, 80),
      label: launcherSummary.label || appId,
      kind: launcherSummary.kind || "desktop-app",
      category: launcherSummary.category || "app",
      surface: result?.surface || launcherSummary.canvasSurface || launcherSummary.surface || "",
      status: result?.launched === false ? "requested" : "launched",
      source,
      clientCommandId: commandId,
      url: result?.url || result?.href || launcherSummary.url || launcherSummary.href || "",
      launchedAt: now,
      updatedAt: now,
    });
    const existingIndexByCommand = commandId
      ? this.instances.findIndex((entry) => entry.clientCommandId === commandId)
      : -1;
    const existingIndex = existingIndexByCommand >= 0
      ? existingIndexByCommand
      : this.instances.findIndex((entry) => appInstanceIdentityMatches(entry, candidate));
    const existing = existingIndex >= 0 ? this.instances[existingIndex] : null;
    const id = existing?.id || `appinst_${stableHash(commandId || `${appId}:${now}:${randomUUID()}`)}`;
    const instance = normalizeInstance({
      ...candidate,
      id,
      source,
      clientCommandId: commandId,
      url: candidate.url || existing?.url || "",
      launchCount: (existing?.launchCount || 0) + 1,
      launchedAt: existing?.launchedAt || now,
      updatedAt: now,
    });

    this.instances = [
      instance,
      ...this.instances.filter((entry, index) => index !== existingIndex && entry.id !== instance.id),
    ].slice(0, MAX_INSTANCES);
    await this.save();
    return clone(instance);
  }

  async dismissInstance(instanceId = "") {
    const rawId = compactText(instanceId, 160);
    if (!rawId) return null;
    const idCandidates = new Set([
      rawId,
      rawId.replace(/^app-instance:/u, ""),
    ]);
    const index = this.instances.findIndex((entry) =>
      idCandidates.has(entry.id) ||
      Boolean(entry.clientCommandId && idCandidates.has(entry.clientCommandId)),
    );
    if (index < 0) return null;

    const now = nowIso(this.now);
    const instance = normalizeInstance({
      ...this.instances[index],
      status: "dismissed",
      dismissedAt: now,
      updatedAt: now,
    });
    this.instances = [
      instance,
      ...this.instances.filter((entry, entryIndex) => entryIndex !== index && entry.id !== instance.id),
    ].slice(0, MAX_INSTANCES);
    await this.save();
    return clone(instance);
  }

  async save() {
    await writeJson(this.storePath, {
      schemaVersion: STORE_VERSION,
      updatedAt: nowIso(this.now),
      instances: this.instances,
    });
  }
}
