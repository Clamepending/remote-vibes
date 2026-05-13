import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const CREATE_APP_SOURCE = new URL("../src/create-app.js", import.meta.url);

const OPTIONAL_MODULES = {
  identity: [
    "../src/node/identity-store.js",
    "../src/node-identity-store.js",
  ],
  snapshot: [
    "../src/node/snapshot-service.js",
    "../src/node-snapshot-service.js",
  ],
  routeSecurity: [
    "../src/node/route-security.js",
    "../src/node-route-security.js",
    "../src/node/security.js",
  ],
};

async function optionalImport(candidates) {
  const failures = [];
  for (const candidate of candidates) {
    try {
      return {
        module: await import(candidate),
        path: candidate,
      };
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
        throw error;
      }
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  return { module: null, path: null, failures };
}

const identityImport = await optionalImport(OPTIONAL_MODULES.identity);
const snapshotImport = await optionalImport(OPTIONAL_MODULES.snapshot);
const routeSecurityImport = await optionalImport(OPTIONAL_MODULES.routeSecurity);

function exported(source, names) {
  for (const name of names) {
    if (source?.[name]) return source[name];
  }
  return null;
}

const NodeIdentityStore = exported(identityImport.module, [
  "NodeIdentityStore",
  "SwarmlabNodeIdentityStore",
  "IdentityStore",
]);
const NodeSnapshotService = exported(snapshotImport.module, [
  "NodeSnapshotService",
  "SwarmlabNodeSnapshotService",
  "SnapshotService",
]);
const classifyNodeRoute = exported(routeSecurityImport.module, [
  "classifyNodeRoute",
  "classifyRoute",
  "getNodeRoutePolicy",
]);
const isLoopbackAddress = exported(routeSecurityImport.module, [
  "isLoopbackAddress",
  "isLoopbackHost",
]);
const createLocalOrNodeTokenMiddleware = exported(routeSecurityImport.module, [
  "createLocalOrNodeTokenMiddleware",
  "createNodeAuthMiddleware",
]);

async function withTempState(prefix, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    const stateDir = path.join(root, ".swarmlab");
    await mkdir(stateDir, { recursive: true });
    return await fn({ root, stateDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readIdentity(store) {
  if (typeof store.initialize === "function") {
    await store.initialize();
  }
  if (typeof store.getIdentity === "function") {
    return await store.getIdentity();
  }
  if (typeof store.getOrCreateIdentity === "function") {
    return await store.getOrCreateIdentity();
  }
  if (typeof store.load === "function") {
    const loaded = await store.load();
    if (loaded) return loaded;
  }
  if (typeof store.getRecord === "function") {
    return store.getRecord();
  }
  if (typeof store.getPublicIdentity === "function") {
    return store.getPublicIdentity();
  }
  return store.identity || store.state || null;
}

function identityNodeId(identity) {
  return identity?.nodeId || identity?.id || identity?.node?.id || "";
}

function identityPublicKey(identity) {
  return identity?.publicKey || identity?.nodeKeypair?.publicKey || identity?.keypair?.publicKey || "";
}

function makeSnapshotService(overrides = {}) {
  const generatedAt = "2026-05-11T17:00:00.000Z";
  const listPorts = overrides.listPorts || (async () => [
    {
      port: 3000,
      name: "Private Admin",
      command: "npm run dev -- --token=leaky-token",
      pid: 1234,
      hosts: ["127.0.0.1"],
      localUrl: "http://127.0.0.1:3000/private?token=leaky-token",
      proxyPath: "/proxy/3000/",
    },
  ]);
  const settings = {
    workspaceRootPath: "/Users/mark/private/swarmlab-work",
    agentSpawnPath: "/Users/mark/private/swarmlab-work",
    anthropicApiKey: "sk-ant-test-secret",
    openaiApiKey: "sk-openai-test-secret",
    githubToken: "ghp_test_secret",
    installedPluginIds: ["safe-plugin"],
  };
  return new NodeSnapshotService({
    timeoutMs: overrides.timeoutMs ?? 75,
    metadataProvider: () => ({
      version: "1.0.19",
      commit: "test-commit",
      branch: "test-branch",
      generatedAt,
    }),
    nodeIdentityStore: {
      getIdentity: async () => ({
        nodeId: "node-test-123",
        installId: "install-test-123",
        displayName: "Mark MacBook",
        swarmlabVersion: "1.0.19",
        publicKey: "test-public-key",
      }),
      getRecord: () => ({
        nodeId: "node-test-123",
        installId: "install-test-123",
        publicKey: "test-public-key",
      }),
      getPublicIdentity: () => ({
        nodeId: "node-test-123",
        installId: "install-test-123",
        publicKey: "test-public-key",
      }),
    },
    settings,
    settingsStore: { settings },
    sessionsProvider: () => [
      {
        id: "session-1",
        name: "Deploy prod",
        providerId: "claude",
        cwd: "/Users/mark/private/prod-repo",
        command: "ANTHROPIC_API_KEY=sk-ant-test-secret npm run deploy",
        lastLine: "raw transcript with sk-ant-test-secret",
        transcript: "full raw transcript with /Users/mark/private/prod-repo",
        env: { ANTHROPIC_API_KEY: "sk-ant-test-secret" },
        status: "running",
      },
    ],
    agentTownStateProvider: () => ({
      actionItems: [
        {
          id: "approval-1",
          title: "Approve deploy",
          detail: "Deploy from /Users/mark/private/prod-repo with sk-ant-test-secret",
          sourceSessionId: "session-1",
          choices: [],
        },
      ],
      canvases: [
        {
          id: "canvas-1",
          title: "Secret plot",
          imageUrl: "file:///Users/mark/private/results.png",
        },
      ],
    }),
    browserSessionsProvider: () => [
      {
        id: "browser-1",
        url: "https://example.test/private?token=leaky-token",
        title: "Private Browser",
      },
    ],
    buildingsProvider: () => [{ id: "modal", label: "Modal", secret: "building-secret" }],
    providersProvider: () => [{ id: "claude", label: "Claude", available: true }],
    systemProvider: async () => ({
      cpu: { percent: 12 },
      gpu: [{ name: "GPU 0", memoryUsed: 100 }],
      gpus: [{ name: "GPU 0", memoryUsed: 100 }],
      raw: "no raw command text here",
    }),
    portsProvider: listPorts,
    ...overrides,
  });
}

async function getSnapshot(service, mode) {
  if (typeof service.getSnapshot === "function") {
    return await service.getSnapshot({ mode });
  }
  if (typeof service.buildSnapshot === "function") {
    return await service.buildSnapshot({ mode });
  }
  if (typeof service.snapshot === "function") {
    return await service.snapshot({ mode });
  }
  throw new Error("NodeSnapshotService must expose getSnapshot({ mode }) or buildSnapshot({ mode }).");
}

function serialized(payload) {
  return JSON.stringify(payload);
}

function assertFleetSafeRedaction(payload) {
  const text = serialized(payload);
  const forbidden = [
    ["secret token", /sk-ant-test-secret|sk-openai-test-secret|ghp_test_secret|building-secret|leaky-token/],
    ["raw command", /npm run deploy|npm run dev|ANTHROPIC_API_KEY/],
    ["raw local path", /\/Users\/mark\/private|file:\/\/\/Users\/mark/],
    ["raw transcript", /full raw transcript|raw transcript with/],
    ["browser URL", /example\.test\/private|token=/],
    ["proxy URL", /\/proxy\/3000/],
  ];
  for (const [label, pattern] of forbidden) {
    assert.doesNotMatch(text, pattern, `redacted snapshot leaked ${label}: ${text}`);
  }
}

function extractRouteDecision(route) {
  const result = classifyNodeRoute(route);
  if (!result || typeof result !== "object") {
    throw new Error("classifyNodeRoute must return a route policy object.");
  }
  return result;
}

function decisionDeniesUnauthenticatedNonLoopback(decision) {
  if (decision.allowUnauthenticatedNonLoopback === false) return true;
  if (decision.requiresAuth === true) return true;
  if (decision.decision === "deny" || decision.allowed === false) return true;
  const classification = String(decision.classification || decision.class || decision.exposure || decision.auth || "");
  return /\b(?:local-auth|grant-auth|never-remote|loopback-only|deny)\b/.test(classification);
}

test("NodeIdentityStore persists a stable node identity across store instances", {
  skip: NodeIdentityStore ? false : "waiting for src/node/identity-store.js or src/node-identity-store.js",
}, async () => {
  await withTempState("swarmlab-node-identity-", async ({ stateDir }) => {
    const firstStore = new NodeIdentityStore({ stateDir });
    const first = await readIdentity(firstStore);
    const secondStore = new NodeIdentityStore({ stateDir });
    const second = await readIdentity(secondStore);

    const firstNodeId = identityNodeId(first);
    assert.match(firstNodeId, /^[A-Za-z0-9_-]{16,}$/);
    assert.equal(identityNodeId(second), firstNodeId);
    assert.ok(identityPublicKey(first), "identity must expose a public key for node registration/grant verification");
    assert.notEqual(firstNodeId, os.hostname(), "nodeId must not be derived from hostname");
  });
});

test("NodeIdentityStore writes identity under the configured state dir", {
  skip: NodeIdentityStore ? false : "waiting for src/node/identity-store.js or src/node-identity-store.js",
}, async () => {
  await withTempState("swarmlab-node-identity-location-", async ({ root, stateDir }) => {
    const store = new NodeIdentityStore({ stateDir });
    const identity = await readIdentity(store);
    const persisted = await readFile(path.join(stateDir, "node.json"), "utf8");

    assert.match(persisted, new RegExp(identityNodeId(identity)));
    assert.doesNotMatch(serialized(identity), new RegExp(root), "identity payload should not bake in temp root paths");
  });
});

test("NodeSnapshotService redacted mode strips secrets, commands, paths, transcripts, and URLs", {
  skip: NodeSnapshotService ? false : "waiting for src/node/snapshot-service.js or src/node-snapshot-service.js",
}, async () => {
  const service = makeSnapshotService();
  const snapshot = await getSnapshot(service, "redacted");

  assert.equal(snapshot.nodeId || snapshot.identity?.nodeId || snapshot.node?.nodeId, "node-test-123");
  assert.match(String(snapshot.generatedAt || ""), /^\d{4}-\d{2}-\d{2}T/);
  assertFleetSafeRedaction(snapshot);
  assert.ok(
    snapshot.counts || snapshot.summary || snapshot.capabilities,
    "redacted snapshot should expose counts/summary/capabilities for fleet cards",
  );
});

test("NodeSnapshotService degraded dependencies return bounded redacted snapshots", {
  skip: NodeSnapshotService ? false : "waiting for src/node/snapshot-service.js or src/node-snapshot-service.js",
}, async () => {
  const never = new Promise(() => {});
  const service = makeSnapshotService({
    timeoutMs: 50,
    portsProvider: async () => never,
    buildingsProvider: () => {
      throw new Error("building hub failed with sk-ant-test-secret");
    },
    browserSessionsProvider: () => {
      throw new Error("browser failed with token=leaky-token");
    },
  });

  const startedAt = Date.now();
  const snapshot = await Promise.race([
    getSnapshot(service, "redacted"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("snapshot timed out")), 1_000)),
  ]);
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 1_000, `degraded snapshot should be bounded; got ${elapsedMs}ms`);
  assert.equal(snapshot.nodeId || snapshot.identity?.nodeId || snapshot.node?.nodeId, "node-test-123");
  assertFleetSafeRedaction(snapshot);
  assert.ok(
    serialized(snapshot).includes("degraded") || serialized(snapshot).includes("unavailable") || serialized(snapshot).includes("partial"),
    "degraded snapshot should surface partial/unavailable diagnostics without leaking dependency error text",
  );
});

test("route security identifies loopback addresses precisely", {
  skip: isLoopbackAddress ? false : "waiting for src/node/security.js loopback helper",
}, () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("0.0.0.0"), false);
  assert.equal(isLoopbackAddress("::"), false);
  assert.equal(isLoopbackAddress("192.168.1.42"), false);
  assert.equal(isLoopbackAddress("100.64.0.10"), false);
});

