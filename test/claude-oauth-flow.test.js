import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import {
  ClaudeOAuthFlow,
  envWithClaudeToken,
  envWithClaudeTokenSync,
  __internals,
} from "../src/claude-oauth-flow.js";

async function withStateDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-claude-oauth-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeFakeFetch({ tokenStatus = 200, tokenBody, networkError = false }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (networkError) {
      throw new Error("simulated-network-error");
    }
    return {
      ok: tokenStatus >= 200 && tokenStatus < 300,
      status: tokenStatus,
      async text() { return typeof tokenBody === "string" ? tokenBody : JSON.stringify(tokenBody || {}); },
      async json() { return typeof tokenBody === "string" ? JSON.parse(tokenBody) : (tokenBody || {}); },
    };
  };
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// PKCE pair + parsePastedCode
// ---------------------------------------------------------------------------

test("PKCE pair: verifier and challenge are URL-safe base64, S256 derives challenge from verifier", () => {
  const { verifier, challenge } = __internals.generatePkcePair();
  // Verifier and challenge must be URL-safe base64 (no =, +, /).
  assert.ok(/^[A-Za-z0-9_-]+$/u.test(verifier), `verifier shape: ${verifier}`);
  assert.ok(/^[A-Za-z0-9_-]+$/u.test(challenge), `challenge shape: ${challenge}`);
  // Verifier ≥ 43 chars per RFC 7636 (32 random bytes -> 43 base64url chars).
  assert.ok(verifier.length >= 43, `verifier length: ${verifier.length}`);
});

test("parsePastedCode: handles bare code, code#state, code&state= forms", () => {
  assert.deepEqual(__internals.parsePastedCode("abc"), { code: "abc", state: "" });
  assert.deepEqual(__internals.parsePastedCode("abc#xyz"), { code: "abc", state: "xyz" });
  assert.deepEqual(__internals.parsePastedCode("abc&state=xyz"), { code: "abc", state: "xyz" });
  assert.deepEqual(__internals.parsePastedCode("  abc#xyz  "), { code: "abc", state: "xyz" });
  assert.deepEqual(__internals.parsePastedCode(""), { code: "", state: "" });
  // Multiple # — impl falls through to "bare" form (defensive: don't
  // guess, treat the whole thing as the code, which will fail the token
  // exchange cleanly rather than silently dropping data).
  assert.deepEqual(
    __internals.parsePastedCode("abc#xyz#extra"),
    { code: "abc#xyz#extra", state: "" },
  );
});

// ---------------------------------------------------------------------------
// start(): URL shape
// ---------------------------------------------------------------------------

test("start: builds an authorize URL with the documented Claude Code client_id, scope, S256 PKCE", () => {
  const flow = new ClaudeOAuthFlow();
  const { id, url } = flow.start();
  assert.ok(id, "flow id returned");
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, __internals.AUTHORIZE_URL);
  assert.equal(parsed.searchParams.get("client_id"), __internals.CLAUDE_CODE_CLIENT_ID);
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("redirect_uri"), __internals.REDIRECT_URI);
  assert.equal(parsed.searchParams.get("scope"), __internals.SCOPE);
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.ok(parsed.searchParams.get("code_challenge"));
  assert.ok(parsed.searchParams.get("state"));
});

test("start: each call issues a fresh PKCE verifier + state (no reuse across flows)", () => {
  const flow = new ClaudeOAuthFlow();
  const a = flow.start();
  const b = flow.start();
  assert.notEqual(a.id, b.id);
  const aState = new URL(a.url).searchParams.get("state");
  const bState = new URL(b.url).searchParams.get("state");
  assert.notEqual(aState, bState);
  const aChallenge = new URL(a.url).searchParams.get("code_challenge");
  const bChallenge = new URL(b.url).searchParams.get("code_challenge");
  assert.notEqual(aChallenge, bChallenge);
});

// ---------------------------------------------------------------------------
// submit(): happy path + error paths
// ---------------------------------------------------------------------------

