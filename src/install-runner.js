// Install-plan runner.
//
// Executes the `install.plan` block of a building manifest end-to-end:
// preflight detection, install steps, optional auth, verify, and (planned)
// MCP-server registration. Streams structured log events to a callback so
// the route layer or the client UI can show progress live.
//
// Step kinds (v1):
//   command           run a shell command, capture stdout/stderr, fail on
//                     non-zero exit (unless `allowedExitCodes` is set).
//   http              fetch a URL with optional JSON body, parse JSON, capture
//                     named fields into the settings store via setSetting().
//   auth-browser-cli  run a CLI subcommand that opens a browser tab; treated
//                     as best-effort — verify is what determines auth state.
//   auth-paste        emit a `auth-required` job state with the field name
//                     the human must fill via the building panel; the runner
//                     pauses until resume({ values }) is called.
//   mcp-launch        write an MCP server entry into the runtime's MCP
//                     config (pluggable via mcpRegistrar).
//
// The runner is deliberately small and pure: spawn / fetch / settings.update
// are all injected so tests don't touch the real process tree or network.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_SEC = 120;

function nowIso() {
  return new Date().toISOString();
}

function maskSecrets(text, secretValues) {
  if (!text) return "";
  let out = text;
  for (const value of secretValues || []) {
    if (!value) continue;
    out = out.split(value).join("[redacted]");
  }
  return out;
}