test("node auth middleware blocks non-loopback requests without the local node token", {
  skip: createLocalOrNodeTokenMiddleware ? false : "waiting for src/node/security.js node-token middleware",
}, () => {
  const middleware = createLocalOrNodeTokenMiddleware({
    nodeIdentityStore: {
      getLocalApiToken: () => "expected-node-token",
    },
  });
  const request = {
    socket: { remoteAddress: "192.168.1.42" },
    headers: {},
  };
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;

  middleware(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body?.code, "SWARMLAB_LOCAL_OR_NODE_AUTH_REQUIRED");
});

test("node auth middleware allows loopback and valid node token requests", {
  skip: createLocalOrNodeTokenMiddleware ? false : "waiting for src/node/security.js node-token middleware",
}, () => {
  const middleware = createLocalOrNodeTokenMiddleware({
    nodeIdentityStore: {
      getLocalApiToken: () => "expected-node-token",
    },
  });

  let loopbackNext = false;
  middleware(
    { socket: { remoteAddress: "127.0.0.1" }, headers: {} },
    { status: () => ({ json: () => {} }) },
    () => {
      loopbackNext = true;
    },
  );
  assert.equal(loopbackNext, true);

  let tokenNext = false;
  middleware(
    {
      socket: { remoteAddress: "192.168.1.42" },
      headers: { "x-swarmlab-node-token": "expected-node-token" },
    },
    { status: () => ({ json: () => {} }) },
    () => {
      tokenNext = true;
    },
  );
  assert.equal(tokenNext, true);
});

