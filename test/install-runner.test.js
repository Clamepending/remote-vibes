// Unit tests for src/install-runner.js. These exercise the runner against
// stub commands (`true`, `false`, `printf`) and a fake fetch so they don't
// rely on any external service. Network-touching paths (Modal, OttoAuth)
// have their own integration coverage in install-runner-integration.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createInstallJobStore,
  executeInstallPlan,
  startInstallJob,
  waitForJob,
} from "../src/install-runner.js";

function fakeSettingsStore() {
  const updates = [];
  return {
    updates,
    async update(patch) { updates.push({ ...patch }); },
  };
}

function silentLog() {
  const entries = [];
  return { entries, append: (entry) => entries.push(entry) };
}

test("executeInstallPlan: empty plan returns ok", async () => {
  const settings = fakeSettingsStore();
  const log = silentLog();
  const result = await executeInstallPlan({}, { appendLog: log.append, settingsStore: settings });
  assert.equal(result.status, "ok");
});

test("executeInstallPlan: preflight detects already-installed and skips install", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "true", label: "exists" }],
      install: [{ kind: "command", command: "false", label: "should-not-run" }],
      verify: [{ kind: "command", command: "true", label: "verify" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "ok");
  const ranInstall = log.entries.some((entry) => entry.phase === "install" && entry.step === "should-not-run" && entry.message?.startsWith("running"));
  assert.equal(ranInstall, false, "install phase should be skipped when preflight all-ok");
});

test("executeInstallPlan: install phase runs when preflight fails", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "false", label: "absent" }],
      install: [{ kind: "command", command: "true", label: "do-install" }],
      verify: [{ kind: "command", command: "true", label: "verify" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "ok");
  const installRan = log.entries.some((entry) => entry.phase === "install" && entry.step === "do-install");
  assert.equal(installRan, true);
});

test("executeInstallPlan: install command failure surfaces failed status", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "false" }],
      install: [{ kind: "command", command: "false", label: "boom" }],
      verify: [{ kind: "command", command: "true" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason, /install step "boom"/);
});

test("executeInstallPlan: verify failure with no auth returns failed", async () => {
  const log = silentLog();
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "true" }],
      install: [],
      verify: [{ kind: "command", command: "false", label: "no" }],
    },
    { appendLog: log.append },
  );
  assert.equal(result.status, "failed");
});

test("executeInstallPlan: verify failure with auth-browser-cli runs auth then verifies again", async () => {
  // Use a temp file as a flag — first verify reads it (missing → fail), auth
  // creates it, second verify reads it (present → pass). Simulates the auth
  // flow without depending on a real CLI.
  const dir = mkdtempSync(join(tmpdir(), "install-runner-"));
  const flag = join(dir, "auth-flag");
  const log = silentLog();
  try {
    const result = await executeInstallPlan(
      {
        preflight: [{ kind: "command", command: "true" }],
        install: [],
        auth: {
          kind: "auth-browser-cli",
          command: `touch ${flag}`,
          label: "stub-auth",
        },
        verify: [{ kind: "command", command: `test -f ${flag}`, label: "verify-flag" }],
      },
      { appendLog: log.append },
    );
    assert.equal(result.status, "ok");
    const authRan = log.entries.some((entry) => entry.phase === "auth");
    assert.equal(authRan, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeInstallPlan: http step captures fields into settings", async () => {
  const settings = fakeSettingsStore();
  const log = silentLog();
  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://example.test/create");
    assert.equal(init.method, "POST");
    return {
      status: 200,
      text: async () => JSON.stringify({
        username: "stub-user",
        privateKey: "stub-secret",
        nested: { foo: "bar" },
      }),
    };
  };
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "false" }],
      install: [
        {
          kind: "http",
          method: "POST",
          url: "https://example.test/create",
          body: {},
          captureSettings: {
            username: "providerUsername",
            privateKey: "providerPrivateKey",
            "nested.foo": "providerNested",
          },
        },
      ],
      verify: [],
    },
    { appendLog: log.append, settingsStore: settings, fetchImpl: fakeFetch },
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(settings.updates, [{
    providerUsername: "stub-user",
    providerPrivateKey: "stub-secret",
    providerNested: "bar",
  }]);
});

test("executeInstallPlan: http step non-2xx is treated as failed", async () => {
  const log = silentLog();
  const fakeFetch = async () => ({ status: 503, text: async () => "down" });
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "false" }],
      install: [
        { kind: "http", method: "POST", url: "https://example.test/x", body: {}, label: "http-fail" },
      ],
      verify: [],
    },
    { appendLog: log.append, fetchImpl: fakeFetch },
  );
  assert.equal(result.status, "failed");
});

test("executeInstallPlan: auth-paste returns auth-required and surfaces prompt info", async () => {
  const settings = fakeSettingsStore();
  const fakeFetch = async () => ({ status: 200, text: async () => JSON.stringify({ token: "abc" }) });
  const result = await executeInstallPlan(
    {
      preflight: [{ kind: "command", command: "false" }],
      install: [
        { kind: "http", method: "POST", url: "https://example.test/c", body: {}, captureSettings: { token: "providerToken" } },
      ],
      auth: {
        kind: "auth-paste",
        setting: "providerPairing",
        setupUrl: "https://example.test/dashboard",
        setupLabel: "Open dashboard",
        detail: "Paste the pairing code in the dashboard.",
      },
      verify: [{ kind: "command", command: "false", label: "always-fail" }],
    },
    { appendLog: () => {}, settingsStore: settings, fetchImpl: fakeFetch },
  );
  assert.equal(result.status, "auth-required");
  assert.equal(result.authPrompt.setting, "providerPairing");
  assert.equal(result.authPrompt.setupUrl, "https://example.test/dashboard");
  // The captured token from the http step should already be saved before
  // the install pauses for the human.
  assert.deepEqual(settings.updates, [{ providerToken: "abc" }]);
});

test("startInstallJob + waitForJob: end-to-end via the job store", async () => {
  const jobStore = createInstallJobStore();
  const settings = fakeSettingsStore();
  const building = {
    id: "demo",
    install: {
      plan: {
        preflight: [{ kind: "command", command: "true" }],
        install: [],
        verify: [{ kind: "command", command: "true" }],
      },
    },
  };
  const job = startInstallJob({ jobStore, building, settingsStore: settings });
  assert.equal(job.status, "running");
  const finished = await waitForJob(jobStore, job.id, { timeoutMs: 4000 });
  assert.equal(finished.status, "ok");
  assert.equal(finished.buildingId, "demo");
});

test("createInstallJobStore: trims old jobs past the cap", () => {
  const jobStore = createInstallJobStore();
  const ids = [];
  for (let i = 0; i < 70; i += 1) {
    ids.push(jobStore.create(`b${i}`).id);
  }
  // Should keep at most 64; oldest 6 dropped.
  const present = ids.filter((id) => jobStore.get(id));
  assert.equal(present.length, 64);
});
