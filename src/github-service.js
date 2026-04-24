const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const DEFAULT_INTEGRATION_ID = "buildinghub";

function buildHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeJsonParse(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseGitHubPayload(raw) {
  const parsedJson = safeJsonParse(raw);
  if (parsedJson) {
    return parsedJson;
  }

  const params = new URLSearchParams(String(raw || ""));
  if (![...params.keys()].length) {
    return null;
  }

  return Object.fromEntries(params.entries());
}

function extractGitHubErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (payload.error_description) {
      return String(payload.error_description);
    }
    if (payload.error && typeof payload.error === "string") {
      return String(payload.error);
    }
    if (payload.message) {
      return String(payload.message);
    }
  }

  return fallback;
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
  const login = String(profile.login || "").trim();
  const name = String(profile.name || "").trim();
  const profileUrl = String(profile.html_url || profile.profileUrl || profile.url || "").trim();
  const avatarUrl = String(profile.avatar_url || profile.avatarUrl || "").trim();

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

export class GitHubService {
  constructor({ tokenStore, settingsStore, fetchImpl = globalThis.fetch } = {}) {
    if (!tokenStore) {
      throw new Error("GitHubService requires a tokenStore.");
    }
    if (!settingsStore) {
      throw new Error("GitHubService requires a settingsStore.");
    }

    this.tokenStore = tokenStore;
    this.settingsStore = settingsStore;
    this.fetch = fetchImpl;
  }

  getCredentials() {
    const settings = this.settingsStore.settings || {};
    const clientId = String(settings.githubOAuthClientId || "").trim();
    const clientSecret = String(settings.githubOAuthClientSecret || "").trim();
    return { clientId, clientSecret };
  }

  async exchangeAuthCode({ code, redirectUri, integrationId = DEFAULT_INTEGRATION_ID } = {}) {
    const normalizedCode = String(code || "").trim();
    const normalizedRedirectUri = String(redirectUri || "").trim();
    if (!normalizedCode) {
      throw buildHttpError("Authorization code is required for GitHub OAuth token exchange.", 400);
    }
    if (!normalizedRedirectUri) {
      throw buildHttpError("Redirect URI is required for GitHub OAuth token exchange.", 400);
    }

    const { clientId, clientSecret } = this.getCredentials();
    if (!clientId || !clientSecret) {
      throw buildHttpError("GitHub OAuth client id and secret must be configured.", 400);
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: normalizedCode,
      redirect_uri: normalizedRedirectUri,
    }).toString();

    const payload = await this.requestTokenEndpoint(body);
    const accessToken = String(payload.access_token || "").trim();
    if (!accessToken) {
      throw buildHttpError("GitHub did not return an access token.", 502);
    }

    const profile = await this.fetchAuthenticatedUser(accessToken);
    await this.tokenStore.setTokens(integrationId, {
      accessToken,
      tokenType: payload.token_type || "bearer",
      scopes: normalizeScopes(payload.scope),
      profile,
    });

    return this.tokenStore.getTokens(integrationId);
  }

  async requestTokenEndpoint(body) {
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for GitHub OAuth token exchange.", 500);
    }

    const response = await this.fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "vibe-research",
      },
      body,
    });

    const raw = await response.text().catch(() => "");
    const payload = parseGitHubPayload(raw) || (raw ? { error_description: raw } : {});
    if (!response.ok) {
      const message = extractGitHubErrorMessage(payload, `GitHub OAuth token request failed (${response.status}).`);
      throw buildHttpError(message, response.status || 400);
    }
    if (payload.error) {
      throw buildHttpError(
        extractGitHubErrorMessage(payload, "GitHub OAuth token request failed."),
        400,
      );
    }
    return payload;
  }

  async fetchAuthenticatedUser(accessToken) {
    if (typeof this.fetch !== "function") {
      throw buildHttpError("fetch is not available for GitHub API requests.", 500);
    }

    const response = await this.fetch(GITHUB_USER_URL, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "vibe-research",
      },
    });

    const raw = await response.text().catch(() => "");
    const payload = safeJsonParse(raw) || (raw ? { message: raw } : {});
    if (!response.ok) {
      const message = extractGitHubErrorMessage(
        payload,
        `GitHub user request failed (${response.status}).`,
      );
      throw buildHttpError(message, response.status || 400);
    }

    const profile = normalizeProfile(payload);
    if (!profile?.login) {
      throw buildHttpError("GitHub did not return a usable account profile.", 502);
    }

    return profile;
  }
}

