// Claude Code OAuth flow — direct PKCE implementation, no subprocess.
//
// Why this exists: when a vibe-research stream-mode session hits
// `authentication_failed`, the user needs a way to sign in without
// dropping to a terminal. Claude Code itself uses the same OAuth flow
// internally (we reverse-engineered the endpoints from its packaged
// binary); we just hit them ourselves and persist the resulting token.
//
// Endpoints (from the Claude Code v2.x binary):
//   authorize:  https://claude.com/cai/oauth/authorize
//   token:      https://platform.claude.com/v1/oauth/token
//   redirect:   https://platform.claude.com/oauth/code/callback
//   client_id:  9d1c250a-e61b-44d9-88ed-5944d1962f5e (public PKCE client)
//
// The redirect URI is a hosted page on platform.claude.com that shows
// the OAuth code (and #state fragment) for the user to paste back —
// Anthropic's OAuth UX is paste-back, not localhost callback. Our flow
// mirrors that: open the URL for the user, give them a paste field,
// exchange the code.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const SCOPE = "user:inference";
const FLOW_TTL_MS = 10 * 60 * 1000;

const TOKEN_FILENAME = "claude-oauth-token.json";

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64")
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

function generatePkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// Anthropic's hosted callback page concatenates `code` and `state` with
// either `#` or `&state=` depending on UI version. Accept both — the
// pasted string may be one of:
//   "<code>"
//   "<code>#<state>"
//   "<code>&state=<state>"
// The state we received in the URL is the source of truth; we only use
// the user-supplied state to validate, not to override.
export function parsePastedCode(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { code: "", state: "" };
  // Match "code#state"
  const hashSplit = trimmed.split("#");
  if (hashSplit.length === 2) {
    return { code: hashSplit[0].trim(), state: hashSplit[1].trim() };
  }
  // Match "code&state=..."
  const ampMatch = trimmed.match(/^([^&]+)&state=([^&]+)/u);
  if (ampMatch) {
    return { code: ampMatch[1].trim(), state: ampMatch[2].trim() };
  }
  return { code: trimmed, state: "" };
}

