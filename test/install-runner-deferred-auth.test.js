// Unit tests for the deferred auth-browser-cli flow.
//
// Background: when a building's install plan declares
// `auth.kind: "auth-browser-cli"` and verify fails, the runner used to
// auto-spawn the auth command (e.g. `modal token new --source web`) which
// pops a sign-in browser tab the moment placement finishes. That hijacks
// the user's screen with a sign-in popup they didn't ask for.
//
// The new contract: with `deferBrowserAuth: true` (set by startInstallJob)
// the install runner returns `auth-required` with an authPrompt instead.
// The UI then renders an explicit "Sign in to <building>" button which
// POSTs /api/buildings/:id/authenticate, spawning the auth command via
// executeAuthPhase only when the user opts in.
//
// These tests exercise both halves: deferred install + on-demand auth.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createInstallJobStore,
  executeAuthPhase,
  executeInstallPlan,
  startAuthenticateJob,
  waitForJob,
} from "../src/install-runner.js";

function silentLog() {
  const entries = [];
  return { entries, append: (entry) => entries.push(entry) };
}

const browserAuthPlan = {
  preflight: [{ kind: "command", command: "true", label: "exists" }],
  // Verify fails initially — that's what triggers auth.
  verify: [{ kind: "command", command: "false", label: "verify-token" }],
  auth: {
    kind: "auth-browser-cli",
    command: "true",  // stub: pretends auth succeeded.
    label: "Sign in",
    detail: "Sign in via the browser to finish setup.",
    timeoutSec: 30,
  },
};

test("executeInstallPlan: deferBrowserAuth returns auth-required without running the auth command", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(browserAuthPlan, {
    appendLog: log.append,
    deferBrowserAuth: true,
  });

  assert.equal(result.status, "auth-required");
  assert.equal(result.reason, "browser-auth-pending");
  assert.deepEqual(
    {
      kind: result.authPrompt?.kind,
      command: result.authPrompt?.command,
      label: result.authPrompt?.label,
      detail: result.authPrompt?.detail,
    },
    {
      kind: "auth-browser-cli",
      command: "true",
      label: "Sign in",
      detail: "Sign in via the browser to finish setup.",
    },
    "authPrompt must carry the metadata the UI needs to render a Sign-in button",
  );

  // The auth log line must say "deferred" and never claim "ok" (because
  // we didn't run the command). If a future refactor accidentally drops
  // the deferral and re-runs auth here, this catches it.
  const authRan = log.entries.some(
    (entry) => entry.phase === "auth" && entry.message === "running",
  );
  assert.equal(authRan, false, "auth command must NOT run when deferBrowserAuth is true");
  const deferredLog = log.entries.find(
    (entry) => entry.phase === "auth" && /auth-required: deferred/.test(entry.message || ""),
  );
  assert.ok(deferredLog, "expected an auth log entry indicating deferral");
});

test("executeInstallPlan: WITHOUT deferBrowserAuth the auth command still runs (preserves existing behaviour for non-job callers)", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(browserAuthPlan, {
    appendLog: log.append,
    // deferBrowserAuth defaults to false.
  });

  // Auth command (stubbed `true`) ran, then verify retried (still `false`),
  // so the runner returns auth-required after the second verify failed.
  // This is the documented "auth ran but verify still fails" outcome —
  // we're checking the auth command itself was invoked, which is the
  // backward-compatible behaviour callers without the flag rely on.
  const authRan = log.entries.some(
    (entry) => entry.phase === "auth" && entry.message === "running",
  );
  assert.equal(authRan, true, "auth command must run when deferBrowserAuth is false (the default)");
  assert.equal(result.status, "auth-required");
});

test("executeInstallPlan: deferBrowserAuth is a no-op for auth-paste plans (those already defer)", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "true" }],
      verify: [{ kind: "command", command: "false" }],
      auth: { kind: "auth-paste", setting: "fakeApiKey", setupUrl: "https://x", setupLabel: "Get key" },
    },
    { appendLog: log.append, deferBrowserAuth: true, settingsStore: { settings: {} } },
  );

  // auth-paste path returns auth-required regardless of the flag.
  assert.equal(result.status, "auth-required");
  assert.equal(result.authPrompt?.setting, "fakeApiKey");
});

test("executeAuthPhase: runs the auth command + verify and returns ok on success", async () => {
  const log = silentLog();
  const result = await executeAuthPhase(
    {
      // After auth, verify uses a separate command to mimic "verify works
      // now that the token landed".
      auth: { kind: "auth-browser-cli", command: "true", label: "Sign in" },
      verify: [{ kind: "command", command: "true", label: "verify-token" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "ok");
  const authRan = log.entries.some(
    (entry) => entry.phase === "auth" && entry.message === "running",
  );
  assert.equal(authRan, true, "executeAuthPhase must spawn the auth command");
});

test("executeAuthPhase: failed auth command returns failed (NOT auth-required) so the UI doesn't loop", async () => {
  const log = silentLog();
  const result = await executeAuthPhase(
    {
      auth: { kind: "auth-browser-cli", command: "false", label: "Sign in" },
      verify: [{ kind: "command", command: "true" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason || "", /auth command failed/);
});

test("executeAuthPhase: successful auth + failing verify returns failed (token didn't take)", async () => {
  const log = silentLog();
  const result = await executeAuthPhase(
    {
      auth: { kind: "auth-browser-cli", command: "true" },
      verify: [{ kind: "command", command: "false", label: "verify" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "failed");
});

test("executeAuthPhase: rejects non-browser-cli plans (auth-paste should use its own pathway)", async () => {
  const log = silentLog();
  const result = await executeAuthPhase(
    { auth: { kind: "auth-paste", setting: "x" }, verify: [] },
    { appendLog: log.append },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "auth-not-applicable");
});

test("startAuthenticateJob: end-to-end job lifecycle for the auth-only flow", async () => {
  const jobStore = createInstallJobStore();
  const building = {
    id: "fake-building",
    install: {
      plan: {
        auth: { kind: "auth-browser-cli", command: "true", label: "Sign in to Fake" },
        verify: [{ kind: "command", command: "true" }],
      },
    },
  };
  const job = startAuthenticateJob({ jobStore, building });
  const finished = await waitForJob(jobStore, job.id, { timeoutMs: 3000 });
  assert.ok(finished, "auth job should complete");
  assert.equal(finished.status, "ok");

  const authStarted = finished.log.some(
    (entry) => entry.phase === "auth" && entry.message === "running",
  );
  assert.equal(authStarted, true);
});

test("startInstallJob passes deferBrowserAuth: true so installs return auth-required for browser-cli plans", async () => {
  const jobStore = createInstallJobStore();
  const building = {
    id: "fake-building",
    install: {
      plan: browserAuthPlan,
    },
  };
  const job = await new Promise((resolve) => {
    // startInstallJob returns immediately; we wait via the job store.
    import("../src/install-runner.js").then((mod) => {
      resolve(mod.startInstallJob({ jobStore, building }));
    });
  });
  const finished = await waitForJob(jobStore, job.id, { timeoutMs: 5000 });
  assert.equal(finished.status, "auth-required", `expected auth-required, got ${finished.status}: ${finished.result?.reason || ""}`);
  assert.equal(finished.result?.authPrompt?.kind, "auth-browser-cli");
});
