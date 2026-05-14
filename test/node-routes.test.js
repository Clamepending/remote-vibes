import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNodeRegistrationPayload } from "../src/account/account-service.js";
import { buildNodeHeartbeatPayload } from "../src/account/node-heartbeat-service.js";
import { createVibeResearchApp } from "../src/create-app.js";
import { NodeIdentityStore } from "../src/node/identity-store.js";
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
    restart() {},
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
    restart() {},
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
      setConfig() {},
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
    assert.match(preflightResponse.headers.get("access-control-allow-methods") || "", /POST/);

    const pairStartCorsResponse = await fetch(`${started.baseUrl}/api/node/account/pair/start`, {
      method: "POST",
      headers: {
        Origin: "https://cthulhu1.tailnet.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "CORS pair", accountBaseUrl: started.baseUrl, redirectUri: "" }),
    });
    assert.equal(pairStartCorsResponse.headers.get("access-control-allow-origin"), "*");

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

test("/api/node/apps/launch records launched app instances into node snapshots", async () => {
  const started = await startNodeRoutesApp({
    appLaunchers: [{
      id: "test-app",
      label: "Test App",
      kind: "desktop-app",
      category: "test",
      available: true,
      launchMode: "command",
      command: process.execPath,
    }],
  });
  try {
    const launchResponse = await fetch(`${started.baseUrl}/api/node/apps/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: "test-app", clientCommandId: "cmd-route" }),
    });
    assert.equal(launchResponse.status, 202);
    const launchBody = await launchResponse.json();
    assert.equal(launchBody.launched, true);
    assert.equal(launchBody.instance.appId, "test-app");
    assert.equal(launchBody.instance.clientCommandId, "cmd-route");

    const secondLaunchResponse = await fetch(`${started.baseUrl}/api/node/apps/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: "test-app", clientCommandId: "cmd-route-2" }),
    });
    assert.equal(secondLaunchResponse.status, 202);
    const secondLaunchBody = await secondLaunchResponse.json();
    assert.equal(secondLaunchBody.instance.id, launchBody.instance.id);
    assert.equal(secondLaunchBody.instance.launchCount, 2);

    const snapshotResponse = await fetch(`${started.baseUrl}/api/node/snapshot?mode=privileged`);
    assert.equal(snapshotResponse.status, 200);
    const snapshotBody = await snapshotResponse.json();
    assert.equal(snapshotBody.snapshot.counts.appInstances, 1);
    assert.equal(snapshotBody.snapshot.appInstances[0].label, "Test App");
    assert.equal(snapshotBody.snapshot.appInstances[0].clientCommandId, "cmd-route-2");
    assert.equal(snapshotBody.snapshot.appInstances[0].launchCount, 2);
  } finally {
    await started.cleanup();
  }
});