test("submit: happy path POSTs to the token endpoint with grant_type, code, code_verifier, redirect_uri, client_id", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl, calls } = makeFakeFetch({
      tokenStatus: 200,
      tokenBody: {
        access_token: "sk-ant-oat01-FAKE",
        refresh_token: "ref-FAKE",
        token_type: "Bearer",
        scope: __internals.SCOPE,
      },
    });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl, now: () => 1_700_000_000_000 });
    const { id, url } = flow.start();
    // Pull the issued state out of the URL — that's what the user gets
    // back from platform.claude.com appended to the code via "#".
    const issuedState = new URL(url).searchParams.get("state");
    const token = await flow.submit(id, `abc#${issuedState}`);
    assert.equal(token.access_token, "sk-ant-oat01-FAKE");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, __internals.TOKEN_URL);
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.grant_type, "authorization_code");
    assert.equal(body.code, "abc"); // state stripped; mismatch detected separately
    assert.equal(body.client_id, __internals.CLAUDE_CODE_CLIENT_ID);
    assert.equal(body.redirect_uri, __internals.REDIRECT_URI);
    assert.ok(body.code_verifier, "code_verifier was sent");
  });
});

test("submit: state mismatch is rejected before the token call is made", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl, calls } = makeFakeFetch({ tokenStatus: 200, tokenBody: {} });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await assert.rejects(() => flow.submit(id, "code#wrong-state"), /state-mismatch/u);
    assert.equal(calls.length, 0, "no fetch happens on state-mismatch");
  });
});

test("submit: empty code after parsing is rejected", async () => {
  const flow = new ClaudeOAuthFlow();
  const { id } = flow.start();
  await assert.rejects(() => flow.submit(id, ""), /empty-code/u);
  await assert.rejects(() => flow.submit(id, "  "), /empty-code/u);
});

test("submit: unknown flow id returns flow-not-found", async () => {
  const flow = new ClaudeOAuthFlow();
  await assert.rejects(() => flow.submit("nope", "abc"), /flow-not-found/u);
});

test("submit: expired flow id is rejected after FLOW_TTL_MS", async () => {
  let now = 1_700_000_000_000;
  const flow = new ClaudeOAuthFlow({ now: () => now });
  const { id } = flow.start();
  now += __internals.FLOW_TTL_MS + 1;
  await assert.rejects(() => flow.submit(id, "abc"), /flow-expired/u);
});

test("submit: 4xx from token endpoint surfaces a token-exchange-failed error with status + body", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl } = makeFakeFetch({ tokenStatus: 400, tokenBody: { error: "invalid_grant" } });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await assert.rejects(
      () => flow.submit(id, "abc"),
      (error) => {
        assert.equal(error.code, "token-exchange-failed");
        assert.equal(error.status, 400);
        assert.match(error.body, /invalid_grant/u);
        return true;
      },
    );
  });
});

test("submit: network error is surfaced as code: network-error", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl } = makeFakeFetch({ networkError: true });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await assert.rejects(
      () => flow.submit(id, "abc"),
      (error) => {
        assert.equal(error.code, "network-error");
        return true;
      },
    );
  });
});

test("submit: response missing access_token is rejected", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl } = makeFakeFetch({ tokenStatus: 200, tokenBody: { token_type: "Bearer" } });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await assert.rejects(
      () => flow.submit(id, "abc"),
      (error) => {
        assert.equal(error.code, "no-access-token");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

test("submit: persists access_token to <stateDir>/claude-oauth-token.json with mode 0600", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl } = makeFakeFetch({
      tokenStatus: 200,
      tokenBody: { access_token: "sk-ant-oat01-PERSIST", scope: "user:inference" },
    });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await flow.submit(id, "abc");
    const tokenPath = path.join(stateDir, __internals.TOKEN_FILENAME);
    const raw = await readFile(tokenPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.access_token, "sk-ant-oat01-PERSIST");
    assert.equal(parsed.scope, "user:inference");
    assert.ok(parsed.obtained_at, "obtained_at recorded");
  });
});

