import { promises as fsPromises } from "node:fs";
import path from "node:path";

const STORE_FILENAME = "buildinghub-account.json";
const STORE_VERSION = 1;
const FILE_MODE = 0o600;

function normalizeUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function normalizeAccount(account = {}) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return null;
  }

  const id = String(account.id || "").trim();
  const login = String(account.login || account.username || "").trim();
  const name = String(account.name || account.displayName || "").trim();
  const profileUrl = normalizeUrl(account.profileUrl || account.url || account.htmlUrl);
  const avatarUrl = normalizeUrl(account.avatarUrl || account.avatar_url);
  const githubLogin = String(account.githubLogin || "").trim();
  const githubProfileUrl = normalizeUrl(account.githubProfileUrl);

  if (!id && !login && !name && !profileUrl) {
    return null;
  }

  return {
    id,
    login,
    name,
    profileUrl,
    avatarUrl,
    githubLogin,
    githubProfileUrl,
  };
}

function normalizeRecord(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const accessToken = String(record.accessToken || "").trim();
  const appBaseUrl = normalizeUrl(record.appBaseUrl || record.baseUrl);
  const account = normalizeAccount(record.account || record.user);

  if (!accessToken && !account) {
    return null;
  }

  return {
    accessToken,
    appBaseUrl,
    account,
  };
}

export class BuildingHubAccountTokenStore {
  constructor({ stateDir, fsImpl = fsPromises } = {}) {
    this.fs = fsImpl;
    this.storePath = stateDir ? path.join(stateDir, STORE_FILENAME) : "";
    this.record = null;
  }

  async load() {
    if (!this.storePath) {
      return;
    }

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
    if (!this.storePath) {
      return;
    }

    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await this.fs.mkdir(path.dirname(this.storePath), { recursive: true });
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
          account: this.record.account ? { ...this.record.account } : null,
        }
      : null;
  }

  async setRecord(record = {}) {
    this.record = normalizeRecord(record);
    await this.save();
    return this.getRecord();
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
    };
  }
}
