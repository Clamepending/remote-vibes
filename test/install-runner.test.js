import assert from "node:assert/strict";
import test from "node:test";
import { runInstallPlan } from "../src/install-runner.js";

function makeSpawnImpl(scripts = []) {
  const calls = [];
  let i = 0;
  const fn = async (command, opts) => {
    calls.push({ command, opts });
    const next = scripts[i] || { exitCode: 0, stdout: "", stderr: "" };
    i += 1;
    if (typeof next === "function") return next({ command, opts });
    return next;
  };
  fn.calls = calls;
  return fn;
}

function textResponse(payload, status = 200) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchImpl(responses = []) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = queue.shift();
    if (!next) return textResponse({}, 200);
    return textResponse(next.body ?? {}, next.status ?? 200);
  };
  fn.calls = calls;
  return fn;
}

test("preflight that passes short-circuits the install group", async () => {
  const spawnImpl = makeSpawnImpl([
    { exitCode: 0, stdout: "/usr/local/bin/modal\n", stderr: "" },
    { exitCode: 0, stdout: "Token: abc\n", stderr: "" },
  ]);
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v modal", label: "Detect Modal" }],
      install: [{ kind: "command", command: "echo SHOULD_NOT_RUN", label: "Install Modal" }],
      verify: [{ kind: "command", command: "modal token info", label: "Verify Modal token" }],
    },
    buildingId: "modal",
    settings: {},
    setSetting: async () => {},
    spawnImpl,
  });
  assert.equal(result.status, "ok");
  // preflight + verify, install skipped.
  assert.equal(spawnImpl.calls.length, 2);
  assert.match(spawnImpl.calls[0].command, /command -v modal/);
  assert.match(spawnImpl.calls[1].command, /modal token info/);
});

test("install runs when preflight fails, then verify is attempted", async () => {
  const spawnImpl = makeSpawnImpl([
    { exitCode: 1, stdout: "", stderr: "modal not found" },     // preflight fails
    { exitCode: 0, stdout: "ok", stderr: "" },                  // install OK
    { exitCode: 0, stdout: "Token: abc", stderr: "" },          // verify OK
  ]);
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v modal" }],
      install: [{ kind: "command", command: "pip install modal", timeoutSec: 60 }],
      verify: [{ kind: "command", command: "modal token info" }],
    },
    buildingId: "modal",
    settings: {},
    setSetting: async () => {},
    spawnImpl,
  });
  assert.equal(result.status, "ok");
  assert.equal(spawnImpl.calls.length, 3);
});

test("verify failure surfaces failed status with reason", async () => {
  const spawnImpl = makeSpawnImpl([
    { exitCode: 0, stdout: "", stderr: "" },                                       // preflight OK
    { exitCode: 1, stdout: "", stderr: "no token configured" },                    // verify fails
  ]);
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v modal" }],
      verify: [{ kind: "command", command: "modal token info" }],
    },
    buildingId: "modal",
    settings: {},
    setSetting: async () => {},
    spawnImpl,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verify failed");
});

test("auth-paste with missing setting pauses with auth-required", async () => {
  const spawnImpl = makeSpawnImpl([
    { exitCode: 1, stdout: "", stderr: "no key" },  // preflight fails -> install runs
    { exitCode: 0, stdout: "", stderr: "" },        // install OK
  ]);
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v thing" }],
      install: [{ kind: "command", command: "pip install thing" }],
      auth: {
        kind: "auth-paste",
        fields: [
          { setting: "thingApiKey", label: "Thing API key", secret: true, required: true, setupUrl: "https://thing.example.com/keys" },
        ],
      },
      verify: [{ kind: "command", command: "thing whoami" }],
    },
    buildingId: "thing",
    settings: {},  // no thingApiKey
    setSetting: async () => {},
    spawnImpl,
  });
  assert.equal(result.status, "auth-required");
  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0].setting, "thingApiKey");
  assert.equal(result.fields[0].secret, true);
});

test("auth-paste with all settings present runs verify", async () => {
  const spawnImpl = makeSpawnImpl([
    { exitCode: 1, stdout: "", stderr: "" },          // preflight fails
    { exitCode: 0, stdout: "", stderr: "" },          // install
    { exitCode: 0, stdout: "ok", stderr: "" },        // verify
  ]);
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v thing" }],
      install: [{ kind: "command", command: "pip install thing" }],
      auth: {
        kind: "auth-paste",
        fields: [{ setting: "thingApiKey", required: true, secret: true }],
      },
      verify: [{ kind: "command", command: "thing whoami" }],
    },
    buildingId: "thing",
    settings: { thingApiKey: "sk-abc" },
    setSetting: async () => {},
    spawnImpl,
  });
  assert.equal(result.status, "ok");
});

