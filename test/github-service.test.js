import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubOAuthTokenStore } from "../src/github-oauth-token-store.js";
import { GitHubService } from "../src/github-service.js";

function textResponse(payload, status = 200) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(body, {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function createFetch(responses = []) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = queue.shift();
    if (!next) {
      return textResponse({}, 200);
    }
    return textResponse(next.body ?? {}, next.status ?? 200);
  };
  fetchImpl.calls = calls;
  fetchImpl.push = (...responsesToAdd) => {
    queue.push(...responsesToAdd);
  };
  return fetchImpl;
}

function makeSettingsStore(overrides = {}) {
  return {
    settings: {
      githubOAuthClientId: "github-client-id-123",
      githubOAuthClientSecret: "github-client-secret-xyz",
      ...overrides,
    },
  };
}

test("GitHubService.exchangeAuthCode exchanges code, loads the user, and stores the profile", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-github-exchange-"));
  try {
    const tokenStore = new GitHubOAuthTokenStore({ stateDir });
    await tokenStore.load();
    const fetchImpl = createFetch([
      {
        body: {
          access_token: "github-access-1",
          scope: "read:user",
          token_type: "bearer",
        },
      },
      {
        body: {
          id: 42,
          login: "octotest",
          name: "Octo Test",
          html_url: "https://github.com/octotest",
          avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
        },
      },
    ]);
    const service = new GitHubService({
      tokenStore,
      settingsStore: makeSettingsStore(),
      fetchImpl,
    });

    await service.exchangeAuthCode({
      code: "github-auth-code",
      redirectUri: "http://127.0.0.1:9999/buildinghub/auth/github/callback",
    });

    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[0].url, "https://github.com/login/oauth/access_token");
    const sentBody = new URLSearchParams(fetchImpl.calls[0].options.body);
    assert.equal(sentBody.get("client_id"), "github-client-id-123");
    assert.equal(sentBody.get("client_secret"), "github-client-secret-xyz");
    assert.equal(sentBody.get("code"), "github-auth-code");
    assert.equal(
      sentBody.get("redirect_uri"),
      "http://127.0.0.1:9999/buildinghub/auth/github/callback",
    );
    assert.equal(fetchImpl.calls[1].url, "https://api.github.com/user");
    assert.equal(fetchImpl.calls[1].options.headers.Authorization, "Bearer github-access-1");

    const stored = JSON.parse(await readFile(path.join(stateDir, "github-oauth.json"), "utf8"));
    assert.equal(stored.tokens.buildinghub.accessToken, "github-access-1");
    assert.deepEqual(stored.tokens.buildinghub.scopes, ["read:user"]);
    assert.equal(stored.tokens.buildinghub.profile.login, "octotest");
    assert.equal(stored.tokens.buildinghub.profile.profileUrl, "https://github.com/octotest");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("GitHubOAuthTokenStore status exposes the connected GitHub user", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-github-status-"));
  try {
    const tokenStore = new GitHubOAuthTokenStore({ stateDir });
    await tokenStore.load();
    await tokenStore.setTokens("buildinghub", {
      accessToken: "github-access-2",
      scopes: ["read:user"],
      profile: {
        id: "9",
        login: "builder",
        name: "Builder Test",
        profileUrl: "https://github.com/builder",
        avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
      },
    });

    assert.deepEqual(tokenStore.getStatus(), {
      configured: true,
      scopes: ["read:user"],
      user: {
        id: "9",
        login: "builder",
        name: "Builder Test",
        profileUrl: "https://github.com/builder",
        avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
      },
    });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
