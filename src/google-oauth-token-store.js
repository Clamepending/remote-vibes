import { promises as fsPromises } from "node:fs";
import path from "node:path";

const STORE_FILENAME = "google-tokens.json";
const STORE_VERSION = 1;
const FILE_MODE = 0o600;

function normalizeBuildingId(value) {
  return String(value || "").trim();
}

function normalizeScopes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const accessToken = String(record.accessToken || "").trim();
  const refreshToken = String(record.refreshToken || "").trim();
  const expiresAt = Number.isFinite(Number(record.expiresAt)) ? Number(record.expiresAt) : 0;
  const scopes = normalizeScopes(record.scopes);
  if (!accessToken && !refreshToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes,
  };
}

export class GoogleOAuthTokenStore {
  constructor({ stateDir, fsImpl = fsPromises } = {}) {
    this.stateDir = stateDir || "";
    this.fs = fsImpl;
    this.storePath = stateDir ? path.join(stateDir, STORE_FILENAME) : "";
    this.tokens = new Map();
    this.loaded = false;
  }

  async load() {
    if (!this.storePath) {
      this.loaded = true;
      return;
    }

    try {
      const raw = await this.fs.readFile(this.storePath, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const records = parsed && typeof parsed === "object" ? parsed.tokens || {} : {};
      this.tokens = new Map();
      for (const [buildingId, record] of Object.entries(records)) {
        const normalizedId = normalizeBuildingId(buildingId);
        const normalizedRecord = normalizeRecord(record);
        if (normalizedId && normalizedRecord) {
          this.tokens.set(normalizedId, normalizedRecord);
        }
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.tokens = new Map();
      } else {
        throw error;
      }
    } finally {
      this.loaded = true;
    }
  }

  async save() {
    if (!this.storePath) {
      return;
    }

    await this.fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const tokensObject = {};
    for (const [buildingId, record] of this.tokens.entries()) {
      tokensObject[buildingId] = {
        accessToken: record.accessToken || "",
        refreshToken: record.refreshToken || "",
        expiresAt: Number.isFinite(Number(record.expiresAt)) ? Number(record.expiresAt) : 0,
        scopes: normalizeScopes(record.scopes),
      };
    }

    const payload = {
      version: STORE_VERSION,
      tokens: tokensObject,
    };

    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await this.fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: FILE_MODE,
    });
    try {
      await this.fs.chmod(tempPath, FILE_MODE);
    } catch {
      // chmod may not be supported by the fs impl; writeFile with mode is enough in practice.
    }
    await this.fs.rename(tempPath, this.storePath);
    try {
      await this.fs.chmod(this.storePath, FILE_MODE);
    } catch {
      // Ignore chmod failures on non-POSIX filesystems.
    }
  }

  getTokens(buildingId) {
    const normalizedId = normalizeBuildingId(buildingId);
    if (!normalizedId) {
      return null;
    }
    const record = this.tokens.get(normalizedId);
    return record ? { ...record, scopes: [...record.scopes] } : null;
  }

  async setTokens(buildingId, { accessToken, refreshToken, expiresAt, scopes } = {}) {
    const normalizedId = normalizeBuildingId(buildingId);
    if (!normalizedId) {
      throw new Error("Building id is required to store Google OAuth tokens.");
    }

    const existing = this.tokens.get(normalizedId) || {};
    const nextRefreshToken = refreshToken
      ? String(refreshToken).trim()
      : existing.refreshToken || "";

    const merged = {
      accessToken: String(accessToken || existing.accessToken || "").trim(),
      refreshToken: nextRefreshToken,
      expiresAt: Number.isFinite(Number(expiresAt))
        ? Number(expiresAt)
        : Number(existing.expiresAt || 0),
      scopes: Array.isArray(scopes) ? normalizeScopes(scopes) : normalizeScopes(existing.scopes || []),
    };

    this.tokens.set(normalizedId, merged);
    await this.save();
    return { ...merged, scopes: [...merged.scopes] };
  }

  async clearTokens(buildingId) {
    const normalizedId = normalizeBuildingId(buildingId);
    if (!normalizedId) {
      return false;
    }
    const removed = this.tokens.delete(normalizedId);
    if (removed) {
      await this.save();
    }
    return removed;
  }

  getStatus() {
    const status = {};
    for (const [buildingId, record] of this.tokens.entries()) {
      status[buildingId] = {
        configured: Boolean(record.accessToken || record.refreshToken),
        scopes: [...record.scopes],
      };
    }
    return status;
  }
}
