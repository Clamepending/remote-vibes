import { promises as fsPromises } from "node:fs";
import path from "node:path";

const STORE_FILENAME = "github-oauth.json";
const STORE_VERSION = 1;
const FILE_MODE = 0o600;
const DEFAULT_INTEGRATION_ID = "buildinghub";

function normalizeIntegrationId(value) {
  return String(value || DEFAULT_INTEGRATION_ID).trim() || DEFAULT_INTEGRATION_ID;
}

function normalizeScopes(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }

  const id = String(profile.id || "").trim();
  const login = String(profile.login || profile.username || "").trim();
  const name = String(profile.name || profile.displayName || "").trim();
  const profileUrl = String(profile.profileUrl || profile.htmlUrl || profile.url || "").trim();
  const avatarUrl = String(profile.avatarUrl || profile.avatar_url || "").trim();

  if (!id && !login && !name && !profileUrl) {
    return null;
  }

  return {
    id,
    login,
    name,
    profileUrl,
    avatarUrl,
  };
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const accessToken = String(record.accessToken || "").trim();
  const tokenType = String(record.tokenType || "bearer").trim().toLowerCase() || "bearer";
  const scopes = normalizeScopes(record.scopes || record.scope);
  const profile = normalizeProfile(record.profile || record.user);

  if (!accessToken && !profile) {
    return null;
  }

  return {
    accessToken,
    tokenType,
    scopes,
    profile,
  };
}

export class GitHubOAuthTokenStore {
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
      for (const [integrationId, record] of Object.entries(records)) {
        const normalizedId = normalizeIntegrationId(integrationId);
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
    for (const [integrationId, record] of this.tokens.entries()) {
      tokensObject[integrationId] = {
        accessToken: record.accessToken || "",
        tokenType: record.tokenType || "bearer",
        scopes: normalizeScopes(record.scopes),
        profile: normalizeProfile(record.profile) || null,
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

  getTokens(integrationId = DEFAULT_INTEGRATION_ID) {
    const normalizedId = normalizeIntegrationId(integrationId);
    const record = this.tokens.get(normalizedId);
    return record
      ? {
          ...record,
          scopes: [...record.scopes],
          profile: record.profile ? { ...record.profile } : null,
        }
      : null;
  }

  async setTokens(integrationId = DEFAULT_INTEGRATION_ID, { accessToken, tokenType, scopes, profile } = {}) {
    const normalizedId = normalizeIntegrationId(integrationId);
    const existing = this.tokens.get(normalizedId) || {};
    const merged = {
      accessToken: String(accessToken || existing.accessToken || "").trim(),
      tokenType: String(tokenType || existing.tokenType || "bearer").trim().toLowerCase() || "bearer",
      scopes: Array.isArray(scopes) ? normalizeScopes(scopes) : normalizeScopes(existing.scopes || []),
      profile: normalizeProfile(profile) || normalizeProfile(existing.profile) || null,
    };

    this.tokens.set(normalizedId, merged);
    await this.save();
    return this.getTokens(normalizedId);
  }

  async clearTokens(integrationId = DEFAULT_INTEGRATION_ID) {
    const normalizedId = normalizeIntegrationId(integrationId);
    const removed = this.tokens.delete(normalizedId);
    if (removed) {
      await this.save();
    }
    return removed;
  }

  getStatus(integrationId = DEFAULT_INTEGRATION_ID) {
    const record = this.getTokens(integrationId);
    return {
      configured: Boolean(record?.accessToken),
      scopes: record?.scopes || [],
      user: record?.profile || null,
    };
  }
}