test("http step captures payload fields into settings and masks secrets in logs", async () => {
  const setSettingCalls = [];
  const spawnImpl = makeSpawnImpl([
    { exitCode: 1, stdout: "", stderr: "thing not found" },    // preflight fails so install runs
    { exitCode: 0, stdout: "/sk-secret-token\n", stderr: "" }, // verify echoes the captured secret -> should be masked in stdout log
  ]);
  const fetchImpl = makeFetchImpl([
    { body: { token: "sk-secret-token", workspace: "ws-1" } },
  ]);
  const captured = [];
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v thing" }],
      install: [
        {
          kind: "http",
          url: "https://thing.example.com/api/agents/create",
          method: "POST",
          body: { name: "agent-1" },
          capture: {
            thingApiKey: "token",
            thingWorkspace: "workspace",
          },
          captureSecret: { thingApiKey: true },
          label: "Create agent",
        },
      ],
      verify: [{ kind: "command", command: "thing whoami" }],
    },
    buildingId: "thing",
    settings: {},
    setSetting: async (key, value) => {
      setSettingCalls.push({ key, value });
    },
    spawnImpl,
    fetchImpl,
    onLog: (entry) => { captured.push(entry); },
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(
    setSettingCalls.sort((a, b) => a.key.localeCompare(b.key)),
    [
      { key: "thingApiKey", value: "sk-secret-token" },
      { key: "thingWorkspace", value: "ws-1" },
    ],
  );
  // The verify command echoed the secret to stdout; the runner should mask it.
  const verifyEnd = captured.find((e) => e.kind === "step-end" && e.group === "verify");
  assert.ok(verifyEnd, "expected a verify step-end log entry");
  assert.match(verifyEnd.stdout, /\[redacted\]/, "secret should be redacted in verify stdout log");
  assert.doesNotMatch(verifyEnd.stdout, /sk-secret-token/);
});

test("http step records HTTP error status and stops the group when continueOnFailure is false", async () => {
  const fetchImpl = makeFetchImpl([{ body: { error: "bad creds" }, status: 401 }]);
  const result = await runInstallPlan({
    plan: {
      install: [
        { kind: "http", url: "https://x.example.com/whoami", label: "Check auth" },
        { kind: "http", url: "https://x.example.com/should-not-run", label: "Followup" },
      ],
      verify: [{ kind: "http", url: "https://x.example.com/verify" }],
    },
    buildingId: "x",
    settings: {},
    setSetting: async () => {},
    fetchImpl,
  });
  assert.equal(result.status, "failed");
  assert.equal(fetchImpl.calls.length, 1, "second install step must not run after failure");
});

test("mcp-launch step calls the registrar and verify success", async () => {
  const registered = [];
  const spawnImpl = makeSpawnImpl([{ exitCode: 0, stdout: "", stderr: "" }]); // preflight OK
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "command -v node" }],
      mcp: [
        {
          kind: "mcp-launch",
          name: "echo-mcp",
          command: "node",
          args: ["-e", "process.stdout.write(\"hi\")"],
          env: { ECHO: "1" },
        },
      ],
    },
    buildingId: "echo",
    settings: {},
    setSetting: async () => {},
    spawnImpl,
    mcpRegistrar: async (entry) => {
      registered.push(entry);
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(registered.length, 1);
  assert.equal(registered[0].buildingId, "echo");
  assert.equal(registered[0].name, "echo-mcp");
  assert.equal(registered[0].env.ECHO, "1");
});

test("real spawn: command step works against an actual shell", async () => {
  // No spawnImpl override -> uses defaultSpawn under the hood.
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "false" }], // forces install path
      install: [{ kind: "command", command: "true" }],
      verify: [{ kind: "command", command: "echo ok" }],
    },
    buildingId: "real-spawn",
    settings: {},
    setSetting: async () => {},
  });
  assert.equal(result.status, "ok");
  // Find the verify step-end and confirm stdout contains "ok"
  const verifyEnd = result.log.find((entry) => entry.kind === "step-end" && entry.group === "verify");
  assert.ok(verifyEnd);
  assert.match(verifyEnd.stdout, /ok/);
});

test("real spawn: command timeout records exit 124", async () => {
  const result = await runInstallPlan({
    plan: {
      preflight: [{ kind: "command", command: "sleep 5", timeoutSec: 1 }],
      install: [{ kind: "command", command: "true" }],
    },
    buildingId: "timeout-test",
    settings: {},
    setSetting: async () => {},
  });
  // Preflight fails -> install runs and succeeds -> overall status "ok"
  assert.equal(result.status, "ok");
  const preflightEnd = result.log.find((entry) => entry.kind === "step-end" && entry.group === "preflight");
  assert.equal(preflightEnd.ok, false);
  assert.match(preflightEnd.summary, /timeout/);
});
