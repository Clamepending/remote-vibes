import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeIdentityStore } from "../src/node/identity-store.js";
import { NodeSnapshotService } from "../src/node/snapshot-service.js";

async function createIdentityStore() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-snapshot-"));
  const store = new NodeIdentityStore({ stateDir, hostname: () => "snapshot-host" });
  await store.initialize();
  return { stateDir, store };
}

test("redacted node snapshot omits sensitive local detail", async () => {
  const { stateDir, store } = await createIdentityStore();
  try {
    const service = new NodeSnapshotService({
      nodeIdentityStore: store,
      metadataProvider: () => ({ version: "1.2.3", commit: "abc", branch: "test" }),
      providersProvider: () => [{ id: "claude", label: "Claude", available: true }],
      sessionsProvider: () => [{
        id: "sess_1",
        name: "Secret customer order",
        status: "running",
        providerId: "claude",
        providerLabel: "Claude",
        cwd: "/Users/mark/private/project",
        lastPromptAt: "2026-05-12T00:00:00.000Z",
        shellActivity: {
          count: 2,
          lastLabel: "shell with token=secret",
          lastStatus: "completed",
          updatedAt: "2026-05-12T00:01:00.000Z",
        },
        recentNarrative: [{
          id: "secret-narrative",
          kind: "assistant",
          label: "Read /Users/mark/private/project",
          text: "OPENAI_API_KEY=sk-secret in /Users/mark/private/project",
        }],
      }],
      browserSessionsProvider: () => [{
        id: "browser_1",
        name: "Bank login",
        taskPrompt: "Log into private.example",
        latestUrl: "https://private.example/token=secret",
        status: "running",
      }],
      agentTownStateProvider: () => ({
        actionItems: [{
          id: "approval_1",
          title: "Spend $100",
          detail: "Use card ending 1234",
          status: "open",
          choices: ["approve", "deny"],
        }],
        canvases: [{
          id: "artifact_1",
          title: "Secret chart",
          imagePath: "/Users/mark/private/chart.png",
        }],
      }),
      portsProvider: () => [{
        port: 31337,
        name: "admin-db",
        command: "node",
        directUrl: "http://100.64.0.5:31337/",
        proxyPath: "/proxy/31337/",
      }],
      appInstancesProvider: () => [{
        id: "appinst_cursor",
        appId: "cursor",
        label: "Cursor",
        status: "launched",
        clientCommandId: "cmd_secret",
      }],
      systemProvider: () => ({
        gpus: [{ index: 0, name: "RTX 4090" }],
        cameras: [{}],
      }),
      buildingsProvider: () => [{ id: "secret-building", name: "Secret Building" }],
      projectsProvider: () => [{ name: "secret-project", path: "/Users/mark/private/project" }],
    });

    const { snapshot } = { snapshot: await service.getSnapshot({ mode: "redacted" }) };
    const serialized = JSON.stringify(snapshot);
    assert.equal(snapshot.mode, "redacted");
    assert.equal(snapshot.counts.sessions, 1);
    assert.deepEqual(snapshot.sessions[0].shellActivity, { count: 2 });
    assert.equal(snapshot.counts.ports, 1);
    assert.equal(snapshot.counts.appInstances, 1);
    assert.deepEqual(snapshot.ports, []);
    assert.equal(snapshot.appInstances[0].label, "Cursor");
    assert.equal(snapshot.appInstances[0].clientCommandId, undefined);
    assert.equal(snapshot.portHints.count, 1);
    assert.doesNotMatch(serialized, /Secret customer order/);
    assert.doesNotMatch(serialized, /private\/project/);
    assert.doesNotMatch(serialized, /private\.example/);
    assert.doesNotMatch(serialized, /admin-db/);
    assert.doesNotMatch(serialized, /31337/);
    assert.doesNotMatch(serialized, /chart\.png/);
    assert.doesNotMatch(serialized, /Secret Building/);
    assert.doesNotMatch(serialized, /cmd_secret/);
    assert.doesNotMatch(serialized, /shell with token=secret/);
    assert.doesNotMatch(serialized, /secret-narrative|OPENAI_API_KEY|sk-secret/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("privileged node snapshot exposes sanitized monitor resources and browser URLs", async () => {
  const { stateDir, store } = await createIdentityStore();
  try {
    const service = new NodeSnapshotService({
      nodeIdentityStore: store,
      metadataProvider: () => ({ version: "1.2.3" }),
      sessionsProvider: () => [{
        id: "sess_1",
        name: "Train semantic autogaze",
        status: "running",
        providerId: "codex",
        shellActivity: {
          count: 4,
          lastLabel: "functions.exec_command",
          lastStatus: "completed",
          updatedAt: "2026-05-12T00:01:00.000Z",
        },
        resources: [{
          kind: "wandb",
          url: "https://wandb.ai/mark/semantic-autogaze/runs/run-7?token=secret#workspace",
          source: "session-output",
        }],
        recentNarrative: [{
          id: "entry_1",
          kind: "assistant",
          label: "Saved /Users/mark/private/model.bin",
          text: "Finished with OPENAI_API_KEY=sk-secret in /Users/mark/private/model.bin",
          timestamp: "2026-05-12T00:02:00.000Z",
        }],
      }],
      browserSessionsProvider: () => [{
        id: "browser_1",
        name: "W&B browser",
        callerSessionId: "sess_1",
        latestUrl: "https://wandb.ai/mark/semantic-autogaze/runs/run-7?token=secret#workspace",
        status: "running",
      }],
      appInstancesProvider: () => [{
        id: "appinst_cursor",
        appId: "cursor",
        label: "Cursor",
        status: "launched",
        clientCommandId: "cmd_1",
        url: "https://example.test/open?token=secret#debug",
      }],
    });

    const snapshot = await service.getSnapshot({ mode: "privileged" });
    assert.deepEqual(snapshot.sessions[0].shellActivity, {
      count: 4,
      lastLabel: "functions.exec_command",
      lastStatus: "completed",
      updatedAt: "2026-05-12T00:01:00.000Z",
    });
    assert.deepEqual(snapshot.sessions[0].recentNarrative, [{
      id: "entry_1",
      kind: "assistant",
      label: "Saved [path]",
      text: "Finished with OPENAI_API_KEY=[redacted] in [path]",
      status: "",
      timestamp: "2026-05-12T00:02:00.000Z",
    }]);
    assert.equal(snapshot.sessions[0].resources[0].url, "https://wandb.ai/mark/semantic-autogaze/runs/run-7");
    assert.equal(snapshot.sessions[0].resources[0].sourceSessionId, "sess_1");
    assert.equal(snapshot.browserSessions[0].latestUrl, "https://wandb.ai/mark/semantic-autogaze/runs/run-7");
    assert.equal(snapshot.browserSessions[0].callerSessionId, "sess_1");
    assert.equal(snapshot.appInstances[0].clientCommandId, "cmd_1");
    assert.equal(snapshot.appInstances[0].url, "https://example.test/open");
    assert.doesNotMatch(JSON.stringify(snapshot), /token=secret|#workspace|sk-secret|OPENAI_API_KEY=sk-secret|\/Users\/mark/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("node snapshot prefers canvas-native launchers over duplicate desktop agent apps", async () => {
  const { stateDir, store } = await createIdentityStore();
  try {
    const service = new NodeSnapshotService({
      nodeIdentityStore: store,
      metadataProvider: () => ({ version: "1.2.3" }),
      providersProvider: () => [
        { id: "codex", label: "Codex", defaultName: "Codex", available: true },
        { id: "claude-ollama", label: "Local Claude Code", defaultName: "Local Claude", available: true },
        { id: "shell", label: "Vanilla Shell", defaultName: "Shell", available: true },
      ],
      appLaunchersProvider: () => [
        { id: "codex", label: "Codex", kind: "desktop-app", category: "agent-app", priority: 95, available: true },
        { id: "claude", label: "Claude", kind: "desktop-app", category: "agent-app", priority: 92, available: true },
        { id: "terminal", label: "Terminal", kind: "desktop-app", category: "terminal", priority: 58, available: true },
        { id: "iterm", label: "iTerm", kind: "desktop-app", category: "terminal", priority: 56, available: true },
        { id: "cursor", label: "Cursor", kind: "desktop-app", category: "editor", priority: 90, available: true },
      ],
    });

    const snapshot = await service.getSnapshot({ mode: "privileged" });
    const launcherIds = snapshot.launchers.map((launcher) => launcher.id);
    assert.deepEqual(launcherIds, [
      "provider:codex",
      "provider:claude-ollama",
      "provider:shell",
      "app:cursor",
    ]);
    assert.equal(snapshot.launchers.find((launcher) => launcher.id === "provider:shell")?.label, "Terminal");
    assert.equal(snapshot.launchers.find((launcher) => launcher.id === "provider:shell")?.category, "terminal");
    assert.equal(snapshot.launchers.find((launcher) => launcher.id === "provider:shell")?.description, "Open a persistent terminal inside the canvas on this machine.");
    assert.equal(snapshot.launchers.some((launcher) => launcher.id === "app:codex"), false);
    assert.equal(snapshot.launchers.some((launcher) => launcher.id === "app:claude"), false);
    assert.equal(snapshot.launchers.some((launcher) => launcher.id === "app:terminal"), false);
    assert.equal(snapshot.launchers.some((launcher) => launcher.id === "app:iterm"), false);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("node snapshot reports degraded dependencies instead of hanging", async () => {
  const { stateDir, store } = await createIdentityStore();
  try {
    const service = new NodeSnapshotService({
      nodeIdentityStore: store,
      metadataProvider: () => ({ version: "1.2.3" }),
      sessionsProvider: () => new Promise((resolve) => setTimeout(() => resolve([{ id: "late" }]), 100)),
      timeoutMs: 10,
    });

    const snapshot = await service.getSnapshot({ mode: "redacted" });
    assert.equal(snapshot.counts.sessions, 0);
    assert.equal(snapshot.degraded.some((entry) => entry.source === "sessions" && entry.timedOut), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
