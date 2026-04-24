function buildHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

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

function normalizeCatalogBaseUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return "";
  }

  const url = new URL(normalized);
  if (/\/(?:registry|buildinghub|catalog)\.json$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/(?:registry|buildinghub|catalog)\.json$/i, "");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString().replace(/\/+$/, "");
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

async function readJsonResponse(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

export class BuildingHubAccountService {
  constructor({ tokenStore, fetchImpl = globalThis.fetch } = {}) {
    if (!tokenStore) {
      throw new Error("BuildingHubAccountService requires a tokenStore.");
    }

    this.tokenStore = tokenStore;
    this.fetch = fetchImpl;
  }

  getAppBaseUrl(settings = {}) {
    const explicitAppUrl = normalizeCatalogBaseUrl(settings.buildingHubAppUrl);
    if (explicitAppUrl) {
      return explicitAppUrl;
    }

    if (!String(settings.buildingHubCatalogPath || "").trim()) {
      return normalizeCatalogBaseUrl(settings.buildingHubCatalogUrl);
    }

    return "";
  }

  async exchangeGrant({
    grant,
    redirectUri,
    settings = {},
    label = "Vibe Research",
  } = {}) {
    const appBaseUrl = this.getAppBaseUrl(settings);
    if (!appBaseUrl) {
      throw buildHttpError("BuildingHub remote registry URL must be configured before account login.", 400);
    }

    const normalizedGrant = String(grant || "").trim();
    const normalizedRedirectUri = normalizeUrl(redirectUri);
    if (!normalizedGrant || !normalizedRedirectUri) {
      throw buildHttpError("BuildingHub grant and redirect URI are required.", 400);
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for BuildingHub account exchange.", 500);
    }

    const response = await this.fetch(new URL("/api/auth/exchange", appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "vibe-research",
      },
      body: JSON.stringify({
        grant: normalizedGrant,
        label,
        redirectUri: normalizedRedirectUri,
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `BuildingHub grant exchange failed (${response.status}).`, response.status || 400);
    }

    const accessToken = String(payload.accessToken || "").trim();
    const account = normalizeAccount(payload.account);
    if (!accessToken || !account) {
      throw buildHttpError("BuildingHub did not return an account token.", 502);
    }

    await this.tokenStore.setRecord({
      accessToken,
      appBaseUrl,
      account,
    });

    return this.tokenStore.getRecord();
  }

  async disconnect({ settings = {} } = {}) {
    const record = this.tokenStore.getRecord();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);
    const accessToken = String(record?.accessToken || "").trim();

    if (appBaseUrl && accessToken && typeof this.fetch === "function") {
      try {
        await this.fetch(new URL("/api/tokens/revoke", appBaseUrl).toString(), {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "vibe-research",
          },
        });
      } catch {
        // Best effort revoke; local token is still cleared below.
      }
    }

    await this.tokenStore.clear();
    return true;
  }

  async recordPublication({ settings = {}, publication = null } = {}) {
    const record = this.tokenStore.getRecord();
    const accessToken = String(record?.accessToken || "").trim();
    const appBaseUrl = record?.appBaseUrl || this.getAppBaseUrl(settings);

    if (!publication || !accessToken || !appBaseUrl) {
      return null;
    }
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for BuildingHub publication sync.", 500);
    }

    const response = await this.fetch(new URL("/api/publications", appBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "vibe-research",
      },
      body: JSON.stringify(publication),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildHttpError(payload.error || payload.message || `BuildingHub publication sync failed (${response.status}).`, response.status || 400);
    }
    return payload.publication || null;
  }
}
