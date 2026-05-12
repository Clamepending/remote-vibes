import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibeResearchApp } from "../src/create-app.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

const shellProvider = {
  id: "shell",
  label: "Shell",
  command: null,
  launchCommand: null,
  defaultName: "Shell",
  available: true,
};

async function startApp() {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-node-api-"));
  const stateDir = path.join(workspaceDir, ".vibe-research");
  const codeDir = path.join(workspaceDir, "code");
  await mkdir(codeDir, { recursive: true });
  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd: workspaceDir,
    stateDir,
    defaultSessionCwd: codeDir,
    providers: [shellProvider],
    persistSessions: false,
    persistentTerminals: false,
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({ enabled: settings.preventSleepEnabled, platform: "test" }),
    systemMetricsProvider: async () => ({ gpus: [], cameras: [] }),
    systemMetricsSampleIntervalMs: 0,
  });
  return { app, workspaceDir, baseUrl: `http://127.0.0.1:${app.config.port}` };
}

test("node API exposes manifest, status, and redacted/privileged snapshots", { timeout: 20_000 }, async () => {
  const { app, workspaceDir, baseUrl } = await startApp();
  try {
    const manifestResponse = await fetch(`${baseUrl}/api/node/manifest`);
    assert.equal(manifestResponse.status, 200);
    const { manifest } = await manifestResponse.json();
    assert.equal(manifest.schemaVersion, 1);
    assert.ok(manifest.nodeId);
    assert.ok(manifest.publicKey.includes("BEGIN PUBLIC KEY"));

    const statusResponse = await fetch(`${baseUrl}/api/node/status`);
    assert.equal(statusResponse.status, 200);
    const { status } = await statusResponse.json();
    assert.equal(status.schemaVersion, 1);
    assert.equal(status.counts.sessions, 0);

    const createSessionResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "shell",
        name: "Sensitive local session",
        cwd: path.join(workspaceDir, "code"),
      }),
    });
    assert.equal(createSessionResponse.status, 201);

    const redactedResponse = await fetch(`${baseUrl}/api/node/snapshot?mode=redacted`);
    assert.equal(redactedResponse.status, 200);
    const { snapshot: redacted } = await redactedResponse.json();
    assert.equal(redacted.mode, "redacted");
    assert.equal(redacted.counts.sessions, 1);
    assert.equal(redacted.sessions[0].name, "redacted");
    assert.equal(redacted.sessions[0].cwd, null);
    assert.doesNotMatch(JSON.stringify(redacted), /Sensitive local session/);
    assert.doesNotMatch(JSON.stringify(redacted), /swarmlab-node-api/);

    const privilegedResponse = await fetch(`${baseUrl}/api/node/snapshot?mode=privileged`);
    assert.equal(privilegedResponse.status, 200);
    const { snapshot: privileged } = await privilegedResponse.json();
    assert.equal(privileged.mode, "privileged");
    assert.equal(privileged.sessions[0].name, "Sensitive local session");
    assert.match(privileged.sessions[0].cwd, /code$/);
  } finally {
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

