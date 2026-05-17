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
          account: { id: "acct_1", login: "mark", commandPublicKey: "account-public-key" },
          commandPublicKey: "account-public-key",
          node: { nodeId: body.identity.nodeId, displayName: "Mac", status: "online" },
        });
      }
      if (pathname === "/api/account/nodes" && (!init.method || init.method === "GET")) {
        return response({
          nodes: [{
            id: "node_gpu",
            nodeId: "node_gpu",
            displayName: "GPU Cluster",
            status: "busy",
            lastSeenAt: "2026-05-12T10:00:00.000Z",
            connectionHints: [
              { kind: "local", url: "http://127.0.0.1:4826" },
              { kind: "tailscale", url: "https://gpu.tailnet.test/private?token=secret" },
            ],
            summary: {
              counts: { sessions: 4, runningSessions: 2, ports: 1, handoffJobs: 1 },
              capabilities: { gpuCount: 6, providerCount: 2, roles: ["agent-host", "gpu-worker"] },
            },
          }],
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
      if (/\/api\/account\/nodes\/[^/]+\/commands\/pending/u.test(pathname)) {
        return response({
          accountPublicKey: "account-public-key",
          commands: [{
            id: "cmd_1",
            nodeId: "node_local",
            operation: "session.input.write",
            payload: { sessionId: "session-1", input: "continue" },
            signature: "sig",
            leaseId: "lease_1",
          }],
        });
      }
      if (/\/api\/account\/nodes\/[^/]+\/commands\/[^/]+\/ack/u.test(pathname)) {
        return response({ command: { id: "cmd_1", status: "completed" } });
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
      commandOperations: ["session.input.write", "session.narrative.read"],
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
    sessions: [{
      id: "session_1",
      name: "redacted",
      providerId: "codex",
      cwd: null,
      command: "npm run deploy --token=secret",
      recentNarrative: [
        {
          id: "entry_1",
          kind: "assistant",
          label: "Codex /Users/mark/private/project",
          text: "Safe account summary with OPENAI_API_KEY=sk-secret in /Users/mark/private/project",
          timestamp: "2026-05-12T09:00:01.000Z",
        },
      ],
    }],
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
  assert.deepEqual(summary.capabilities.commandOperations, ["session.input.write", "session.narrative.read"]);
  assert.deepEqual(summary.capabilities.roles, ["agent-host", "brain-host", "handoff-coordinator"]);
  assert.deepEqual(summary.sessions[0], {
    id: "session_1",
    name: "redacted",
    providerId: "codex",
    providerLabel: "",
    status: "unknown",
    activityStatus: "",
    createdAt: "",
    updatedAt: "",
    hasSubagents: false,
    recentNarrative: [{
      id: "entry_1",
      kind: "assistant",
      label: "Codex [path]",
      text: "Safe account summary with OPENAI_API_KEY=[redacted] in [path]",
      status: "",
      timestamp: "2026-05-12T09:00:01.000Z",
    }],
  });
  assert.doesNotMatch(JSON.stringify(summary), /npm run deploy|token=secret|cwd|sk-secret|OPENAI_API_KEY=sk-secret|\/Users\/mark/);
});

test("buildNodeRegistrationPayload normalizes connection hints to origins", () => {
  const payload = buildNodeRegistrationPayload({
    identity: { nodeId: "node_1", installId: "install_1", publicKey: "public-key" },
    snapshot: sampleRedactedSnapshot(),
    connectionHints: [{ kind: "tailscale", url: "https://mac.tailnet.test/path?token=secret" }],
  });
  assert.equal(payload.connectionHints[0].url, "https://mac.tailnet.test");
  assert.doesNotMatch(JSON.stringify(payload), /\/Users\/mark|token=secret|npm run deploy/);
});

test("AccountService completes pairing, registers, heartbeats, and revokes with bearer auth", async () => {
  await withAccountService(async ({ service, tokenStore, requests }) => {
    const record = await service.completePairing({ grant: "grant_1" });
    assert.equal(record.account.login, "mark");
    assert.equal(tokenStore.getRecord().accessToken, "secret-account-token");
    assert.equal(tokenStore.getRecord().accountPublicKey, "account-public-key");
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

    const listed = await service.listNodes();
    assert.equal(listed.nodes.length, 1);
    assert.equal(listed.nodes[0].displayName, "GPU Cluster");
    assert.equal(listed.nodes[0].baseUrl, "https://gpu.tailnet.test");
    assert.equal(listed.nodes[0].counts.sessions, 4);
    assert.equal(listed.nodes[0].capabilities.gpuCount, 6);
    const listRequest = requests.find((entry) =>
      new URL(entry.url).pathname === "/api/account/nodes" && (!entry.init.method || entry.init.method === "GET"));
    assert.equal(listRequest.init.headers.Authorization, "Bearer secret-account-token");
    assert.doesNotMatch(JSON.stringify(listed), /token=secret|\/private|secret-account-token/);

    await tokenStore.updateNode({ nodeId: "node_local", displayName: "Mac", status: "online" });
    const commands = await service.listCommands();
    assert.equal(commands.commands.length, 1);
    assert.equal(commands.accountPublicKey, "account-public-key");
    const commandRequest = requests.find((entry) =>
      /\/api\/account\/nodes\/node_local\/commands\/pending$/u.test(new URL(entry.url).pathname));
    assert.equal(commandRequest.init.headers.Authorization, "Bearer secret-account-token");
    const acked = await service.acknowledgeCommand({
      commandId: "cmd_1",
      ack: {
        ack: { commandId: "cmd_1", nodeId: "node_local", leaseId: "lease_1", status: "completed" },
        signature: "node-sig",
      },
    });
    assert.equal(acked.command.status, "completed");

    await service.disconnect();
    assert.equal(tokenStore.getStatus().configured, false);
    assert.ok(requests.some((entry) => new URL(entry.url).pathname === "/api/account/nodes/disconnect"));
  });
});