// Manages the in-memory state of an in-flight OAuth handshake. One
// flow per server instance is the realistic constraint — vibe-research
// is single-user — but the map allows for parallel flows in tests.
export class ClaudeOAuthFlow {
  constructor({ stateDir, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.stateDir = stateDir;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this._flows = new Map();
  }

  // Build the authorize URL + register a pending flow keyed by an opaque
  // id the client will echo back when submitting the pasted code.
  start() {
    const { verifier, challenge } = generatePkcePair();
    const state = base64url(randomBytes(24));
    const id = randomUUID();
    this._flows.set(id, {
      verifier,
      state,
      createdAt: this.now(),
    });
    this._sweepExpired();

    const params = new URLSearchParams();
    params.set("code", "true");
    params.set("client_id", CLAUDE_CODE_CLIENT_ID);
    params.set("response_type", "code");
    params.set("redirect_uri", REDIRECT_URI);
    params.set("scope", SCOPE);
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
    params.set("state", state);
    return {
      id,
      url: `${AUTHORIZE_URL}?${params.toString()}`,
    };
  }

  // Exchange the user-pasted code for an access token. The pasted string
  // may include a "#state" suffix (from the redirect URL fragment); we
  // parse it out and verify against the state we issued.
  async submit(id, rawPaste) {
    const flow = this._flows.get(id);
    if (!flow) {
      throw Object.assign(new Error("flow-not-found"), { code: "flow-not-found" });
    }
    if (this.now() - flow.createdAt > FLOW_TTL_MS) {
      this._flows.delete(id);
      throw Object.assign(new Error("flow-expired"), { code: "flow-expired" });
    }

    const { code, state: pastedState } = parsePastedCode(rawPaste);
    if (!code) {
      throw Object.assign(new Error("empty-code"), { code: "empty-code" });
    }
    if (pastedState && pastedState !== flow.state) {
      throw Object.assign(new Error("state-mismatch"), { code: "state-mismatch" });
    }

    let response;
    try {
      response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLAUDE_CODE_CLIENT_ID,
          code_verifier: flow.verifier,
          state: flow.state,
        }),
      });
    } catch (error) {
      throw Object.assign(new Error(`token-fetch-failed: ${error.message}`), {
        code: "network-error",
        cause: error,
      });
    }

    if (!response.ok) {
      let body = "";
      try { body = await response.text(); } catch { /* ignore */ }
      const error = Object.assign(
        new Error(`token-exchange-failed: ${response.status} ${body.slice(0, 200)}`),
        {
          code: "token-exchange-failed",
          status: response.status,
          body,
        },
      );
      throw error;
    }

    let json;
    try {
      json = await response.json();
    } catch (error) {
      throw Object.assign(new Error("token-response-not-json"), {
        code: "token-response-not-json",
        cause: error,
      });
    }

    const accessToken = String(json.access_token || "").trim();
    if (!accessToken) {
      throw Object.assign(new Error("no-access-token-in-response"), {
        code: "no-access-token",
        body: json,
      });
    }

    this._flows.delete(id);

    const tokenRecord = {
      access_token: accessToken,
      refresh_token: json.refresh_token ? String(json.refresh_token) : "",
      token_type: json.token_type ? String(json.token_type) : "Bearer",
      scope: json.scope ? String(json.scope) : SCOPE,
      // expires_in is in seconds; some token endpoints omit it for
      // long-lived tokens (a year-long sk-ant-oat01 token reasonably
      // uses no expiry on the wire).
      expires_at: Number.isFinite(json.expires_in)
        ? new Date(this.now() + Number(json.expires_in) * 1000).toISOString()
        : "",
      obtained_at: new Date(this.now()).toISOString(),
    };
    if (this.stateDir) {
      await this._writeToken(tokenRecord);
    }
    return tokenRecord;
  }

  cancel(id) {
    return this._flows.delete(id);
  }

  hasFlow(id) {
    return this._flows.has(id);
  }

  // Token storage. Single-file JSON at <stateDir>/claude-oauth-token.json
  // with mode 0600. Vibe-research already creates stateDir for session
  // persistence, so we piggy-back on that path.
  tokenPath() {
    if (!this.stateDir) {
      throw new Error("stateDir required for token persistence");
    }
    return path.join(this.stateDir, TOKEN_FILENAME);
  }

  async loadToken() {
    if (!this.stateDir) return null;
    try {
      const raw = await readFile(this.tokenPath(), "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.access_token) return null;
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async _writeToken(record) {
    await mkdir(this.stateDir, { recursive: true });
    const tmp = `${this.tokenPath()}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    try {
      await chmod(tmp, 0o600);
    } catch {
      // Best-effort on file systems that don't honor mode (e.g. SMB).
    }
    // Atomic replace by rename — leftover tmp from a crashed prior write
    // is OK; the next successful write replaces it.
    await writeFile(this.tokenPath(), await readFile(tmp), { mode: 0o600 });
    await unlink(tmp).catch(() => {});
  }

  async clearToken() {
    if (!this.stateDir) return false;
    try {
      await unlink(this.tokenPath());
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  _sweepExpired() {
    const cutoff = this.now() - FLOW_TTL_MS;
    for (const [id, flow] of this._flows) {
      if (flow.createdAt < cutoff) this._flows.delete(id);
    }
  }
}

// Convenience: shape an env object for spawning claude with the stored
// token. Reads the token file if present, returns the input env unchanged
// otherwise. Caller passes the result to ClaudeStreamSession constructor.
export async function envWithClaudeToken(baseEnv, stateDir) {
  if (!stateDir) return baseEnv;
  try {
    const flow = new ClaudeOAuthFlow({ stateDir });
    const token = await flow.loadToken();
    if (!token?.access_token) return baseEnv;
    return { ...baseEnv, CLAUDE_CODE_OAUTH_TOKEN: token.access_token };
  } catch {
    return baseEnv;
  }
}

// Sync variant for synchronous code paths (startClaudeStreamSession runs
// during session boot and isn't async). The token file is small (<1KB)
// and local — readFileSync is fine on the hot path.
export function envWithClaudeTokenSync(baseEnv, stateDir) {
  if (!stateDir) return baseEnv;
  try {
    const tokenPath = path.join(stateDir, TOKEN_FILENAME);
    const raw = readFileSync(tokenPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token) return baseEnv;
    return { ...baseEnv, CLAUDE_CODE_OAUTH_TOKEN: parsed.access_token };
  } catch {
    return baseEnv;
  }
}

export const __internals = {
  CLAUDE_CODE_CLIENT_ID,
  AUTHORIZE_URL,
  TOKEN_URL,
  REDIRECT_URI,
  SCOPE,
  parsePastedCode,
  generatePkcePair,
  TOKEN_FILENAME,
  FLOW_TTL_MS,
};
