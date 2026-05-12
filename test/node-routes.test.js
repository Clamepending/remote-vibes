import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

function createBuildingHubService() {
  return {
    async refresh() {},
    listBuildings() { return []; },
    listLayouts() { return []; },
    listRecipes() { return []; },
    getStatus() { return { sources: [], lastRefreshAt: 0 }; },
  };
}

function createNoopService(status = {}) {
  return {
    replyToken: "",
    requestToken: "",
    webhookToken: "",
    async initialize() {},
    async shutdown() {},
    start() {},
    stop() {},
    stopLaunchedProcess() {},
    getStatus() { return status; },
    getWebhookUrl() { return ""; },
    setServerBaseUrl() {},
    listSubagentsForSession() { return []; },
  };
}

async function startNodeRoutesApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "swarmlab-node-routes-"));
  const stateDir = path.join(root, ".swarmlab");
  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd: root,
    stateDir,
    persistSessions: false,
    persistentTerminals: false,
    providers: [shellProvider],
    systemMetricsSampleIntervalMs: 0,
    accessUrlsProvider: async (_host, port) => [{ label: "Local", url: `http://127.0.0.1:${port}` }],
    listPorts: async () => [
      {
        port: 3456,
        command: "node server.js --token=route-secret",
        pid: 4242,
        hosts: ["127.0.0.1"],
        proxyPath: "/proxy/3456/",
        previewStatusCode: 200,
      },
    ],
    systemMetricsProvider: async () => ({
      cameras: [],
      gpus: [],
      memory: { total: 100, used: 20, free: 80 },
    }),
    buildingHubServiceFactory: createBuildingHubService,
    browserUseServiceFactory: () => ({
      ...createNoopService({ enabled: true }),
      listSessions() {
        return [
          {
            id: "browser-secret",
            name: "Secret browser",
            status: "running",
            taskPrompt: "Open https://example.test/private?token=route-secret",
            latestUrl: "https://example.test/private?token=route-secret",
            createdAt: "2026-05-11T17:00:00.000Z",
            updatedAt: "2026-05-11T17:00:01.000Z",
          },
        ];
      },
    }),
    ottoAuthServiceFactory: () => createNoopService({ enabled: false }),
    telegramServiceFactory: () => createNoopService({ enabled: false }),
    twilioServiceFactory: () => createNoopService({ enabled: false }),
    videoMemoryServiceFactory: () => createNoopService({ enabled: false }),
    wikiBackupServiceFactory: () => ({
      start() {},
      stop() {},
      getStatus() { return { enabled: false }; },
      async runBackup() {},
    }),
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({ enabled: settings.preventSleepEnabled, platform: "test" }),
  });

  return {
    app,
    baseUrl: `http://127.0.0.1:${app.config.port}`,
    cleanup: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
    stateDir,
  };
}

test("/api/node manifest, status, and snapshot routes expose the local node foundation", async () => {
  const started = await startNodeRoutesApp();
  try {
    const manifestResponse = await fetch(`${started.baseUrl}/api/node/manifest`);
    assert.equal(manifestResponse.status, 200);
    const manifestBody = await manifestResponse.json();
    assert.equal(manifestBody.manifest.api.snapshot, 1);
    assert.ok(manifestBody.manifest.nodeId);
    assert.ok(manifestBody.manifest.publicKey);

    const statusResponse = await fetch(`${started.baseUrl}/api/node/status`);
    assert.equal(statusResponse.status, 200);
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.status.nodeId, manifestBody.manifest.nodeId);
    assert.equal(typeof statusBody.status.counts.sessions, "number");

    const redactedResponse = await fetch(`${started.baseUrl}/api/node/snapshot?mode=redacted`);
    assert.equal(redactedResponse.status, 200);
    const redactedBody = await redactedResponse.json();
    assert.equal(redactedBody.snapshot.mode, "redacted");
    const redactedText = JSON.stringify(redactedBody);
    assert.doesNotMatch(redactedText, /route-secret|example\.test\/private|\/proxy\/3456|node server\.js/);
    assert.equal(redactedBody.snapshot.portHints.count, 1);

    const privilegedResponse = await fetch(`${started.baseUrl}/api/node/snapshot?mode=privileged`);
    assert.equal(privilegedResponse.status, 200);
    const privilegedBody = await privilegedResponse.json();
    assert.equal(privilegedBody.snapshot.mode, "privileged");
    const privilegedText = JSON.stringify(privilegedBody);
    assert.doesNotMatch(privilegedText, /route-secret|token=route-secret/);
    assert.match(privilegedText, /example\.test/);

    const securityResponse = await fetch(`${started.baseUrl}/api/node/security/routes`);
    assert.equal(securityResponse.status, 200);
    const securityBody = await securityResponse.json();
    assert.ok(securityBody.routes.some((route) => route.path === "/api/settings"));

    const persistedIdentity = JSON.parse(await readFile(path.join(started.stateDir, "node.json"), "utf8"));
    assert.equal(persistedIdentity.nodeId, manifestBody.manifest.nodeId);
  } finally {
    await started.cleanup();
  }
});