test("/api/node/remote-snapshot proxies redacted machine snapshots without leaking URL secrets", async () => {
  const remoteRequests = [];
  const started = await startNodeRoutesApp({
    remoteNodeFetchImpl: async (url, init = {}) => {
      remoteRequests.push({ url, init });
      if (url === "https://remote-node.example.test/api/node/snapshot?mode=redacted") {
        return new Response(JSON.stringify({
          snapshot: {
            schemaVersion: 1,
            mode: "redacted",
            node: { id: "remote-node", name: "Remote Node", os: "linux" },
            counts: { sessions: 2, ports: 1 },
            capabilities: { gpuCount: 4 },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected remote" }), { status: 404 });
    },
  });
  try {
    const response = await fetch(
      `${started.baseUrl}/api/node/remote-snapshot?baseUrl=${encodeURIComponent("https://remote-node.example.test/private?token=secret")}`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.baseUrl, "https://remote-node.example.test");
    assert.equal(body.snapshot.mode, "redacted");
    assert.equal(body.snapshot.node.name, "Remote Node");
    assert.equal(remoteRequests.length, 1);
    assert.equal(remoteRequests[0].url, "https://remote-node.example.test/api/node/snapshot?mode=redacted");
    assert.doesNotMatch(JSON.stringify(remoteRequests), /private|token=secret/);
    assert.doesNotMatch(JSON.stringify(body), /private|token=secret/);

    const fallbackResponse = await fetch(
      `${started.baseUrl}/api/node/remote-snapshot?allowDirectFallback=1&baseUrl=${encodeURIComponent("https://unreachable-node.example.test/private?token=secret")}`,
    );
    assert.equal(fallbackResponse.status, 200);
    const fallbackBody = await fallbackResponse.json();
    assert.equal(fallbackBody.baseUrl, "https://unreachable-node.example.test");
    assert.equal(fallbackBody.directFallbackAllowed, true);
    assert.doesNotMatch(JSON.stringify(fallbackBody), /private|token=secret/);

    const invalidResponse = await fetch(`${started.baseUrl}/api/node/remote-snapshot?baseUrl=file:///etc/passwd`);
    assert.equal(invalidResponse.status, 400);
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
    if (pathname === "/api/account/nodes" && (!init.method || init.method === "GET")) {
      return new Response(JSON.stringify({
        nodes: [{
          id: "node_gpu",
          nodeId: "node_gpu",
          displayName: "GPU Cluster",
          status: "busy",
          lastSeenAt: "2026-05-12T10:00:00.000Z",
          connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/private?token=route-secret" }],
          summary: {
            counts: { sessions: 4, runningSessions: 2, ports: 1, handoffJobs: 1 },
            capabilities: { gpuCount: 6, providerCount: 2, roles: ["agent-host", "gpu-worker"] },
          },
        }],
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

    const callbackResponse = await fetch(`${started.baseUrl}/account/auth/complete?grant=grant_2&pairingId=pair_1`);
    assert.equal(callbackResponse.status, 200);
    const callbackHtml = await callbackResponse.text();
    assert.match(callbackHtml, /Vibe Account Connected/);
    assert.match(callbackHtml, /swarmlab-account-pairing-result/);
    assert.doesNotMatch(callbackHtml, /buildinghub-github-oauth-result|GitHub Connected/);

    const heartbeatResponse = await fetch(`${started.baseUrl}/api/node/account/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    assert.equal(heartbeatResponse.status, 200);
    const heartbeatBody = await heartbeatResponse.json();
    assert.equal(heartbeatBody.account.configured, true);
    assert.doesNotMatch(JSON.stringify(heartbeatBody), /secret-account-token/);

    const nodesResponse = await fetch(`${started.baseUrl}/api/node/account/nodes`);
    assert.equal(nodesResponse.status, 200);
    const nodesBody = await nodesResponse.json();
    assert.equal(nodesBody.nodes.length, 1);
    assert.equal(nodesBody.nodes[0].displayName, "GPU Cluster");
    assert.equal(nodesBody.nodes[0].baseUrl, "https://gpu.tailnet.test");
    assert.equal(nodesBody.nodes[0].capabilities.gpuCount, 6);
    assert.doesNotMatch(JSON.stringify(nodesBody), /secret-account-token|route-secret|\/private/);

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

test("hosted /api/account node registry routes power machine discovery without leaking secrets", async () => {
  const started = await startNodeRoutesApp();
  const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(started.stateDir, "route-hosted-node") });
  await nodeIdentityStore.initialize();
  const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
  const snapshot = {
    schemaVersion: 1,
    mode: "redacted",
    node: {
      nodeId: identity.nodeId,
      installId: identity.installId,
      displayName: "Hosted GPU",
      swarmlabVersion: "1.0.19",
      commit: "de29c11",
      branch: "main",
      os: "linux",
      arch: "x64",
      hostnameHash: "hashed-host",
    },
    counts: { sessions: 3, runningSessions: 1, ports: 2, handoffJobs: 1, brainNotes: 9 },
    capabilities: { gpuCount: 4, providerCount: 2, roles: ["agent-host", "gpu-worker"], brainNoteCount: 9 },
    system: { platform: "linux", arch: "x64", gpuCount: 4 },
    sessions: [{ cwd: "/private/path", command: "TOKEN=secret npm test" }],
    generatedAt: "2026-05-12T20:30:00.000Z",
  };
  try {
    const pairResponse = await fetch(`${started.baseUrl}/api/account/nodes/pairing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Hosted GPU",
        redirectUri: `${started.baseUrl}/account/auth/complete`,
        identity,
        connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/private?token=route-secret" }],
      }),
    });
    assert.equal(pairResponse.status, 201);
    const pairBody = await pairResponse.json();
    assert.match(pairBody.pairingUrl, /\/account\/pair/);

    const approveResponse = await fetch(`${started.baseUrl}/api/account/nodes/pairing/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingId: pairBody.pairingId, pairingCode: pairBody.pairingCode }),
    });
    assert.equal(approveResponse.status, 200);
    const approveBody = await approveResponse.json();
    assert.match(approveBody.redirectUri, /vibe_grant=/);

    const grant = new URL(approveBody.redirectUri).searchParams.get("grant");
    const completeResponse = await fetch(`${started.baseUrl}/api/account/nodes/pairing/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant,
        identity,
        connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/canvas?token=route-secret" }],
      }),
    });
    assert.equal(completeResponse.status, 200);
    const completeBody = await completeResponse.json();
    assert.ok(completeBody.accessToken.startsWith("slnode_"));
    assert.doesNotMatch(JSON.stringify(completeBody.node), /route-secret|\/private|\/canvas/);

    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot,
      connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/private?token=route-secret" }],
    });
    const registrationUnsigned = { type: "node.registration", registration };
    const registerResponse = await fetch(`${started.baseUrl}/api/account/nodes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${completeBody.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...registrationUnsigned,
        signature: nodeIdentityStore.signPayload(registrationUnsigned),
      }),
    });
    assert.equal(registerResponse.status, 201);
    const registerBody = await registerResponse.json();
    assert.equal(registerBody.node.displayName, "Hosted GPU");
    assert.equal(registerBody.node.baseUrl, "https://gpu.tailnet.test");

    const heartbeatUnsigned = buildNodeHeartbeatPayload({
      identity,
      snapshot,
      connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/heartbeat?token=route-secret" }],
    });
    const heartbeatResponse = await fetch(`${started.baseUrl}/api/account/nodes/${encodeURIComponent(identity.nodeId)}/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${completeBody.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        heartbeat: {
          ...heartbeatUnsigned,
          signature: nodeIdentityStore.signPayload({ type: "node.heartbeat", heartbeat: heartbeatUnsigned }),
        },
      }),
    });
    assert.equal(heartbeatResponse.status, 200);
    assert.equal((await heartbeatResponse.json()).node.capabilities.gpuCount, 4);

    const listResponse = await fetch(`${started.baseUrl}/api/account/nodes`, {
      headers: { Authorization: `Bearer ${completeBody.accessToken}` },
    });
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.equal(listBody.nodes.length, 1);
    assert.equal(listBody.nodes[0].counts.sessions, 3);
    assert.equal(listBody.nodes[0].baseUrl, "https://gpu.tailnet.test");
    assert.doesNotMatch(JSON.stringify(listBody), /slnode_|TOKEN=secret|route-secret|\/private|\/canvas|\/private\/path/);

    const enqueueResponse = await fetch(`${started.baseUrl}/api/account/nodes/${encodeURIComponent(identity.nodeId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "session.input.write",
        payload: {
          sessionId: "remote-session-1",
          input: "continue from account canvas",
        },
      }),
    });
    assert.equal(enqueueResponse.status, 201);
    const enqueueBody = await enqueueResponse.json();
    assert.equal(enqueueBody.command.status, "queued");
    assert.equal(enqueueBody.command.target.sessionId, "remote-session-1");
    assert.doesNotMatch(JSON.stringify(enqueueBody), /continue from account canvas|slnode_|grant_/);

    const pendingResponse = await fetch(`${started.baseUrl}/api/account/nodes/${encodeURIComponent(identity.nodeId)}/commands/pending`, {
      headers: { Authorization: `Bearer ${completeBody.accessToken}` },
    });
    assert.equal(pendingResponse.status, 200);
    const pendingBody = await pendingResponse.json();
    assert.equal(pendingBody.commands.length, 1);
    assert.equal(pendingBody.commands[0].payload.input, "continue from account canvas");
    assert.ok(pendingBody.accountPublicKey);

    const ack = {
      commandId: pendingBody.commands[0].id,
      nodeId: identity.nodeId,
      leaseId: pendingBody.commands[0].leaseId,
      status: "completed",
      result: { accepted: true, sessionId: "remote-session-1" },
      error: "",
      generatedAt: "2026-05-12T20:31:00.000Z",
    };
    const ackResponse = await fetch(`${started.baseUrl}/api/account/nodes/${encodeURIComponent(identity.nodeId)}/commands/${encodeURIComponent(pendingBody.commands[0].id)}/ack`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${completeBody.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ack,
        signature: nodeIdentityStore.signPayload({ type: "node.command.ack", ack }),
      }),
    });
    assert.equal(ackResponse.status, 200);
    assert.equal((await ackResponse.json()).command.status, "completed");

    const pageResponse = await fetch(`${started.baseUrl}/account/machines`);
    assert.equal(pageResponse.status, 200);
    const pageText = await pageResponse.text();
    assert.match(pageText, /Hosted GPU/);
    assert.doesNotMatch(pageText, /slnode_|TOKEN=secret|route-secret|\/private|\/canvas|\/private\/path/);
  } finally {
    await started.cleanup();
  }
});

test("/api/node/remote-pair pairs a reachable fleet URL into the command relay", async () => {
  const remoteIdentityStore = new NodeIdentityStore({ stateDir: await mkdtemp(path.join(os.tmpdir(), "swarmlab-remote-pair-node-")) });
  await remoteIdentityStore.initialize();
  const remoteIdentity = remoteIdentityStore.getPublicIdentity({ includeHostname: false });
  let remoteAccessToken = "";
  let remoteAccountBaseUrl = "";
  const remoteFetchImpl = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const body = init.body ? JSON.parse(init.body) : {};
    if (requestUrl.origin !== "https://remote-gpu.tailnet.test") {
      return new Response(JSON.stringify({ error: "unexpected remote host" }), { status: 404 });
    }
    if (requestUrl.pathname === "/api/node/account/pair/start") {
      const accountBaseUrl = body.accountBaseUrl;
      const response = await fetch(new URL("/api/account/nodes/pairing", accountBaseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: body.label,
          identity: remoteIdentity,
          connectionHints: [{ kind: "tailscale", url: "https://remote-gpu.tailnet.test/private?token=pair-secret" }],
        }),
      });
      const payload = await response.json();
      return new Response(JSON.stringify({ pairing: payload }), { status: response.status });
    }
    if (requestUrl.pathname === "/api/node/account/pair/complete") {
      const accountBaseUrl = body.accountBaseUrl;
      remoteAccountBaseUrl = accountBaseUrl;
      const response = await fetch(new URL("/api/account/nodes/pairing/complete", accountBaseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant: body.grant,
          pairingId: body.pairingId,
          label: body.label,
          identity: remoteIdentity,
          connectionHints: [{ kind: "tailscale", url: "https://remote-gpu.tailnet.test/complete?token=pair-secret" }],
        }),
      });
      const payload = await response.json();
      remoteAccessToken = payload.accessToken || "";
      return new Response(JSON.stringify({ record: { account: payload.account, node: payload.node } }), { status: response.status });
    }
    if (requestUrl.pathname === "/api/node/account/heartbeat") {
      const snapshot = {
        node: {
          nodeId: remoteIdentity.nodeId,
          installId: remoteIdentity.installId,
          displayName: "Remote GPU",
          swarmlabVersion: "1.0.19",
          os: "linux",
          arch: "x64",
        },
        counts: { sessions: 2, runningSessions: 1, ports: 1 },
        capabilities: { gpuCount: 8, providerCount: 2, roles: ["agent-host", "gpu-worker"] },
        system: { platform: "linux", arch: "x64", gpuCount: 8 },
        generatedAt: "2026-05-12T21:00:00.000Z",
      };
      const heartbeatUnsigned = buildNodeHeartbeatPayload({
        identity: remoteIdentity,
        snapshot,
        connectionHints: [
          { kind: "local", url: "http://127.0.0.1:4826" },
          { kind: "tailscale", url: "https://remote-gpu.tailnet.test/heartbeat?token=pair-secret" },
        ],
      });
      const response = await fetch(new URL(`/api/account/nodes/${encodeURIComponent(remoteIdentity.nodeId)}/heartbeat`, remoteAccountBaseUrl).toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${remoteAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          heartbeat: {
            ...heartbeatUnsigned,
            signature: remoteIdentityStore.signPayload({ type: "node.heartbeat", heartbeat: heartbeatUnsigned }),
          },
        }),
      });
      const payload = await response.json();
      return new Response(JSON.stringify({ heartbeat: payload }), { status: response.status });
    }
    return new Response(JSON.stringify({ error: "unexpected remote route" }), { status: 404 });
  };

  const started = await startNodeRoutesApp({ remoteNodeFetchImpl: remoteFetchImpl });
  try {
    const pairResponse = await fetch(`${started.baseUrl}/api/node/remote-pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://remote-gpu.tailnet.test/private?token=pair-secret",
        label: "Remote GPU",
      }),
    });
    assert.equal(pairResponse.status, 200);
    const pairBody = await pairResponse.json();
    assert.equal(pairBody.ok, true);
    assert.equal(pairBody.baseUrl, "https://remote-gpu.tailnet.test");
    assert.doesNotMatch(JSON.stringify(pairBody), /pair-secret|slnode_|grant_/);

    const nodesResponse = await fetch(`${started.baseUrl}/api/account/nodes`);
    assert.equal(nodesResponse.status, 200);
    const nodesBody = await nodesResponse.json();
    const remoteNode = nodesBody.nodes.find((node) => node.nodeId === remoteIdentity.nodeId);
    assert.equal(remoteNode.displayName, "Remote GPU");
    assert.equal(remoteNode.baseUrl, "https://remote-gpu.tailnet.test");
    assert.equal(remoteNode.capabilities.gpuCount, 8);
    assert.doesNotMatch(JSON.stringify(nodesBody), /pair-secret|slnode_|grant_|\/private|\/complete|\/heartbeat/);
  } finally {
    await started.cleanup();
    await rm(remoteIdentityStore.stateDir, { recursive: true, force: true });
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

test("/api/handoff/jobs persists machine handoffs and exposes brain summary in node snapshots", async () => {
  const started = await startNodeRoutesApp();
  try {
    const root = path.dirname(started.stateDir);
    const brainDir = path.join(root, "brain");
    await mkdir(brainDir, { recursive: true });
    await writeFile(
      path.join(brainDir, "index.md"),
      "# Machine Brain\n\n**TAKEAWAY**: GPU jobs should publish a manifest before Pi validation.\n\nSee [[pi-deploy]].\n",
      "utf8",
    );
    await writeFile(path.join(brainDir, "pi-deploy.md"), "# Pi Deploy\n\nSmoke test notes.\n", "utf8");

    const settingsResponse = await fetch(`${started.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wikiPath: brainDir, wikiPathConfigured: true }),
    });
    assert.equal(settingsResponse.status, 200);

    const createResponse = await fetch(`${started.baseUrl}/api/handoff/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "GPU train to Pi",
        objective: "Train on the GPU cluster and validate the exported model on the Pi.",
        target: {
          label: "Home Pi",
          sshTarget: "pi@home-raspi",
          url: "https://pi.example.test/private?token=route-secret",
        },
        commands: ["python train.py --epochs 1"],
      }),
    });
    assert.equal(createResponse.status, 201);
    const createBody = await createResponse.json();
    assert.equal(createBody.job.target.baseUrl, "https://pi.example.test");
    assert.doesNotMatch(JSON.stringify(createBody), /route-secret|\/private/);

    const listResponse = await fetch(`${started.baseUrl}/api/handoff/jobs`);
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).jobs.length, 1);

    const snapshotResponse = await fetch(`${started.baseUrl}/api/node/snapshot?mode=privileged`);
    assert.equal(snapshotResponse.status, 200);
    const snapshotBody = await snapshotResponse.json();
    assert.equal(snapshotBody.snapshot.counts.handoffJobs, 1);
    assert.equal(snapshotBody.snapshot.handoffJobs[0].target.sshTarget, "pi@home-raspi");
    assert.equal(snapshotBody.snapshot.capabilities.handoffCount, 1);
    assert.ok(snapshotBody.snapshot.brain.noteCount >= 2);
    assert.ok(snapshotBody.snapshot.brain.notes.some((note) => note.title === "Machine Brain"));
    assert.ok(snapshotBody.snapshot.capabilities.roles.includes("brain-host"));
    assert.ok(snapshotBody.snapshot.capabilities.roles.includes("handoff-coordinator"));
  } finally {
    await started.cleanup();
  }
});
