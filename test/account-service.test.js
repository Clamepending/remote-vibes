import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountService, buildNodeRegistrationPayload, buildNodeSummaryFromSnapshot } from "../src/account/account-service.js";
import { AccountTokenStore } from "../src/account/account-token-store.js";
import { NodeIdentityStore } from "../src/node/identity-store.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withAccountService(fn) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-service-"));
  try {
    const requests = [];
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ url, init, body });
      const pathname = new URL(url).pathname;
      if (pathname === "/api/account/nodes/pairing/complete") {
        return response({
          accessToken: "secret-account-token",
          account: { id: "acct_1", login: "mark" },
          node: { nodeId: body.identity.nodeId, displayName: "Mac", status: "online" },
        });
      }
      if (pathname === "/api/account/nodes") {
        return response({
          node: {
            nodeId: body.registration.nodeId,
            displayName: body.registration.displayName,
            status: "online",
            connectionHints: body.registration.connectionHints,
          },
        });
      }
      if (/\/api\/account\/nodes\/[^/]+\/heartbeat/u.test(pathname)) {
        return response({ status: "ok", node: { nodeId: body.heartbeat.nodeId, status: body.heartbeat.status } });
      }
      if (pathname === "/api/account/nodes/disconnect") {
        return response({ ok: true });
      }
      return response({ error: "unexpected" }, 404);
    };

    const tokenStore = new AccountTokenStore({ stateDir });
    await tokenStore.load();
    const nodeIdentityStore = new NodeIdentityStore({ stateDir, hostname: () => "private-hostname" });
    await nodeIdentityStore.initialize();
    const service = new AccountService({
      tokenStore,
      nodeIdentityStore,
      fetchImpl,
      env: { SWARMLAB_ACCOUNT_URL: "https://account.example.test" },
    });
    return await fn({ service, tokenStore, nodeIdentityStore, requests });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

function sampleRedactedSnapshot(nodeId = "node_1") {
  return {
    schemaVersion: 1,
    mode: "redacted",
    node: {
      nodeId,
      installId: "install_1",
      displayName: "Swarmlab node",
      swarmlabVersion: "1.0.19",
      commit: "abc123",
      branch: "main",
      os: "darwin",
      arch: "arm64",
      hostnameHash: "hostnamehash",
    },
    counts: {
      sessions: 2,
      runningSessions: 1,
      browserSessions: 1,
      openActionItems: 1,
      ports: 3,
      canvases: 1,
      projects: 4,
      handoffJobs: 1,
      brainNotes: 12,
    },
    capabilities: {
      providerCount: 2,
      buildingCount: 5,
      gpuCount: 1,
      cameraCount: 0,
      handoffCount: 1,
      brainNoteCount: 12,
      hasTailscale: true,
      roles: ["agent-host", "brain-host", "handoff-coordinator"],
    },
    system: {
      platform: "darwin",
      arch: "arm64",
      cpuCount: 12,
      gpuCount: 1,
      cameraCount: 0,
      memory: { total: 100, used: 40, free: 60 },
    },
    portHints: { count: 3 },
    sessions: [{ name: "redacted", cwd: null, command: "npm run deploy --token=secret" }],
    generatedAt: "2026-05-12T09:00:00.000Z",
  };
}

test("buildNodeSummaryFromSnapshot keeps only redacted summary fields", () => {
  const summary = buildNodeSummaryFromSnapshot(sampleRedactedSnapshot());
  assert.equal(summary.counts.sessions, 2);
  assert.equal(summary.counts.handoffJobs, 1);
  assert.equal(summary.counts.brainNotes, 12);
  assert.equal(summary.status, "busy");
  assert.equal(summary.capabilities.hasTailscale, true);
  assert.deepEqual(summary.capabilities.roles, ["agent-host", "brain-host", "handoff-coordinator"]);
  assert.doesNotMatch(JSON.stringify(summary), /npm run deploy|token=secret|cwd/);
});

test("buildNodeRegistrationPayload normalizes connection hints to origins", () => {
  const payload = buildNodeRegistrationPayload({
    identity: { nodeId: "node_1", installId: "install_1", publicKey: "public-key" },
    snapshot: sampleRedactedSnapshot(),
    connectionHints: [{ kind: "tailscale", url: "https://mac.tailnet.test/path?token=secret" }],
  });
  assert.equal(payload.connectionHints[0].url, "https://mac.tailnet.test");
  assert.doesNotMatch(JSON.stringify(payload), /path|token=secret|npm run deploy/);
});

test("AccountService completes pairing, registers, heartbeats, and revokes with bearer auth", async () => {
  await withAccountService(async ({ service, tokenStore, requests }) => {
    const record = await service.completePairing({ grant: "grant_1" });
    assert.equal(record.account.login, "mark");
    assert.equal(tokenStore.getRecord().accessToken, "secret-account-token");
    assert.doesNotMatch(JSON.stringify(tokenStore.getStatus()), /secret-account-token/);

    const registered = await service.registerNode({
      snapshot: sampleRedactedSnapshot(record.node.nodeId),
      connectionHints: [{ kind: "tailscale", url: "https://mac.tailnet.test/canvas?token=secret" }],
    });
    assert.equal(registered.node.nodeId, record.node.nodeId);

    const registerRequest = requests.find((entry) => new URL(entry.url).pathname === "/api/account/nodes");
    assert.equal(registerRequest.init.headers.Authorization, "Bearer secret-account-token");
    assert.ok(registerRequest.body.signature);
    assert.doesNotMatch(JSON.stringify(registerRequest.body), /token=secret|\/canvas|privateKey|localApiToken/);

    await service.sendHeartbeat({
      heartbeat: {
        schemaVersion: 1,
        nodeId: record.node.nodeId,
        status: "idle",
        counts: { sessions: 0 },
        generatedAt: "2026-05-12T09:01:00.000Z",
        signature: "sig",
      },
    });
    const heartbeatRequest = requests.find((entry) => /\/heartbeat$/u.test(new URL(entry.url).pathname));
    assert.equal(heartbeatRequest.init.headers.Authorization, "Bearer secret-account-token");
    assert.equal(heartbeatRequest.body.heartbeat.status, "idle");

    await service.disconnect();
    assert.equal(tokenStore.getStatus().configured, false);
    assert.ok(requests.some((entry) => new URL(entry.url).pathname === "/api/account/nodes/disconnect"));
  });
});