test("create-app wires node auth middleware onto dangerous write/control routes", async () => {
  const source = await readFile(CREATE_APP_SOURCE, "utf8");
  const requiredRegistrations = [
    [/app\.patch\("\/api\/settings",\s*requireLocalOrNodeToken,/, "PATCH /api/settings"],
    [/app\.get\("\/api\/fleet\/nodes",\s*requireLocalOrNodeToken,/, "GET /api/fleet/nodes"],
    [/app\.post\("\/api\/fleet\/nodes",\s*requireLocalOrNodeToken,/, "POST /api/fleet/nodes"],
    [/app\.delete\("\/api\/fleet\/nodes\/:nodeId",\s*requireLocalOrNodeToken,/, "DELETE /api/fleet/nodes/:nodeId"],
    [/app\.get\("\/api\/node\/account\/status",\s*requireLocalOrNodeToken,/, "GET /api/node/account/status"],
    [/app\.get\("\/api\/node\/account\/nodes",\s*requireLocalOrNodeToken,/, "GET /api/node/account/nodes"],
    [/app\.get\("\/api\/node\/remote-snapshot",\s*requireLocalOrNodeToken,/, "GET /api/node/remote-snapshot"],
    [/app\.post\("\/api\/node\/remote-pair",\s*requireLocalOrNodeToken,/, "POST /api/node/remote-pair"],
    [/app\.post\("\/api\/node\/account\/pair\/start",\s*requireLocalOrNodeToken,/, "POST /api/node/account/pair/start"],
    [/app\.post\("\/api\/node\/account\/pair\/complete",\s*requireLocalOrNodeToken,/, "POST /api/node/account/pair/complete"],
    [/app\.post\("\/api\/node\/account\/heartbeat",\s*requireLocalOrNodeToken,/, "POST /api/node/account/heartbeat"],
    [/app\.post\("\/api\/node\/account\/disconnect",\s*requireLocalOrNodeToken,/, "POST /api/node/account/disconnect"],
    [/app\.patch\("\/api\/ports\/:port",\s*requireLocalOrNodeToken,/, "PATCH /api/ports/:port"],
    [/app\.post\("\/api\/ports\/:port\/tailscale",\s*requireLocalOrNodeToken,/, "POST /api/ports/:port/tailscale"],
    [/app\.post\("\/api\/files\/file",\s*requireLocalOrNodeToken,/, "POST /api/files/file"],
    [/app\.put\("\/api\/files\/text",\s*requireLocalOrNodeToken,/, "PUT /api/files/text"],
    [/app\.post\("\/api\/sessions",\s*requireLocalOrNodeToken,/, "POST /api/sessions"],
    [/app\.patch\("\/api\/sessions\/:sessionId",\s*requireLocalOrNodeToken,/, "PATCH /api/sessions/:sessionId"],
    [/app\.delete\("\/api\/sessions\/:sessionId",\s*requireLocalOrNodeToken,/, "DELETE /api/sessions/:sessionId"],
    [/app\.post\("\/api\/sessions\/:sessionId\/input",\s*requireLocalOrNodeToken,/, "POST /api/sessions/:sessionId/input"],
    [/app\.post\("\/api\/sessions\/:sessionId\/plan-response",\s*requireLocalOrNodeToken,/, "POST /api/sessions/:sessionId/plan-response"],
    [/app\.post\("\/api\/terminate",\s*requireLocalOrNodeToken,/, "POST /api/terminate"],
    [/app\.post\("\/api\/relaunch",\s*requireLocalOrNodeToken,/, "POST /api/relaunch"],
    [/app\.use\("\/proxy\/:port",\s*requireLocalOrNodeToken,/, "proxy port access"],
  ];

  for (const [pattern, label] of requiredRegistrations) {
    assert.match(source, pattern, `${label} must be registered behind requireLocalOrNodeToken`);
  }
});

test("route security denies unauthenticated non-loopback write/control routes", {
  skip: classifyNodeRoute ? false : "waiting for src/node/route-security.js or src/node-route-security.js",
}, () => {
  const dangerousRoutes = [
    { method: "PATCH", path: "/api/settings" },
    { method: "GET", path: "/api/fleet/nodes" },
    { method: "POST", path: "/api/fleet/nodes" },
    { method: "DELETE", path: "/api/fleet/nodes/node-1" },
    { method: "GET", path: "/api/node/account/status" },
    { method: "GET", path: "/api/node/account/nodes" },
    { method: "GET", path: "/api/node/remote-snapshot" },
    { method: "POST", path: "/api/node/remote-pair" },
    { method: "POST", path: "/api/node/account/pair/start" },
    { method: "POST", path: "/api/node/account/pair/complete" },
    { method: "POST", path: "/api/node/account/heartbeat" },
    { method: "POST", path: "/api/node/account/disconnect" },
    { method: "PATCH", path: "/api/ports/3000" },
    { method: "POST", path: "/api/ports/3000/tailscale" },
    { method: "POST", path: "/api/files/file" },
    { method: "PUT", path: "/api/files/text" },
    { method: "POST", path: "/api/sessions" },
    { method: "PATCH", path: "/api/sessions/session-1" },
    { method: "DELETE", path: "/api/sessions/session-1" },
    { method: "POST", path: "/api/sessions/session-1/input" },
    { method: "POST", path: "/api/sessions/session-1/plan-response" },
    { method: "POST", path: "/api/terminate" },
    { method: "POST", path: "/api/relaunch" },
  ];

  for (const route of dangerousRoutes) {
    const decision = extractRouteDecision({
      ...route,
      remoteAddress: "192.168.1.42",
      isLoopback: false,
      hasNodeAuth: false,
      hasGrant: false,
    });
    assert.equal(
      decisionDeniesUnauthenticatedNonLoopback(decision),
      true,
      `${route.method} ${route.path} must fail closed from non-loopback without node auth; got ${serialized(decision)}`,
    );
  }
});
