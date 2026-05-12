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

async function startNodeRoutesApp(overrides = {}) {
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
    ...overrides,
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
    assert.equal(redactedResponse.headers.get("access-control-allow-origin"), "*");
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

    const preflightResponse = await fetch(`${started.baseUrl}/api/node/snapshot?mode=redacted`, {
      method: "OPTIONS",
      headers: { Origin: "https://swarmlab.vibe-research.net" },
    });
    assert.equal(preflightResponse.status, 204);
    assert.equal(preflightResponse.headers.get("access-control-allow-origin"), "*");

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

test("/api/node/account routes pair, register, heartbeat, and never echo account tokens", async () => {
  const accountRequests = [];
  const accountFetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    accountRequests.push({ url, init, body });
    const pathname = new URL(url).pathname;
    if (pathname === "/api/account/nodes/pairing") {
      return new Response(JSON.stringify({
        pairingId: "pair_1",
        pairingCode: "ABCD-EFGH",
        pairingUrl: "https://account.example.test/pair",
      }), { status: 200 });
    }
    if (pathname === "/api/account/nodes/pairing/complete") {
      return new Response(JSON.stringify({
        accessToken: "secret-account-token",
        account: { id: "acct_1", login: "mark" },
        node: { nodeId: body.identity.nodeId, displayName: "Mac", status: "online" },
      }), { status: 200 });
    }
    if (pathname === "/api/account/nodes") {
      return new Response(JSON.stringify({
        node: {
          nodeId: body.registration.nodeId,
          displayName: body.registration.displayName,
          status: "online",
          connectionHints: body.registration.connectionHints,
        },
      }), { status: 200 });
    }
    if (/\/api\/account\/nodes\/[^/]+\/heartbeat/u.test(pathname)) {
      return new Response(JSON.stringify({
        status: "ok",
        node: { nodeId: body.heartbeat.nodeId, status: body.heartbeat.status },
      }), { status: 200 });
    }
    if (pathname === "/api/account/nodes/disconnect") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected account route" }), { status: 404 });
  };

  const started = await startNodeRoutesApp({ accountFetchImpl });
  try {
    const initialStatusResponse = await fetch(`${started.baseUrl}/api/node/account/status`);
    assert.equal(initialStatusResponse.status, 200);
    assert.equal((await initialStatusResponse.json()).account.configured, false);

    const startResponse = await fetch(`${started.baseUrl}/api/node/account/pair/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Mac" }),
    });
    assert.equal(startResponse.status, 201);
    assert.equal((await startResponse.json()).pairing.pairingCode, "ABCD-EFGH");

    const completeResponse = await fetch(`${started.baseUrl}/api/node/account/pair/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant: "grant_1" }),
    });
    assert.equal(completeResponse.status, 200);
    const completeBody = await completeResponse.json();
    assert.equal(completeBody.account.configured, true);
    assert.doesNotMatch(JSON.stringify(completeBody), /secret-account-token/);

    const heartbeatResponse = await fetch(`${started.baseUrl}/api/node/account/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    assert.equal(heartbeatResponse.status, 200);
    const heartbeatBody = await heartbeatResponse.json();
    assert.equal(heartbeatBody.account.configured, true);
    assert.doesNotMatch(JSON.stringify(heartbeatBody), /secret-account-token/);

    const sentText = JSON.stringify(accountRequests.map((request) => request.body));
    assert.match(sentText, /node\.registration|nodeId|heartbeat/);
    assert.doesNotMatch(sentText, /route-secret|example\.test\/private|\/proxy\/3456|secret-account-token|privateKey|localApiToken/);

    const disconnectResponse = await fetch(`${started.baseUrl}/api/node/account/disconnect`, { method: "POST" });
    assert.equal(disconnectResponse.status, 200);
    assert.equal((await disconnectResponse.json()).account.configured, false);
  } finally {
    await started.cleanup();
  }
});

test("/api/fleet/nodes persists normalized machine URLs without exposing query secrets", async () => {
  const started = await startNodeRoutesApp();
  try {
    const initialResponse = await fetch(`${started.baseUrl}/api/fleet/nodes`);
    assert.equal(initialResponse.status, 200);
    assert.deepEqual((await initialResponse.json()).nodes, []);

    const addResponse = await fetch(`${started.baseUrl}/api/fleet/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://gpu-node.example.test/private?token=route-secret",
        label: "GPU node",
      }),
    });
    assert.equal(addResponse.status, 201);
    const addBody = await addResponse.json();
    assert.equal(addBody.node.url, "https://gpu-node.example.test");
    assert.equal(addBody.node.baseUrl, "https://gpu-node.example.test");
    assert.equal(addBody.node.label, "GPU node");
    assert.doesNotMatch(JSON.stringify(addBody), /route-secret|\/private/);

    const duplicateResponse = await fetch(`${started.baseUrl}/api/fleet/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://gpu-node.example.test/other?token=second" }),
    });
    assert.equal(duplicateResponse.status, 201);
    const duplicateBody = await duplicateResponse.json();
    assert.equal(duplicateBody.nodes.length, 1);
    assert.equal(duplicateBody.nodes[0].url, "https://gpu-node.example.test");
    assert.doesNotMatch(JSON.stringify(duplicateBody), /second|\/other/);

    const invalidResponse = await fetch(`${started.baseUrl}/api/fleet/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "file:///Users/mark/private" }),
    });
    assert.equal(invalidResponse.status, 400);

    const persisted = JSON.parse(await readFile(path.join(started.stateDir, "fleet-registry.json"), "utf8"));
    assert.equal(persisted.nodes.length, 1);
    assert.equal(persisted.nodes[0].url, "https://gpu-node.example.test");

    const deleteResponse = await fetch(`${started.baseUrl}/api/fleet/nodes/${encodeURIComponent(addBody.node.id)}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).nodes.length, 0);

    const finalResponse = await fetch(`${started.baseUrl}/api/fleet/nodes`);
    assert.equal(finalResponse.status, 200);
    assert.deepEqual((await finalResponse.json()).nodes, []);
  } finally {
    await started.cleanup();
  }
});