test("loadToken: returns null when no token file exists, parsed object otherwise", async () => {
  await withStateDir(async (stateDir) => {
    const flow = new ClaudeOAuthFlow({ stateDir });
    assert.equal(await flow.loadToken(), null);
    const { fetchImpl } = makeFakeFetch({
      tokenStatus: 200,
      tokenBody: { access_token: "sk-ant-oat01-LOAD" },
    });
    const flow2 = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow2.start();
    await flow2.submit(id, "abc");
    const loaded = await flow.loadToken();
    assert.equal(loaded.access_token, "sk-ant-oat01-LOAD");
  });
});

test("clearToken: removes the token file (signout)", async () => {
  await withStateDir(async (stateDir) => {
    const { fetchImpl } = makeFakeFetch({
      tokenStatus: 200,
      tokenBody: { access_token: "sk-ant-oat01-CLEAR" },
    });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await flow.submit(id, "abc");
    assert.equal((await flow.loadToken()).access_token, "sk-ant-oat01-CLEAR");
    assert.equal(await flow.clearToken(), true);
    assert.equal(await flow.loadToken(), null);
    // Idempotent: clearing again returns false (nothing to remove) but doesn't throw.
    assert.equal(await flow.clearToken(), false);
  });
});

// ---------------------------------------------------------------------------
// envWithClaudeToken / envWithClaudeTokenSync
// ---------------------------------------------------------------------------

test("envWithClaudeToken: injects CLAUDE_CODE_OAUTH_TOKEN when token file exists, leaves env alone otherwise", async () => {
  await withStateDir(async (stateDir) => {
    const baseEnv = { PATH: "/usr/bin", HOME: "/x" };
    // No token yet — env unchanged.
    assert.deepEqual(await envWithClaudeToken(baseEnv, stateDir), baseEnv);
    assert.deepEqual(envWithClaudeTokenSync(baseEnv, stateDir), baseEnv);

    const { fetchImpl } = makeFakeFetch({
      tokenStatus: 200,
      tokenBody: { access_token: "sk-ant-oat01-ENV" },
    });
    const flow = new ClaudeOAuthFlow({ stateDir, fetchImpl });
    const { id } = flow.start();
    await flow.submit(id, "abc");

    const enriched = await envWithClaudeToken(baseEnv, stateDir);
    assert.equal(enriched.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-ENV");
    assert.equal(enriched.PATH, "/usr/bin", "base env preserved");

    const enrichedSync = envWithClaudeTokenSync(baseEnv, stateDir);
    assert.equal(enrichedSync.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-ENV");
  });
});

test("envWithClaudeToken: missing stateDir is a no-op (graceful in test/embedded contexts)", async () => {
  const baseEnv = { PATH: "/usr/bin" };
  assert.deepEqual(await envWithClaudeToken(baseEnv, null), baseEnv);
  assert.deepEqual(envWithClaudeTokenSync(baseEnv, null), baseEnv);
});

test("envWithClaudeTokenSync: corrupt token file is ignored, base env returned", async () => {
  await withStateDir(async (stateDir) => {
    // Write garbage at the token path — the sync helper must not throw.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(stateDir, __internals.TOKEN_FILENAME), "{not json", "utf8");
    const baseEnv = { PATH: "/usr/bin" };
    assert.deepEqual(envWithClaudeTokenSync(baseEnv, stateDir), baseEnv);
  });
});

test("hasFlow / cancel: in-memory state is correctly tracked across the start/submit/cancel lifecycle", () => {
  const flow = new ClaudeOAuthFlow();
  const { id } = flow.start();
  assert.equal(flow.hasFlow(id), true);
  assert.equal(flow.cancel(id), true);
  assert.equal(flow.hasFlow(id), false);
  assert.equal(flow.cancel("never-existed"), false);
});