function defaultSpawn(command, { timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: { ...process.env, ...(env || {}) },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 1000);
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_SEC * 1000));
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: stderr + `\n[spawn error] ${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? 124 : code ?? -1, stdout, stderr, timedOut });
    });
  });
}

async function runCommandStep(step, ctx) {
  const allowed = Array.isArray(step.allowedExitCodes) ? step.allowedExitCodes : [0];
  const result = await ctx.spawnImpl(step.command, {
    timeoutMs: (Number(step.timeoutSec) || DEFAULT_TIMEOUT_SEC) * 1000,
    env: step.env || {},
  });
  const ok = allowed.includes(result.exitCode);
  return {
    ok,
    summary: ok
      ? `exit 0`
      : `exit ${result.exitCode}${result.timedOut ? " (timeout)" : ""}`,
    stdout: maskSecrets(result.stdout, ctx.secretValues),
    stderr: maskSecrets(result.stderr, ctx.secretValues),
    exitCode: result.exitCode,
  };
}

async function runHttpStep(step, ctx) {
  if (typeof ctx.fetchImpl !== "function") {
    return { ok: false, summary: "fetch not available", stdout: "", stderr: "" };
  }
  const headers = step.headers ? { ...step.headers } : {};
  let body;
  if (step.body !== undefined && step.body !== null) {
    body = typeof step.body === "string" ? step.body : JSON.stringify(step.body);
    if (!headers["Content-Type"] && typeof step.body !== "string") {
      headers["Content-Type"] = "application/json";
    }
  }
  let response;
  let raw;
  try {
    response = await ctx.fetchImpl(step.url, { method: step.method || "GET", headers, body });
    raw = await response.text();
  } catch (error) {
    return { ok: false, summary: `network error: ${error.message}`, stdout: "", stderr: error.message };
  }
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* leave null */ }

  if (!response.ok) {
    return {
      ok: false,
      summary: `HTTP ${response.status}`,
      stdout: maskSecrets(raw, ctx.secretValues),
      stderr: "",
    };
  }

  const captured = {};
  if (step.capture && payload && typeof payload === "object") {
    for (const [settingKey, payloadPath] of Object.entries(step.capture)) {
      const segments = String(payloadPath).split(".");
      let cursor = payload;
      for (const segment of segments) {
        if (cursor && Object.prototype.hasOwnProperty.call(cursor, segment)) {
          cursor = cursor[segment];
        } else {
          cursor = undefined;
          break;
        }
      }
      if (cursor !== undefined) {
        await ctx.setSetting(settingKey, cursor);
        captured[settingKey] = "captured";
        if (step.captureSecret && step.captureSecret[settingKey]) {
          ctx.secretValues.push(String(cursor));
        }
      }
    }
  }

  return {
    ok: true,
    summary: `HTTP 200`,
    stdout: maskSecrets(raw, ctx.secretValues),
    stderr: "",
    captured,
  };
}

async function runMcpLaunchStep(step, ctx) {
  if (typeof ctx.mcpRegistrar !== "function") {
    return { ok: false, summary: "no MCP registrar configured", stdout: "", stderr: "" };
  }
  try {
    await ctx.mcpRegistrar({
      buildingId: ctx.buildingId,
      name: step.name || ctx.buildingId,
      command: step.command,
      args: step.args || [],
      env: step.env || {},
    });
    return { ok: true, summary: `registered MCP "${step.name || ctx.buildingId}"`, stdout: "", stderr: "" };
  } catch (error) {
    return { ok: false, summary: `MCP registration failed: ${error.message}`, stdout: "", stderr: error.message };
  }
}

function describeStep(step) {
  return step.label || step.kind || "step";
}

async function runStepGroup(groupName, steps, ctx, log) {
  const results = [];
  for (let i = 0; i < (steps || []).length; i += 1) {
    const step = steps[i];
    const stepStartedAt = nowIso();
    log({ kind: "step-start", group: groupName, index: i, label: describeStep(step), startedAt: stepStartedAt });
    let result;
    try {
      switch (step.kind) {
        case "command":
          result = await runCommandStep(step, ctx);
          break;
        case "http":
          result = await runHttpStep(step, ctx);
          break;
        case "mcp-launch":
          result = await runMcpLaunchStep(step, ctx);
          break;
        default:
          result = { ok: false, summary: `unknown step kind: ${step.kind}`, stdout: "", stderr: "" };
      }
    } catch (error) {
      result = { ok: false, summary: `step threw: ${error.message}`, stdout: "", stderr: error.stack || error.message };
    }
    log({
      kind: "step-end",
      group: groupName,
      index: i,
      label: describeStep(step),
      ok: result.ok,
      summary: result.summary,
      stdout: result.stdout,
      stderr: result.stderr,
      captured: result.captured || null,
      finishedAt: nowIso(),
    });
    results.push({ step, result });
    if (!result.ok && !step.continueOnFailure) {
      return { results, failedAt: i };
    }
  }
  return { results, failedAt: null };
}

function buildSecretValuesFromAuthPaste(plan, settings) {
  const out = [];
  const auth = plan.auth;
  if (!auth || auth.kind !== "auth-paste") return out;
  for (const field of auth.fields || []) {
    const v = settings?.[field.setting];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return out;
}

function authPasteRequired(plan, settings) {
  if (!plan.auth || plan.auth.kind !== "auth-paste") return null;
  const missing = (plan.auth.fields || []).filter((field) => {
    const v = settings?.[field.setting];
    return field.required !== false && (v === undefined || v === null || v === "");
  });
  if (!missing.length) return null;
  return missing.map((field) => ({
    setting: field.setting,
    label: field.label || field.setting,
    secret: Boolean(field.secret),
    setupUrl: field.setupUrl || "",
    setupHint: field.setupHint || "",
  }));
}

export async function runInstallPlan({
  plan,
  buildingId,
  settings,
  setSetting,
  fetchImpl = globalThis.fetch,
  spawnImpl = defaultSpawn,
  mcpRegistrar = null,
  onLog = () => {},
} = {}) {
  if (!plan || typeof plan !== "object") {
    throw new Error("install plan is missing or not an object");
  }
  const jobId = randomUUID();
  const startedAt = nowIso();
  const logEntries = [];
  const log = (entry) => {
    const stamped = { ...entry, jobId, ts: entry.ts || nowIso() };
    logEntries.push(stamped);
    try { onLog(stamped); } catch { /* swallow */ }
  };

  const ctx = {
    buildingId,
    spawnImpl,
    fetchImpl,
    setSetting,
    mcpRegistrar,
    secretValues: buildSecretValuesFromAuthPaste(plan, settings),
  };

  log({ kind: "job-start", buildingId, startedAt });

  // Preflight — if every preflight step succeeds, we can short-circuit and
  // skip install.
  let preflightOk = true;
  if (plan.preflight && plan.preflight.length) {
    const preflight = await runStepGroup("preflight", plan.preflight, ctx, log);
    preflightOk = preflight.failedAt === null;
  }

  if (!preflightOk) {
    if (plan.install && plan.install.length) {
      const install = await runStepGroup("install", plan.install, ctx, log);
      if (install.failedAt !== null) {
        log({ kind: "job-end", status: "failed", reason: "install step failed" });
        return { jobId, status: "failed", reason: "install step failed", log: logEntries };
      }
    }
  }

  const pasteRequired = authPasteRequired(plan, settings);
  if (pasteRequired) {
    log({ kind: "auth-required", fields: pasteRequired });
    log({ kind: "job-end", status: "auth-required", reason: "human action required" });
    return { jobId, status: "auth-required", fields: pasteRequired, log: logEntries };
  }

  if (plan.auth && plan.auth.kind === "auth-browser-cli") {
    const authStep = { kind: "command", command: plan.auth.command, label: "Browser auth", timeoutSec: plan.auth.timeoutSec || 120 };
    await runStepGroup("auth", [authStep], ctx, log);
  }

  if (plan.verify && plan.verify.length) {
    const verify = await runStepGroup("verify", plan.verify, ctx, log);
    if (verify.failedAt !== null) {
      log({ kind: "job-end", status: "failed", reason: "verify failed" });
      return { jobId, status: "failed", reason: "verify failed", log: logEntries };
    }
  }

  if (plan.mcp && plan.mcp.length) {
    const mcp = await runStepGroup("mcp", plan.mcp, ctx, log);
    if (mcp.failedAt !== null) {
      log({ kind: "job-end", status: "failed", reason: "mcp registration failed" });
      return { jobId, status: "failed", reason: "mcp registration failed", log: logEntries };
    }
  }

  log({ kind: "job-end", status: "ok", finishedAt: nowIso() });
  return { jobId, status: "ok", log: logEntries };
}

export const __internal = {
  defaultSpawn,
  maskSecrets,
  buildSecretValuesFromAuthPaste,
  authPasteRequired,
  runStepGroup,
};
