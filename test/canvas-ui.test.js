import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { chromium } from "playwright-core";

import { resolveBrowserExecutablePath } from "../src/browser-runtime.js";
import { createVibeResearchApp } from "../src/create-app.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

async function startApp(options = {}) {
  const cwd = options.cwd || process.cwd();
  const stateDir = options.stateDir || path.join(cwd, ".vibe-research");
  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd,
    stateDir,
    persistSessions: false,
    persistentTerminals: false,
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({
        enabled: settings.preventSleepEnabled,
        platform: "test",
      }),
    ...options,
  });

  return {
    app,
    baseUrl: `http://127.0.0.1:${app.config.port}`,
  };
}

async function createTempWorkspace(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("local canvas view renders node snapshot cards and persists drag layout", async () => {
  const executablePath = await resolveBrowserExecutablePath({ env: process.env });
  if (!executablePath) {
    test.skip("Playwright browser executable is not available in this environment.");
    return;
  }

  const workspaceDir = await createTempWorkspace("swarmlab-canvas-ui-");
  const stateDir = path.join(workspaceDir, ".vibe-research");
  const { app, baseUrl } = await startApp({ cwd: workspaceDir, stateDir });
  let browser = null;

  try {
    const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wikiPath: workspaceDir }),
    });
    assert.equal(settingsResponse.status, 200);

    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("vibeResearch.agentSetupComplete.v1", "1");
      window.localStorage.setItem("vibe-research-guided-onboarding-v2", "1");
      window.localStorage.setItem(
        "swarmlab.canvas.remoteNodes.v1",
        JSON.stringify(["https://gpu-node.example.test", "https://registry-node.example.test"]),
      );
      window.__openedSwarmlabAccountUrls = [];
      window.open = (url) => {
        window.__openedSwarmlabAccountUrls.push(String(url || ""));
        return { closed: false, focus() {} };
      };
    });
    const postedInputs = [];
    const postedRemoteCommands = [];
    const remoteCommandsById = new Map();
    const postedAppLaunches = [];
    let extraLocalPorts = [];
    let extraLocalAppInstances = [];
    const postedRemotePairs = [];
    const dismissedAppInstanceIds = [];
    const deletedSessions = [];
    const directPairStarts = [];
    const directPairCompletes = [];
    const directPairHeartbeats = [];
    const approvedPairings = [];
    const postedFleetNodes = [];
    const postedHandoffJobs = [];
    const remoteSnapshotHits = new Map();
    const directSnapshotHits = new Map();
    const remoteNarrativeRequests = [];
    const extraRemoteSessions = new Map();
    const extraRemotePorts = new Map();
    const extraRemoteAppInstances = new Map();
    const accountPairStarts = [];
    let accountConnected = false;
    const remoteSnapshots = new Map([
      ["https://gpu-node.example.test", {
        id: "gpu-cluster",
        name: "GPU Cluster",
        sessionName: "Remote trainer",
        port: 6006,
      }],
      ["https://registry-node.example.test", {
        id: "registry-box",
        name: "Registry Box",
        sessionName: "Registry worker",
        port: 7007,
      }],
      ["https://query-node.example.test", {
        id: "query-box",
        name: "Query Box",
        sessionName: "Query worker",
        port: 8008,
      }],
      ["https://account-node.example.test", {
        id: "account-box",
        name: "Account Workstation",
        sessionName: "Account worker",
        port: 8108,
      }],
      ["https://manual-node.example.test", {
        id: "manual-box",
        name: "Manual Box",
        sessionName: "Manual worker",
        port: 9009,
      }],
    ]);
    const buildRemoteSnapshotPayload = (origin) => {
      const remote = remoteSnapshots.get(origin);
      return {
        schemaVersion: 1,
        mode: "redacted",
        node: {
          id: remote.id,
          name: remote.name,
          status: "online",
          os: "linux",
          version: "1.0.20",
        },
        sessions: [
          {
            id: `${remote.id}-agent-1`,
            name: remote.sessionName,
            providerId: "codex",
            status: "running",
          },
          ...(extraRemoteSessions.get(origin) || []),
        ],
        ports: [
          { port: remote.port, name: `${remote.name} app`, preferredAccess: "proxy" },
          ...(extraRemotePorts.get(origin) || []),
        ],
        appInstances: [
          ...(extraRemoteAppInstances.get(origin) || []),
        ],
        launchers: origin === "https://account-node.example.test"
          ? [
              { id: "provider:codex", label: "Codex", kind: "agent-provider", providerId: "codex", defaultName: "Codex", available: true },
              { id: "app:cursor", label: "Cursor", kind: "desktop-app", appId: "cursor", available: true, platform: "linux" },
            ]
          : [],
        counts: {
          sessions: 1 + (extraRemoteSessions.get(origin) || []).length,
          ports: 1 + (extraRemotePorts.get(origin) || []).length,
          appInstances: (extraRemoteAppInstances.get(origin) || []).length,
          approvals: 0,
          artifacts: 0,
        },
        generatedAt: "2026-05-12T12:00:10.000Z",
      };
    };
    await page.route(`${baseUrl}/api/node/snapshot**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          node: {
            id: "mac-main",
            name: "Mac Main",
            status: "online",
            os: "darwin",
            version: "1.0.19",
          },
          sessions: [
            {
              id: "session-1",
              name: "Worker B",
              providerId: "codex",
              status: "running",
              cwd: workspaceDir,
              shellActivity: { count: 3, lastLabel: "functions.exec_command", lastStatus: "completed" },
            },
            {
              id: "session-2",
              name: "Old worker",
              providerId: "claude",
              status: "idle",
              cwd: workspaceDir,
            },
          ],
          browserSessions: [
            {
              id: "browser-1",
              name: "Docs browser",
              status: "running",
              latestSnapshot: { url: "https://example.test/docs" },
            },
            {
              id: "wandb-1",
              name: "W&B semantic autogaze",
              status: "running",
              callerSessionId: "session-1",
              latestUrl: "https://wandb.ai/mark/semantic-autogaze/runs/run-7?token=secret#workspace",
            },
          ],
          actionItems: [
            {
              id: "approval-1",
              title: "Approve deploy",
              detail: "Review production gate",
              priority: "high",
              href: "?view=agent-inbox",
            },
            {
              id: "setup-done",
              title: "Connect Telegram",
              status: "completed",
            },
          ],
          ports: [
            ...Array.from({ length: 6 }, (_, index) => ({
              port: 5173 + index,
              name: index === 0 ? "Vite app" : `Preview ${index + 1}`,
              preferredAccess: index % 2 ? "direct" : "proxy",
            })),
            ...extraLocalPorts,
          ],
          appInstances: extraLocalAppInstances,
          launchers: [
            { id: "provider:codex", label: "Codex", kind: "agent-provider", providerId: "codex", defaultName: "Codex", available: true },
            { id: "app:browser", label: "Browser", kind: "canvas-app", category: "browser", appId: "browser", canvasSurface: "browser", available: true },
            { id: "app:cursor", label: "Cursor", kind: "desktop-app", appId: "cursor", available: true, platform: "darwin" },
            { id: "provider:claude", label: "Claude Code", kind: "agent-provider", providerId: "claude", defaultName: "Claude", available: true },
            { id: "app:vscode", label: "VS Code", kind: "desktop-app", category: "editor", appId: "vscode", available: true, platform: "darwin" },
            { id: "app:terminal", label: "Terminal", kind: "desktop-app", category: "terminal", appId: "terminal", available: true, platform: "darwin" },
            { id: "app:chrome", label: "Chrome", kind: "desktop-app", category: "browser", appId: "chrome", available: true, platform: "darwin" },
            { id: "app:docker", label: "Docker", kind: "desktop-app", category: "runtime", appId: "docker", available: true, platform: "darwin" },
            { id: "app:xcode", label: "Xcode", kind: "desktop-app", category: "developer", appId: "xcode", available: true, platform: "darwin" },
            { id: "app:opencode", label: "OpenCode", kind: "desktop-app", category: "agent", appId: "opencode", available: true, platform: "darwin" },
            { id: "app:iterm", label: "iTerm", kind: "desktop-app", category: "terminal", appId: "iterm", available: true, platform: "darwin" },
            { id: "app:safari", label: "Safari", kind: "desktop-app", category: "browser", appId: "safari", available: true, platform: "darwin" },
            { id: "app:figma", label: "Figma", kind: "desktop-app", category: "design", appId: "figma", available: true, platform: "darwin" },
            { id: "app:slack", label: "Slack", kind: "desktop-app", category: "communication", appId: "slack", available: true, platform: "darwin" },
            { id: "app:zoom", label: "Zoom", kind: "desktop-app", category: "communication", appId: "zoom", available: true, platform: "darwin" },
            { id: "app:notes", label: "Notes", kind: "desktop-app", category: "writing", appId: "notes", available: true, platform: "darwin" },
          ],
          handoffJobs: [
            {
              id: "deploy-pi",
              title: "Train on GPU deploy to Pi",
              status: "launched",
              launchedSessionId: "session-1",
              target: { label: "home pi", sshTarget: "pi@home-raspi" },
              objectivePreview: "Train on the GPU cluster, transfer the model to the Pi, and run a smoke test.",
              steps: [
                { id: "train", title: "Train model", status: "pending" },
                { id: "transfer", title: "Transfer artifact", status: "pending" },
              ],
              updatedAt: "2026-05-12T12:00:05.000Z",
            },
          ],
          brain: {
            relativeRoot: "brain",
            noteCount: 2,
            edgeCount: 1,
            notes: [
              {
                relativePath: "index.md",
                title: "Swarmlab brain",
                excerpt: "Machine handoff notes and research memory.",
                links: ["models/pi-deploy.md"],
              },
              {
                relativePath: "models/pi-deploy.md",
                title: "Pi deploy",
                takeaway: "GPU training should publish a checked artifact before Pi validation.",
                links: [],
              },
            ],
          },
          canvases: [
            {
              id: "artifact-1",
              title: "Result chart",
              caption: "Best local artifact",
            },
          ],
          generatedAt: "2026-05-12T12:00:00.000Z",
        }),
      });
    });
    await page.route(`${baseUrl}/api/node/account/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          account: {
            enabled: true,
            connected: accountConnected,
            configured: accountConnected,
            running: accountConnected,
            appBaseUrl: baseUrl,
            account: accountConnected ? { login: "mark" } : null,
            node: accountConnected ? { displayName: "Mac Main" } : null,
          },
        }),
      });
    });
    await page.route(`${baseUrl}/api/node/account/pair/start`, async (route) => {
      accountPairStarts.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          pairing: {
            pairingId: "pair_canvas_login",
            pairingCode: "PAIR-CANVAS",
            pairingUrl: `${baseUrl}/account/pair?pairingId=pair_canvas_login`,
          },
        }),
      });
    });
    await page.route(`${baseUrl}/api/node/account/nodes`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nodes: [
            {
              id: "account-node",
              nodeId: "account-node",
              displayName: "Account Workstation",
              status: "online",
              connectionHints: [{ kind: "public", url: "https://account-node.example.test" }],
            },
            {
              id: "self-account-node",
              nodeId: "mac-main",
              displayName: "This Mac over Tailscale",
              status: "online",
              connectionHints: [{ kind: "public", url: "https://self-node.example.test" }],
            },
          ],
        }),
      });
    });
    await page.route(`${baseUrl}/api/account/nodes`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nodes: [
            {
              id: "account-node",
              nodeId: "account-node",
              displayName: "Account Workstation",
              status: "online",
              connectionHints: [{ kind: "public", url: "https://account-node.example.test" }],
            },
            {
              id: "self-account-node",
              nodeId: "mac-main",
              displayName: "This Mac over Tailscale",
              status: "online",
              connectionHints: [{ kind: "public", url: "https://self-node.example.test" }],
            },
          ],
        }),
      });
    });
    await page.route("**/api/node/account/nodes/account-node/commands**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET") {
        const commandId = decodeURIComponent(url.pathname.split("/").pop() || "");
        const command = remoteCommandsById.get(commandId);
        await route.fulfill({
          status: command ? 200 : 404,
          contentType: "application/json",
          body: JSON.stringify(command ? { command } : { error: "not found" }),
        });
        return;
      }
      const body = JSON.parse(route.request().postData() || "{}");
      postedRemoteCommands.push(body);
      const commandId = `cmd_canvas_${postedRemoteCommands.length}`;
      const command = {
        id: commandId,
        nodeId: "account-node",
        operation: body.operation,
        clientCommandId: body.clientCommandId || "",
        status: "queued",
        createdAt: "2026-05-12T12:02:00.000Z",
        updatedAt: "2026-05-12T12:02:00.000Z",
        result: {},
      };
      remoteCommandsById.set(commandId, command);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          command,
        }),
      });
    });
    await page.route(`${baseUrl}/api/node/remote-session-narrative**`, async (route) => {
      const url = new URL(route.request().url());
      const nodeId = url.searchParams.get("nodeId") || "";
      const sessionId = url.searchParams.get("sessionId") || "";
      remoteNarrativeRequests.push({ nodeId, sessionId });
      if (nodeId !== "account-node" || sessionId !== "account-box-agent-1") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not paired for native chat" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          node: { nodeId: "account-node", displayName: "Account Workstation", status: "online" },
          sessionId,
          narrative: {
            sourceLabel: "Remote native chat",
            providerId: "codex",
            updatedAt: "2026-05-12T12:03:00.000Z",
            entries: [
              {
                id: "remote-entry-1",
                kind: "assistant",
                label: "Agent",
                text: "Remote native history from account node.",
                timestamp: "2026-05-12T12:03:00.000Z",
              },
            ],
          },
        }),
      });
    });
    await page.route(`${baseUrl}/api/node/remote-pair`, async (route) => {
      postedRemotePairs.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "controller cannot reach gpu in test" }),
      });
    });
    await page.route(`${baseUrl}/api/account/nodes/pairing/approve`, async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      approvedPairings.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          pairingId: body.pairingId,
          redirectUri: `${baseUrl}/account/auth/complete?grant=grant_canvas_pair&pairingId=${encodeURIComponent(body.pairingId || "")}`,
        }),
      });
    });
    await page.route("https://gpu-node.example.test/api/node/account/pair/start", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Vibe-Research-API",
          },
        });
        return;
      }
      directPairStarts.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          pairing: {
            pairingId: "pair_canvas_gpu",
            pairingCode: "PAIR-GPU",
          },
        }),
      });
    });
    await page.route("https://gpu-node.example.test/api/node/account/pair/complete", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Vibe-Research-API",
          },
        });
        return;
      }
      directPairCompletes.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          record: {
            appBaseUrl: directPairCompletes.at(-1).accountBaseUrl,
            node: { nodeId: "gpu-cluster", displayName: "GPU Cluster" },
          },
        }),
      });
    });
    await page.route("https://gpu-node.example.test/api/node/account/heartbeat", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Vibe-Research-API",
          },
        });
        return;
      }
      directPairHeartbeats.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ heartbeat: { ok: true } }),
      });
    });
    await page.route(`${baseUrl}/api/fleet/nodes`, async (route) => {
      if (route.request().method() === "POST") {
        postedFleetNodes.push(JSON.parse(route.request().postData() || "{}"));
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            node: {
              id: "posted-node",
              url: postedFleetNodes.at(-1).url,
              baseUrl: postedFleetNodes.at(-1).url,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nodes: [
            {
              id: "registry-node",
              baseUrl: "https://registry-node.example.test",
              label: "Registry node",
            },
            {
              id: "offline-gpu",
              baseUrl: "https://offline-node.example.test/private?token=registry",
              label: "Known Offline GPU",
              displayName: "Known Offline GPU",
              status: "stale",
              lastSeenAt: "2026-05-12T11:30:00.000Z",
              os: "linux",
              swarmlabVersion: "1.0.18",
              counts: { sessions: 2, ports: 1, handoffJobs: 1 },
              capabilities: {
                gpuCount: 6,
                providerCount: 2,
                roles: ["agent-host", "gpu-worker"],
              },
            },
          ],
        }),
      });
    });
    await page.route("**/api/node/remote-snapshot**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const origin = new URL(requestUrl.searchParams.get("baseUrl") || "").origin;
      remoteSnapshotHits.set(origin, (remoteSnapshotHits.get(origin) || 0) + 1);
      if (origin === "https://offline-node.example.test" || origin === "https://registry-node.example.test") {
        if (requestUrl.searchParams.get("allowDirectFallback") === "1") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              baseUrl: origin,
              directFallbackAllowed: true,
              error: "Remote node proxy could not reach node.",
            }),
          });
          return;
        }
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: origin === "https://offline-node.example.test" ? "offline in test" : "proxy cannot reach registry in test" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          baseUrl: origin,
          snapshot: buildRemoteSnapshotPayload(origin),
        }),
      });
    });
    await page.route("https://*.example.test/api/node/snapshot**", async (route) => {
      const origin = new URL(route.request().url()).origin;
      directSnapshotHits.set(origin, (directSnapshotHits.get(origin) || 0) + 1);
      if (origin === "https://offline-node.example.test") {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "offline in test" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildRemoteSnapshotPayload(origin)),
      });
    });
    await page.route("**/api/sessions/session-1/narrative", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative: {
            providerId: "codex",
            providerLabel: "Codex",
            providerBacked: true,
            sourceLabel: "Codex session file",
            updatedAt: "2026-05-12T12:01:00.000Z",
            entries: [
              {
                id: "u1",
                kind: "user",
                label: "You",
                text: "Please inspect the dashboard.",
                timestamp: "2026-05-12T12:00:01.000Z",
              },
              {
                id: "a1",
                kind: "assistant",
                label: "Codex",
                text: "I found the canvas route and rendered the native session feed.",
                timestamp: "2026-05-12T12:00:03.000Z",
              },
              ...Array.from({ length: 10 }, (_, index) => ({
                id: `h${index + 1}`,
                kind: index % 2 ? "assistant" : "user",
                label: index % 2 ? "Codex" : "You",
                text: `Follow-up ${index + 1}: keep the machine-region canvas history visible while the agent keeps working.`,
                timestamp: `2026-05-12T12:00:${String(index + 4).padStart(2, "0")}.000Z`,
              })),
            ],
          },
        }),
      });
    });
    await page.route("**/api/sessions/session-1/input", async (route) => {
      postedInputs.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, session: { id: "session-1" } }),
      });
    });
    await page.route(`${baseUrl}/api/node/apps/launch`, async (route) => {
      postedAppLaunches.push(JSON.parse(route.request().postData() || "{}"));
      const appId = postedAppLaunches.at(-1).appId;
      if (appId === "cursor" && postedAppLaunches.filter((entry) => entry.appId === "cursor").length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const isBrowser = appId === "browser";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          launched: true,
          embedded: isBrowser,
          surface: isBrowser ? "browser" : "",
          launcher: isBrowser
            ? { id: appId, label: "Browser", kind: "canvas-app", category: "browser", canvasSurface: "browser" }
            : { id: appId },
          instance: {
            appId,
            launcherId: appId,
            label: appId === "cursor" ? "Cursor" : isBrowser ? "Browser" : appId,
            kind: isBrowser ? "canvas-app" : "desktop-app",
            category: isBrowser ? "browser" : "",
            surface: isBrowser ? "browser" : "",
            url: isBrowser ? "" : `https://canvas-app.example.test/${appId}/`,
          },
        }),
      });
    });
    await page.route(`${baseUrl}/api/node/apps/instances/**`, async (route) => {
      const instanceId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() || "");
      dismissedAppInstanceIds.push(instanceId);
      extraLocalAppInstances = extraLocalAppInstances.map((instance) => instance.id === instanceId
        ? {
            ...instance,
            status: "dismissed",
            dismissedAt: "2026-05-13T10:04:00.000Z",
            updatedAt: "2026-05-13T10:04:00.000Z",
          }
        : instance);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          instance: extraLocalAppInstances.find((instance) => instance.id === instanceId) || { id: instanceId, status: "dismissed" },
        }),
      });
    });
    await page.route(`${baseUrl}/api/sessions/session-1`, async (route) => {
      if (route.request().method() === "DELETE") {
        deletedSessions.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route(`${baseUrl}/api/handoff/jobs`, async (route) => {
      postedHandoffJobs.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          job: { id: "new-handoff", title: postedHandoffJobs.at(-1).title },
          jobs: [],
        }),
      });
    });

    await page.goto(`${baseUrl}/?view=canvas&node=https%3A%2F%2Fquery-node.example.test%2Fprivate%3Ftoken%3Dsecret`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".swarmlab-canvas-card", { timeout: 10_000 });
    await page.waitForSelector(".swarmlab-agent-message.is-agent", { timeout: 10_000 });
    await mkdir(path.join(process.cwd(), "output/playwright"), { recursive: true });
    await page.screenshot({
      path: path.join(process.cwd(), "output/playwright/swarmlab-canvas-curated.png"),
      fullPage: false,
    });

    const rendered = await page.evaluate(() => document.body.innerText);
    assert.match(rendered, /Swarmlab Canvas/);
    assert.match(rendered, /Mac Main/);
    assert.match(rendered, /GPU Cluster/);
    assert.match(rendered, /Registry Box/);
    assert.match(rendered, /Query Box/);
    assert.match(rendered, /Account Workstation/);
    assert.match(rendered, /Known Offline GPU/);
    assert.match(rendered, /Remote trainer/);
    assert.match(rendered, /Registry worker/);
    assert.match(rendered, /Query worker/);
    assert.match(rendered, /Account worker/);
    assert.match(rendered, /gpu-node\.example\.test/);
    assert.match(rendered, /registry-node\.example\.test/);
    assert.match(rendered, /query-node\.example\.test/);
    assert.match(rendered, /account-node\.example\.test/);
    assert.doesNotMatch(rendered, /self-node\.example\.test|This Mac over Tailscale/);
    assert.match(rendered, /2 sessions, 1 apps, 1 handoffs/);
    assert.match(rendered, /6 gpus/i);
    assert.doesNotMatch(rendered, /private|token=secret|token=registry/);
    assert.match(rendered, /Worker B/);
    assert.match(rendered, /Quiet agents/);
    assert.match(rendered, /Resolved requests/);
    assert.match(rendered, /Approve deploy/);
    assert.match(rendered, /Train on GPU deploy to Pi/);
    assert.match(rendered, /Train model/);
    assert.match(rendered, /Swarmlab brain/);
    assert.match(rendered, /Pi deploy/);
    assert.doesNotMatch(rendered, /More local apps|Local apps/);
    assert.match(rendered, /Vite app/);
    assert.match(rendered, /Result chart/);
    assert.equal(
      await page.locator("[data-swarmlab-canvas-new-handoff]").getAttribute("aria-label"),
      "New handoff",
    );
    assert.equal(
      await page.locator("[data-swarmlab-canvas-account-login]").getAttribute("aria-label"),
      "Log in to Vibe Research",
    );
    assert.doesNotMatch(rendered, /Add machine/);
    assert.match(rendered, /Please inspect the dashboard/);
    assert.match(rendered, /native session feed/);
    assert.equal(await page.locator("[data-swarmlab-canvas-shell-dock]").getAttribute("aria-label"), "Shells on Mac Main");
    assert.match(await page.locator("[data-swarmlab-canvas-shell-dock]").innerText(), /Worker B/);
    assert.match(await page.locator("[data-swarmlab-canvas-shell-dock]").innerText(), /3 shell calls/);
    assert.match(rendered, /Follow-up 10/);
    assert.match(rendered, /Weights & Biases/);
    assert.match(rendered, /semantic-autogaze \/ run run-7/);
    assert.doesNotMatch(rendered, /token=secret/);
    assert.equal(await page.locator(".swarmlab-agent-chat-window").count(), 5);
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-entry-id]').count(), 12);
    assert.match(
      await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] .swarmlab-agent-history-meta').innerText(),
      /12 messages/,
    );
    await page.locator('[data-swarmlab-canvas-card-id="handoff:deploy-pi"] [data-swarmlab-canvas-open-session]').evaluate((button) => button.click());
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:session-1"][data-swarmlab-canvas-focused-card="true"]', { timeout: 10_000 });
    assert.equal(new URL(page.url()).searchParams.get("view"), "canvas");
    await page.waitForFunction(() => {
      const active = document.activeElement;
      return active instanceof HTMLTextAreaElement
        && active.closest('[data-swarmlab-canvas-card-id="session:session-1"]');
    });
    assert.match(await page.locator("[data-swarmlab-canvas-notice]").innerText(), /Focused session on the canvas/);
    const localAgentSize = await page.locator('[data-swarmlab-canvas-card-id="session:session-1"]').evaluate((element) => ({
      width: Number.parseFloat(element.style.width || "0"),
      height: Number.parseFloat(element.style.height || "0"),
    }));
    assert.ok(localAgentSize.width >= 620, "local agent canvas card should be a large work surface");
    assert.ok(localAgentSize.height >= 700, "local agent canvas card should preserve visible chat history");
    const composerBox = await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-composer]').boundingBox();
    assert.ok(composerBox && composerBox.height <= 62, "canvas chat composer should stay compact on a large agent card");
    assert.equal(await page.locator(".swarmlab-canvas-card.is-summary:not(.is-remote)").count(), 2);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-machine").count(), 0);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-remote").count(), 8);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-launcher").count(), 0);
    assert.equal(await page.locator(".swarmlab-canvas-launch-dock").count(), 1);
    const openLaunchDock = async () => {
      const dock = page.locator(".swarmlab-canvas-launch-dock");
      if (!await dock.evaluate((element) => element.classList.contains("is-open"))) {
        await page.locator("[data-swarmlab-canvas-toggle-launch-dock]").click();
      }
      await page.locator(".swarmlab-canvas-launch-panel").waitFor({ state: "visible" });
    };
    assert.equal(await page.locator("[data-swarmlab-canvas-launch-machine]").count(), 0);
    assert.equal(await page.locator("[data-swarmlab-canvas-launcher]").count(), 16);
    assert.equal(await page.locator(".swarmlab-canvas-launch-items > [data-swarmlab-canvas-launcher]").count(), 6);
    assert.equal(await page.locator(".swarmlab-canvas-launch-more-button").getAttribute("title"), "Show 10 more launchers");
    assert.equal(await page.locator(".swarmlab-canvas-launch-more-button").getAttribute("aria-label"), "Show 10 more launchers");
    const dockBox = await page.locator(".swarmlab-canvas-launch-dock").boundingBox();
    const controlsBox = await page.locator(".swarmlab-canvas-floating-controls").boundingBox();
    assert.ok(dockBox && dockBox.height <= 64, "app launcher dock should stay compact");
    assert.ok(
      dockBox && controlsBox && controlsBox.y + controlsBox.height < dockBox.y,
      "zoom controls should sit above the app dock without overlap",
    );
    const originalViewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.setViewportSize({ width: 669, height: 832 });
    const compactDockBox = await page.locator(".swarmlab-canvas-launch-dock").boundingBox();
    const compactControlsBox = await page.locator(".swarmlab-canvas-floating-controls").boundingBox();
    assert.ok(compactDockBox && compactDockBox.height <= 64, "app launcher dock should stay one row in the in-app browser width");
    assert.ok(
      compactDockBox && compactControlsBox && compactControlsBox.y + compactControlsBox.height < compactDockBox.y,
      "zoom controls should stay above the app dock in the in-app browser width",
    );
    await page.setViewportSize(originalViewport);
    await openLaunchDock();
    const directLauncherBox = await page.locator(".swarmlab-canvas-launch-items > [data-swarmlab-canvas-launcher]").first().boundingBox();
    assert.ok(directLauncherBox && directLauncherBox.width <= 62, "dock launcher buttons should be icon-scale");
    await page.locator(".swarmlab-canvas-launch-more-button").click();
    await page.locator(".swarmlab-canvas-launch-more-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator(".swarmlab-canvas-launch-more-panel [data-swarmlab-canvas-launcher]").count(), 10);
    const morePanelBox = await page.locator(".swarmlab-canvas-launch-more-panel").boundingBox();
    const openControlsBox = await page.locator(".swarmlab-canvas-floating-controls").boundingBox();
    assert.ok(
      morePanelBox && openControlsBox && (
        morePanelBox.x + morePanelBox.width <= openControlsBox.x
        || openControlsBox.x + openControlsBox.width <= morePanelBox.x
        || morePanelBox.y + morePanelBox.height <= openControlsBox.y
        || openControlsBox.y + openControlsBox.height <= morePanelBox.y
      ),
      "launcher overflow panel should not cover zoom controls or intercept their clicks",
    );
    await page.locator(".swarmlab-canvas-stage").click({ position: { x: 24, y: 122 } });
    await page.locator(".swarmlab-canvas-launch-more-panel").waitFor({ state: "hidden" });
    await page.locator(".swarmlab-canvas-launch-panel").waitFor({ state: "hidden" });
    await openLaunchDock();
    await page.locator(".swarmlab-canvas-launch-more-button").click();
    await page.locator(".swarmlab-canvas-launch-more-panel").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator(".swarmlab-canvas-launch-more-panel").waitFor({ state: "hidden" });
    await page.locator(".swarmlab-canvas-launch-panel").waitFor({ state: "hidden" });
    await openLaunchDock();
    await page.locator(".swarmlab-canvas-launch-more-button").click();
    await page.locator(".swarmlab-canvas-launch-more-panel").waitFor({ state: "visible" });
    await page.locator(".swarmlab-canvas-launch-more-button").click();
    await page.locator(".swarmlab-canvas-launch-more-panel").waitFor({ state: "hidden" });
    const dockText = await page.locator(".swarmlab-canvas-launch-dock").innerText();
    assert.match(dockText, /canvas/);
    assert.match(dockText, /desktop/);
    assert.match(dockText, /Mac Main/i);
    assert.match(dockText, /Codex/);
    assert.match(dockText, /Cursor/);
    assert.equal(
      await page.locator('[data-swarmlab-canvas-launcher="launcher:provider:codex"]').getAttribute("aria-label"),
      "Start Codex as a canvas chat",
    );
    assert.equal(
      await page.locator('[data-swarmlab-canvas-launcher="launcher:app:browser"]').getAttribute("aria-label"),
      "Open Browser in the canvas",
    );
    assert.equal(
      await page.locator('[data-swarmlab-canvas-launcher="launcher:app:browser"]').getAttribute("data-swarmlab-launch-surface"),
      "canvas",
    );
    assert.equal(
      await page.locator('[data-swarmlab-canvas-launcher="launcher:app:cursor"]').getAttribute("aria-label"),
      "Open Cursor on this machine",
    );
    assert.doesNotMatch(dockText, /Account Workstation/);
    assert.doesNotMatch(dockText, /GPU Cluster/);
    assert.doesNotMatch(dockText, /\b\d+\s+apps?\b/i, "machine app counts should stay in labels, not visible dock chrome");
    assert.equal(await page.locator(".swarmlab-canvas-machine-rail").count(), 1);
    assert.equal(await page.locator("[data-swarmlab-canvas-focus-region]").count(), 6);
    const machineRailText = await page.locator(".swarmlab-canvas-machine-rail").innerText();
    assert.match(machineRailText, /Mac Main/);
    assert.match(machineRailText, /GPU Cluster/);
    assert.equal(await page.locator(".swarmlab-canvas-machine-rail").getAttribute("aria-label"), "Machine regions");
    assert.doesNotMatch(machineRailText, /\b\d+\s+apps?\b/i, "machine rail should navigate regions without duplicating app launcher state");
    const regionIds = await page.locator(".swarmlab-canvas-region").evaluateAll((regions) =>
      regions.map((region) => region.getAttribute("data-swarmlab-canvas-region-id")).filter(Boolean),
    );
    assert.deepEqual(regionIds, ["mac-main", "registry-box", "offline-gpu", "account-box", "gpu-cluster", "query-box"]);
    const regionMetrics = await page.evaluate(() => {
      const regions = document.querySelector("[data-swarmlab-canvas-root]")?.__swarmlabCanvasRegionsById || {};
      return Object.fromEntries(Object.entries(regions).map(([id, region]) => [
        id,
        { width: region.width, height: region.height },
      ]));
    });
    assert.ok(regionMetrics["offline-gpu"]?.width <= 980, "quiet machine regions should not reserve a huge board lane");
    assert.ok(regionMetrics["offline-gpu"]?.height <= 720, "quiet machine regions should be compact until work appears there");
    assert.equal(await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="mac-main"]').count(), 1);
    assert.equal(await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="account-box"]').getAttribute("data-swarmlab-canvas-region-remote-node-id"), "account-node");
    assert.equal(await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="gpu-cluster"]').getAttribute("data-swarmlab-canvas-region-remote-node-id"), null);
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="mac-main"] .swarmlab-canvas-region-badges').innerText(),
      /local/i,
    );
    assert.equal(remoteSnapshotHits.get("https://self-node.example.test") || 0, 0);
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="account-box"] .swarmlab-canvas-region-badges').innerText(),
      /account/i,
    );
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="gpu-cluster"] .swarmlab-canvas-region-badges').innerText(),
      /view only/i,
    );
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="mac-main"] .swarmlab-canvas-region-drop-label').innerText(),
      /Move here/i,
    );
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="account-box"] .swarmlab-canvas-region-drop-label').innerText(),
      /Copy here/i,
    );
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="gpu-cluster"] .swarmlab-canvas-region-drop-label').innerText(),
      /Pair first/i,
    );
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="session:session-1"]').getAttribute("data-swarmlab-canvas-machine-id"), "mac-main");
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="session:session-1"]').getAttribute("data-swarmlab-canvas-region-id"), "mac-main");
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"]').getAttribute("data-swarmlab-canvas-machine-id"), "account-box");
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"]').getAttribute("data-swarmlab-canvas-region-id"), "account-box");
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="remote:gpu-cluster:session:gpu-cluster-agent-1"] [data-swarmlab-agent-composer]').count(), 0);
    assert.match(await page.locator('[data-swarmlab-canvas-card-id="remote:gpu-cluster:session:gpu-cluster-agent-1"]').innerText(), /Pair this machine for native chat/);
    assert.equal(await page.locator(".swarmlab-canvas-pipe.is-control").count(), 1);
    assert.equal(await page.locator(".swarmlab-canvas-pipe.is-resource").count(), 1);
    assert.equal(
      await page.locator('[data-swarmlab-canvas-pipe-card-id="monitor:wandb-1"].is-resource').getAttribute("data-swarmlab-canvas-pipe-source-card-id"),
      "session:session-1",
    );
    assert.equal(await page.locator(".swarmlab-canvas-floating-controls").count(), 1);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-monitor:not(.is-remote)").count(), 1);
    assert.equal(
      await page.locator('[data-swarmlab-canvas-card-id="monitor:wandb-1"] a.swarmlab-canvas-open').getAttribute("href"),
      "https://wandb.ai/mark/semantic-autogaze/runs/run-7",
    );
    assert.equal(await page.locator(".swarmlab-canvas-card.is-app").count(), 8);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-app:not(.is-remote)").count(), 4);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-handoff:not(.is-remote)").count(), 1);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-brain:not(.is-remote)").count(), 1);
    assert.ok(await page.locator(".swarmlab-canvas-app-frame").count() >= 4);
    assert.equal(
      await page.locator(".swarmlab-canvas-stage").getAttribute("data-swarmlab-canvas-board-id"),
      "fleet:mac-main",
    );
    assert.equal(remoteSnapshotHits.get("https://registry-node.example.test"), 1);
    assert.equal(remoteSnapshotHits.get("https://account-node.example.test"), 1);
    assert.equal(remoteSnapshotHits.get("https://offline-node.example.test"), 1);
    assert.equal(directSnapshotHits.get("https://registry-node.example.test"), 1);
    assert.equal(directSnapshotHits.get("https://offline-node.example.test"), 1);
    assert.equal(directSnapshotHits.get("https://gpu-node.example.test"), undefined);
    assert.equal(
      await page.locator('[data-swarmlab-canvas-card-id="remote:gpu-cluster:session:gpu-cluster-agent-1"] a.swarmlab-canvas-open').getAttribute("href"),
      "https://gpu-node.example.test/?view=shell&sessionId=gpu-cluster-agent-1",
    );
    assert.equal(
      await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"] a.swarmlab-canvas-open').getAttribute("href"),
      "https://account-node.example.test/?view=shell&sessionId=account-box-agent-1",
    );
    assert.equal(
      await page.locator(".swarmlab-canvas-stage").evaluate((element) => getComputedStyle(element).overflow),
      "hidden",
    );
    const initialViewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v4:fleet:mac-main") || "{}"),
    );
    assert.ok(initialViewport.zoom >= 0.42, "initial safe fit should persist a usable zoom");
    const toolbarBox = await page.locator(".swarmlab-canvas-toolbar").boundingBox();
    const refreshButtonBox = await page.locator("[data-swarmlab-canvas-refresh]").boundingBox();
    assert.ok(
      toolbarBox && refreshButtonBox && refreshButtonBox.x + refreshButtonBox.width <= toolbarBox.x + toolbarBox.width + 1,
      "canvas toolbar actions should remain visible inside the view width",
    );
    const toolbarViewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.setViewportSize({ width: 1168, height: 720 });
    const compactToolbarBox = await page.locator(".swarmlab-canvas-toolbar").boundingBox();
    const compactRefreshButtonBox = await page.locator("[data-swarmlab-canvas-refresh]").boundingBox();
    assert.ok(
      compactToolbarBox && compactRefreshButtonBox && compactRefreshButtonBox.x + compactRefreshButtonBox.width <= compactToolbarBox.x + compactToolbarBox.width + 1,
      "canvas toolbar should collapse action labels before controls clip in the in-app browser width",
    );
    await page.setViewportSize(toolbarViewport);
    await page.click('[data-swarmlab-canvas-focus-region="gpu-cluster"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-swarmlab-canvas-focus-region="gpu-cluster"]')?.getAttribute("aria-current") === "true",
    );
    await openLaunchDock();
    assert.match(await page.locator(".swarmlab-canvas-launch-dock").innerText(), /GPU Cluster/);
    const railViewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v4:fleet:mac-main") || "{}"),
    );
    assert.notDeepEqual(railViewport, initialViewport, "machine rail selection should focus the selected region");
    await page.evaluate(() => {
      const root = document.querySelector("[data-swarmlab-canvas-root]");
      window.localStorage.setItem(root.dataset.swarmlabCanvasViewportStorageKey, JSON.stringify({ x: -7200, y: -5200, zoom: 0.62 }));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:session-1"]', { timeout: 10_000 });
    const recoveredViewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v4:fleet:mac-main") || "{}"),
    );
    assert.notEqual(recoveredViewport.x, -7200, "blank saved canvas viewports should refit to active local work");
    const recoveredBox = await page.locator('[data-swarmlab-canvas-card-id="session:session-1"]').boundingBox();
    const recoveredStage = await page.locator(".swarmlab-canvas-stage").boundingBox();
    const recoveredVisibleWidth = recoveredBox && recoveredStage
      ? Math.min(recoveredBox.x + recoveredBox.width, recoveredStage.x + recoveredStage.width)
        - Math.max(recoveredBox.x, recoveredStage.x)
      : 0;
    const recoveredVisibleHeight = recoveredBox && recoveredStage
      ? Math.min(recoveredBox.y + recoveredBox.height, recoveredStage.y + recoveredStage.height)
        - Math.max(recoveredBox.y, recoveredStage.y)
      : 0;
    assert.ok(
      recoveredVisibleWidth > 120 && recoveredVisibleHeight > 120,
      "viewport recovery should put the active local agent back on screen",
    );
    await page.evaluate(() => {
      const root = document.querySelector("[data-swarmlab-canvas-root]");
      const item = root?.__swarmlabCanvasLayout?.["session:session-1"];
      if (!root || !item) return;
      const rect = root.getBoundingClientRect();
      const zoom = 0.4;
      const viewport = {
        x: Math.round(rect.width / 2 - (Number(item.x) + Number(item.width) / 2) * zoom),
        y: Math.round(rect.height / 2 - (Number(item.y) + Number(item.height) / 2) * zoom),
        zoom,
      };
      window.localStorage.setItem(root.dataset.swarmlabCanvasViewportStorageKey, JSON.stringify(viewport));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:session-1"]', { timeout: 10_000 });
    const refitLegacyViewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v4:fleet:mac-main") || "{}"),
    );
    assert.ok(
      Number(refitLegacyViewport.zoom) >= 0.5,
      "legacy miniature canvas viewports should reopen around active agent work instead of staying tiny",
    );

    assert.equal(
      await page.locator('[data-swarmlab-canvas-region-id="mac-main"] [data-swarmlab-canvas-region-resize="mac-main"].is-header').count(),
      1,
    );
    const regionHandle = page.locator('[data-swarmlab-canvas-region-id="mac-main"] [data-swarmlab-canvas-region-resize="mac-main"].is-corner');
    assert.equal(await regionHandle.count(), 1);
    const resizeStart = await page.evaluate(() => {
      const root = document.querySelector("[data-swarmlab-canvas-root]");
      const plane = root?.querySelector("[data-swarmlab-canvas-plane]");
      const region = root?.__swarmlabCanvasRegionsById?.["mac-main"];
      if (!root || !plane || !region) return null;
      const rect = root.getBoundingClientRect();
      const zoom = 0.5;
      const boardX = region.x + region.width - 20;
      const boardY = region.y + region.height - 20;
      const targetX = Math.max(220, rect.width - 180);
      const targetY = Math.max(220, rect.height - 180);
      const viewport = {
        x: Math.round(targetX - boardX * zoom),
        y: Math.round(targetY - boardY * zoom),
        zoom,
      };
      root.__swarmlabCanvasViewport = viewport;
      plane.style.setProperty("--canvas-pan-x", `${viewport.x}px`);
      plane.style.setProperty("--canvas-pan-y", `${viewport.y}px`);
      plane.style.setProperty("--canvas-zoom", `${viewport.zoom}`);
      window.localStorage.setItem(root.dataset.swarmlabCanvasViewportStorageKey, JSON.stringify(viewport));
      return { width: region.width, height: region.height };
    });
    assert.ok(resizeStart, "region resize handle should be focusable in the viewport");
    const resizeBox = await regionHandle.boundingBox();
    assert.ok(resizeBox, "region resize handle should be visible");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    assert.equal(await page.locator(".swarmlab-canvas-stage.is-region-resizing").count(), 1);
    await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 96, resizeBox.y + resizeBox.height / 2 + 72, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.locator(".swarmlab-canvas-stage.is-region-resizing").count(), 0);
    const resizedLayout = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.layout.v7:fleet:mac-main") || "{}"),
    );
    assert.ok(
      resizedLayout["machine:mac-main"].regionWidth > resizeStart.width,
      "resizing a machine region should persist the wider region bounds",
    );
    assert.ok(
      resizedLayout["machine:mac-main"].regionHeight > resizeStart.height,
      "resizing a machine region should persist the taller region bounds",
    );
    assert.match(
      await page.locator('[data-swarmlab-canvas-region-id="mac-main"] [data-swarmlab-canvas-region-size]').innerText(),
      new RegExp(`${resizedLayout["machine:mac-main"].regionWidth} x ${resizedLayout["machine:mac-main"].regionHeight}`),
      "region resize readout should track the saved region bounds",
    );
    await page.locator('[data-swarmlab-canvas-focus-region="mac-main"]').evaluate((button) => button.click());
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:session-1"]', { timeout: 10_000 });

    await openLaunchDock();
    await page.click('[data-swarmlab-canvas-launcher="launcher:app:browser"]');
    for (let attempt = 0; attempt < 20 && postedAppLaunches.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedAppLaunches.length, 1);
    assert.equal(postedAppLaunches[0].appId, "browser");
    const browserCard = page.locator(".swarmlab-canvas-card.is-app.is-launched-app").filter({ hasText: "Browser" });
    await browserCard.waitFor({ timeout: 10_000 });
    assert.equal(await browserCard.locator("[data-swarmlab-canvas-webview-form]").count(), 1);
    await browserCard.locator("[data-swarmlab-canvas-webview-form] input").fill("localhost:4173");
    await browserCard.locator("[data-swarmlab-canvas-webview-form] button").click();
    const browserFrame = browserCard.locator("iframe");
    await browserFrame.waitFor({ state: "attached", timeout: 10_000 });
    assert.equal(await browserFrame.getAttribute("src"), "http://localhost:4173/");
    await browserCard.locator("[data-swarmlab-canvas-webview-form] input").fill(`${baseUrl}/?view=system`);
    await browserCard.locator("[data-swarmlab-canvas-webview-form] button").click();
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll(".swarmlab-canvas-card.is-app.is-launched-app")]
        .find((element) => /Browser/.test(element.textContent || ""));
      return card
        && !card.querySelector("iframe")
        && /Use the main tabs for Swarmlab itself/.test(card.textContent || "");
    });
    assert.equal(await browserCard.locator("iframe").count(), 0);
    assert.match(await browserCard.innerText(), /Embedded pages stay on this machine/);
    await browserCard.locator("[data-swarmlab-canvas-dismiss-launch]").click();
    await page.waitForFunction(() =>
      ![...document.querySelectorAll(".swarmlab-canvas-card.is-app.is-launched-app")]
        .some((card) => /Browser/.test(card.textContent || "")),
    );

    await openLaunchDock();
    await page.click('[data-swarmlab-canvas-launcher="launcher:app:cursor"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-swarmlab-canvas-launcher="launcher:app:cursor"]')?.getAttribute("data-swarmlab-launch-state") === "Launching",
    );
    const launchingCursorText = await page.locator('[data-swarmlab-canvas-launcher="launcher:app:cursor"]').textContent() || "";
    assert.match(launchingCursorText, /Cursor/);
    assert.doesNotMatch(launchingCursorText, /^Launching\.?$/);
    for (let attempt = 0; attempt < 20 && postedAppLaunches.length === 1; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedAppLaunches.length, 2);
    assert.equal(postedAppLaunches[1].appId, "cursor");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".swarmlab-canvas-card.is-app:not(.is-lifecycle)")]
        .some((card) => /Cursor/.test(card.textContent || "") && /launched/i.test(card.textContent || "")),
    );
    assert.equal(
      await page.locator('.swarmlab-canvas-card.is-app:not(.is-lifecycle)').filter({ hasText: "Cursor" }).count(),
      1,
    );
    assert.equal(
      await page.locator(".swarmlab-canvas-card.is-app-instance.is-launched-app").count(),
      1,
      "launching a desktop app should create a tracked app instance card",
    );
    await openLaunchDock();
    await page.click('[data-swarmlab-canvas-launcher="launcher:app:cursor"]');
    for (let attempt = 0; attempt < 20 && postedAppLaunches.length === 2; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedAppLaunches.length, 3);
    const repeatedLaunchSnapshot = await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll(".swarmlab-canvas-card.is-app-instance.is-launched-app")];
      if (cards.length !== 1) return false;
      return {
        count: cards.length,
        linkCount: cards[0].querySelectorAll('a.swarmlab-canvas-open[href="https://canvas-app.example.test/cursor/"]').length,
        text: cards[0].textContent || "",
      };
    });
    const repeatedLaunch = await repeatedLaunchSnapshot.jsonValue();
    assert.equal(repeatedLaunch.count, 1, "repeat launches of the same desktop app should update the existing app instance instead of duplicating cards");
    assert.equal(repeatedLaunch.linkCount, 1, "launched app cards should use the concrete app instance URL when the node returns one");
    assert.match(repeatedLaunch.text, /instance|launched/i);
    const dismissLaunchedApp = page.locator(
      [
        '.swarmlab-canvas-card.is-launched-app [data-swarmlab-canvas-dismiss-launch]',
        '.swarmlab-canvas-card.is-launched-app [data-swarmlab-canvas-dismiss-app-instance]',
      ].join(", "),
    );
    if (await dismissLaunchedApp.count()) {
      await dismissLaunchedApp.click();
      await page.waitForFunction(() => document.querySelectorAll(".swarmlab-canvas-card.is-launched-app").length === 0);
    }
    assert.equal(postedAppLaunches.length, 3, "dismissing a launched app window should not relaunch or kill the app");
    assert.equal(deletedSessions.length, 0, "dismissing a launched app window must not delete agent sessions");
    assert.match(postedAppLaunches.at(-1).clientCommandId, /^local-app-/);
    extraLocalPorts = [
      {
        port: 9456,
        name: "Cursor workspace",
        customName: "Cursor workspace",
        preferredAccess: "proxy",
        appId: "cursor",
        launchCommandId: postedAppLaunches.at(-1).clientCommandId,
        canvasVisible: true,
      },
    ];
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".swarmlab-canvas-card", { timeout: 10_000 });
    await page.waitForFunction(() =>
      Boolean(document.querySelector("[data-swarmlab-canvas-root]")?.__swarmlabCanvasActionOptions),
    );
    assert.equal(
      await page.locator('[data-swarmlab-canvas-card-id="port:9456"]').count(),
      0,
      "a dismissed launched app should stay dismissed when its matching port later appears",
    );
    assert.equal(await page.locator(".swarmlab-canvas-card.is-launched-app").count(), 0);
    extraLocalAppInstances = [
      {
        id: "appinst_cursor_card",
        appId: "cursor",
        label: "Cursor",
        status: "launched",
        source: "local",
        clientCommandId: "cmd-live-instance",
        updatedAt: "2026-05-13T10:03:00.000Z",
      },
    ];
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="app-instance:appinst_cursor_card"]', { timeout: 10_000 });
    const dismissAppInstance = page.locator(
      '[data-swarmlab-canvas-card-id="app-instance:appinst_cursor_card"] [data-swarmlab-canvas-dismiss-app-instance="appinst_cursor_card"]',
    );
    assert.equal(await dismissAppInstance.count(), 1);
    await dismissAppInstance.click();
    await page.waitForFunction(() => !document.querySelector('[data-swarmlab-canvas-card-id="app-instance:appinst_cursor_card"]'));
    assert.deepEqual(dismissedAppInstanceIds, ["appinst_cursor_card"]);
    assert.equal(deletedSessions.length, 0, "clearing an app instance card must not delete agent sessions");
    await page.locator('[data-swarmlab-canvas-focus-region="mac-main"]').evaluate((button) => button.click());
    await page.waitForFunction(() => {
      const handle = document.querySelector('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-card-drag-handle]');
      if (!(handle instanceof HTMLElement)) return false;
      const rect = handle.getBoundingClientRect();
      const x = rect.left + Math.min(40, rect.width / 2);
      const y = rect.top + Math.min(24, rect.height / 2);
      const target = document.elementFromPoint(x, y);
      return Boolean(target && handle.contains(target));
    });

    const sessionCard = page.locator('[data-swarmlab-canvas-card-id="session:session-1"]');
    const before = await sessionCard.locator("[data-swarmlab-card-drag-handle]").evaluate((handle) => {
      const rect = handle.getBoundingClientRect();
      const candidates = [
        [rect.left + 20, rect.top + 20],
        [rect.left + rect.width / 2, rect.top + 20],
        [rect.right - 20, rect.top + 20],
      ];
      const point = candidates.find(([x, y]) => {
        const target = document.elementFromPoint(x, y);
        return target && handle.contains(target);
      }) || [rect.left + rect.width / 2, rect.top + rect.height / 2];
      return { x: point[0], y: point[1] };
    });
    assert.ok(before, "session card should be visible before drag");
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    assert.equal(await page.locator(".swarmlab-canvas-stage.is-card-dragging").count(), 1);
    await page.mouse.move(before.x + 110, before.y + 72, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.locator(".swarmlab-canvas-stage.is-card-dragging").count(), 0);

    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.layout.v7:fleet:mac-main") || "{}"),
    );
    assert.ok(saved["session:session-1"], "drag should persist session layout");
    assert.ok(saved["session:session-1"].x > 0);
    assert.ok(saved["session:session-1"].y > 0);

    await page.click("[data-swarmlab-canvas-zoom-in]");
    const viewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v4:fleet:mac-main") || "{}"),
    );
    assert.ok(viewport.zoom > initialViewport.zoom, "zoom controls should persist a zoomed viewport");

    const localComposer = page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-composer] textarea[name="input"]');
    await localComposer.fill("continue from canvas");
    await localComposer.press("Enter");
    for (let attempt = 0; attempt < 20 && postedInputs.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedInputs.length, 1);
    assert.equal(postedInputs[0].input, "continue from canvas");

    await page.locator('[data-swarmlab-canvas-focus-region="account-box"]').evaluate((button) => button.click());
    await page.waitForSelector('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"] [data-swarmlab-agent-composer]', { timeout: 10_000 });
    const remoteComposerForm = page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"] [data-swarmlab-agent-composer]');
    assert.equal(await remoteComposerForm.getAttribute("data-swarmlab-agent-remote-node-id"), "account-node");
    await page.waitForFunction(() =>
      document
        .querySelector('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"]')
        ?.textContent
        ?.includes("Remote native history from account node.")
    );
    assert.ok(remoteNarrativeRequests.some((request) =>
      request.nodeId === "account-node" && request.sessionId === "account-box-agent-1"
    ));
    assert.ok(
      remoteNarrativeRequests.every((request) => request.nodeId === "account-node"),
      "view-only remote machines must not request native chat history",
    );
    const remoteComposer = remoteComposerForm.locator('textarea[name="input"]');
    await remoteComposer.fill("continue remote from canvas");
    await remoteComposer.press("Enter");
    for (let attempt = 0; attempt < 60 && postedRemoteCommands.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedRemoteCommands.length, 1);
    assert.equal(postedRemoteCommands[0].operation, "session.input.write");
    assert.equal(postedRemoteCommands[0].payload.sessionId, "account-box-agent-1");
    assert.equal(postedRemoteCommands[0].payload.input, "continue remote from canvas");

    await page.evaluate(() => {
      const root = document.querySelector("[data-swarmlab-canvas-root]");
      const region = root.__swarmlabCanvasRegionsById["account-box"];
      const layout = root.__swarmlabCanvasLayout;
      layout["session:session-1"] = {
        ...layout["session:session-1"],
        x: region.x + 82,
        y: region.y + 140,
        regionId: "account-box",
      };
      window.localStorage.setItem(root.dataset.swarmlabCanvasStorageKey, JSON.stringify(layout));
      window.localStorage.setItem(
        root.dataset.swarmlabCanvasViewportStorageKey,
        JSON.stringify({ x: 120 - region.x * 0.52, y: 96 - region.y * 0.52, zoom: 0.52 }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:session-1"].is-cross-region', { timeout: 10_000 });
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="session:session-1"]').getAttribute("data-swarmlab-canvas-region-id"), "account-box");
    assert.equal(await page.locator('[data-swarmlab-canvas-pipe-card-id="session:session-1"].is-transfer').getAttribute("data-swarmlab-canvas-pipe-target-region-id"), "account-box");
    const capsuleButton = page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-canvas-agent-capsule]');
    await capsuleButton.waitFor({ timeout: 10_000 });
    assert.equal(await capsuleButton.innerText(), "Start copy");
    assert.match(
      await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-transfer-bar]').innerText(),
      /View relocated to Account Workstation\. Agent keeps running on Mac Main\./,
    );
    assert.equal(postedRemoteCommands.length, 1, "relocating a card must not enqueue a remote command");
    assert.equal(deletedSessions.length, 0, "relocating a card must not delete the source session");
    await capsuleButton.click();
    for (let attempt = 0; attempt < 20 && postedRemoteCommands.length < 2; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedRemoteCommands.length, 2);
    assert.equal(postedRemoteCommands[1].operation, "session.create");
    assert.equal(postedRemoteCommands[1].payload.providerId, "codex");
    assert.match(postedRemoteCommands[1].payload.name, /Copy: Worker B/);
    assert.match(postedRemoteCommands[1].payload.initialPrompt, /Source session id: session-1/);
    assert.match(postedRemoteCommands[1].payload.initialPrompt, /Source machine id: mac-main/);
    assert.match(postedRemoteCommands[1].payload.initialPrompt, /Target machine id: account-box/);
    assert.match(postedRemoteCommands[1].payload.initialPrompt, /source agent is still running/i);
    assert.doesNotMatch(postedRemoteCommands[1].payload.initialPrompt, /token=secret|private/u);
    await page.waitForSelector(".swarmlab-canvas-card.is-lifecycle", { timeout: 10_000 });
    let lifecycleText = await page.locator(".swarmlab-canvas-card.is-lifecycle").evaluateAll((cards) => cards.map((card) => card.textContent || "").join("\n"));
    assert.match(lifecycleText, /Copy: Worker B/);
    assert.match(lifecycleText, /source agent keeps running/i);

    await page.locator('[data-swarmlab-canvas-focus-region="gpu-cluster"]').evaluate((button) => button.click());
    await page.waitForFunction(() =>
      document.querySelector('[data-swarmlab-canvas-focus-region="gpu-cluster"]')?.getAttribute("aria-current") === "true",
    );
    const gpuMachineBox = await page.locator('[data-swarmlab-canvas-card-id="remote:gpu-cluster:session:gpu-cluster-agent-1"]').boundingBox();
    const stageAfterGpuFocus = await page.locator(".swarmlab-canvas-stage").boundingBox();
    const gpuVisibleWidth = gpuMachineBox && stageAfterGpuFocus
      ? Math.min(gpuMachineBox.x + gpuMachineBox.width, stageAfterGpuFocus.x + stageAfterGpuFocus.width)
        - Math.max(gpuMachineBox.x, stageAfterGpuFocus.x)
      : 0;
    const gpuVisibleHeight = gpuMachineBox && stageAfterGpuFocus
      ? Math.min(gpuMachineBox.y + gpuMachineBox.height, stageAfterGpuFocus.y + stageAfterGpuFocus.height)
        - Math.max(gpuMachineBox.y, stageAfterGpuFocus.y)
      : 0;
    assert.ok(
      gpuVisibleWidth > 80 && gpuVisibleHeight > 80,
      "view-only machine regions should be focusable from the machine rail even without launchers",
    );
    await openLaunchDock();
    const viewOnlyLaunchState = page.locator("[data-swarmlab-canvas-launch-unavailable]");
    await viewOnlyLaunchState.waitFor({ timeout: 10_000 });
    assert.match(await viewOnlyLaunchState.innerText(), /View only/);
    assert.match(await viewOnlyLaunchState.innerText(), /needs pairing before launches/);
    assert.equal(
      await page.locator('[data-swarmlab-canvas-launcher^="remote:gpu-cluster:"]').count(),
      0,
      "view-only machines should not expose fake runnable launchers",
    );

    await page.click('[data-swarmlab-canvas-focus-region="mac-main"]');
    await openLaunchDock();
    await page.waitForSelector('[data-swarmlab-canvas-launcher="launcher:app:cursor"]', { timeout: 10_000 });
    const localMachineViewport = await page.evaluate(() => document.querySelector("[data-swarmlab-canvas-root]")?.__swarmlabCanvasViewport || null);
    await page.click('[data-swarmlab-canvas-focus-region="account-box"]');
    await openLaunchDock();
    await page.waitForSelector('[data-swarmlab-canvas-launcher="remote:account-box:launcher:provider:codex"]', { timeout: 10_000 });
    assert.equal(await page.locator('[data-swarmlab-canvas-focus-region="account-box"]').getAttribute("aria-current"), "true");
    const accountMachineViewport = await page.evaluate(() => document.querySelector("[data-swarmlab-canvas-root]")?.__swarmlabCanvasViewport || null);
    assert.notDeepEqual(accountMachineViewport, localMachineViewport, "selecting a machine region should also retarget the app dock");
    const accountMachineBox = await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"]').boundingBox();
    const stageAfterMachineFocus = await page.locator(".swarmlab-canvas-stage").boundingBox();
    const machineVisibleWidth = accountMachineBox && stageAfterMachineFocus
      ? Math.min(accountMachineBox.x + accountMachineBox.width, stageAfterMachineFocus.x + stageAfterMachineFocus.width)
        - Math.max(accountMachineBox.x, stageAfterMachineFocus.x)
      : 0;
    const machineVisibleHeight = accountMachineBox && stageAfterMachineFocus
      ? Math.min(accountMachineBox.y + accountMachineBox.height, stageAfterMachineFocus.y + stageAfterMachineFocus.height)
        - Math.max(accountMachineBox.y, stageAfterMachineFocus.y)
      : 0;
    assert.ok(
      machineVisibleWidth > 80 && machineVisibleHeight > 80,
      "selected machine region should be visible after rail machine selection",
    );
    await page.locator('[data-swarmlab-canvas-launcher="remote:account-box:launcher:provider:codex"]').evaluate((button) => button.click());
    for (let attempt = 0; attempt < 20 && postedRemoteCommands.length < 3; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedRemoteCommands.length, 3);
    assert.equal(postedRemoteCommands[2].operation, "session.create");
    assert.equal(postedRemoteCommands[2].payload.providerId, "codex");
    assert.equal(postedRemoteCommands[2].payload.name, "Codex");
    await page.waitForFunction(() => document.querySelectorAll(".swarmlab-canvas-card.is-lifecycle").length >= 2);
    lifecycleText = await page.locator(".swarmlab-canvas-card.is-lifecycle").evaluateAll((cards) => cards.map((card) => card.textContent || "").join("\n"));
    assert.match(lifecycleText, /Starting Codex/);

    await page.locator('[data-swarmlab-canvas-launcher="remote:account-box:launcher:app:cursor"]').evaluate((button) => button.click());
    for (let attempt = 0; attempt < 20 && postedRemoteCommands.length < 4; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedRemoteCommands.length, 4);
    assert.equal(postedRemoteCommands[3].operation, "app.launch");
    assert.equal(postedRemoteCommands[3].payload.appId, "cursor");
    await page.waitForFunction(() => document.querySelectorAll(".swarmlab-canvas-card.is-lifecycle").length >= 3);
    lifecycleText = await page.locator(".swarmlab-canvas-card.is-lifecycle").evaluateAll((cards) => cards.map((card) => card.textContent || "").join("\n"));
    assert.match(lifecycleText, /Cursor/);
    extraRemoteAppInstances.set("https://account-node.example.test", [
      {
        id: "appinst_remote_cursor",
        appId: "cursor",
        label: "Cursor",
        status: "launched",
        source: "account",
        updatedAt: "2026-05-12T12:03:03.000Z",
      },
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="remote:account-box:app-instance:appinst_remote_cursor"]', { timeout: 10_000 });
    const dismissRemoteAppInstance = page.locator(
      '[data-swarmlab-canvas-card-id="remote:account-box:app-instance:appinst_remote_cursor"] [data-swarmlab-canvas-dismiss-app-instance="appinst_remote_cursor"]',
    );
    assert.equal(await dismissRemoteAppInstance.count(), 1);
    await dismissRemoteAppInstance.click();
    for (let attempt = 0; attempt < 20 && postedRemoteCommands.length < 5; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedRemoteCommands.length, 5);
    assert.equal(postedRemoteCommands[4].operation, "app.instance.dismiss");
    assert.equal(postedRemoteCommands[4].payload.instanceId, "appinst_remote_cursor");
    assert.equal(postedRemoteCommands[4].payload.appId, "cursor");
    await page.waitForFunction(() => !document.querySelector('[data-swarmlab-canvas-card-id="remote:account-box:app-instance:appinst_remote_cursor"]'));
    assert.deepEqual(dismissedAppInstanceIds, ["appinst_cursor_card"], "remote app dismissal should not call the local app instance route");
    assert.equal(deletedSessions.length, 0, "clearing a remote app instance card must not delete agent sessions");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".swarmlab-canvas-card", { timeout: 10_000 });
    assert.equal(
      await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:app-instance:appinst_remote_cursor"]').count(),
      0,
      "a remotely cleared app instance should stay hidden while the dismiss command propagates",
    );
    assert.ok(
      await page.locator('[data-swarmlab-canvas-pipe-card-id^="lifecycle:"].is-resource').count() >= 1,
      "agent-copy lifecycle cards should stay connected to the source agent",
    );
    assert.equal(
      await page.locator('[data-swarmlab-canvas-pipe-source-card-id="remote:account-box:launcher:provider:codex"]').count(),
      0,
      "dock launchers are commands, not canvas nodes that own resource pipes",
    );

    extraRemoteSessions.set("https://account-node.example.test", [
      {
        id: "account-box-agent-copy",
        name: "Copy: Worker B",
        providerId: "codex",
        status: "running",
      },
      {
        id: "account-box-agent-codex",
        name: "Codex remote",
        providerId: "codex",
        status: "running",
      },
    ]);
    extraRemotePorts.set("https://account-node.example.test", [
      {
        port: 9123,
        name: "Cursor workspace",
        customName: "Cursor workspace",
        preferredAccess: "proxy",
        appId: "cursor",
        launchCommandId: "cmd_canvas_4",
        canvasVisible: true,
      },
    ]);
    remoteCommandsById.set("cmd_canvas_2", {
      ...remoteCommandsById.get("cmd_canvas_2"),
      status: "completed",
      updatedAt: "2026-05-12T12:03:00.000Z",
      completedAt: "2026-05-12T12:03:00.000Z",
      result: { session: { id: "account-box-agent-copy" } },
    });
    remoteCommandsById.set("cmd_canvas_3", {
      ...remoteCommandsById.get("cmd_canvas_3"),
      status: "completed",
      updatedAt: "2026-05-12T12:03:01.000Z",
      completedAt: "2026-05-12T12:03:01.000Z",
      result: { session: { id: "account-box-agent-codex" } },
    });
    remoteCommandsById.set("cmd_canvas_4", {
      ...remoteCommandsById.get("cmd_canvas_4"),
      status: "completed",
      updatedAt: "2026-05-12T12:03:02.000Z",
      completedAt: "2026-05-12T12:03:02.000Z",
      result: { appId: "cursor", port: 9123, url: "/proxy/9123/" },
    });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-copy"]', { timeout: 10_000 });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-codex"]', { timeout: 10_000 });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="remote:account-box:port:9123"]', { timeout: 10_000 });
    assert.equal(await page.locator(".swarmlab-canvas-card.is-lifecycle").count(), 0);
    assert.equal(
      await page.locator('[data-swarmlab-canvas-pipe-card-id="remote:account-box:session:account-box-agent-copy"].is-resource').getAttribute("data-swarmlab-canvas-pipe-source-card-id"),
      "session:session-1",
    );
    assert.match(await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-codex"]').innerText(), /launched/);
    assert.match(await page.locator('[data-swarmlab-canvas-card-id="remote:account-box:port:9123"]').innerText(), /launched/);
    assert.equal(await page.locator('[data-swarmlab-canvas-pipe-card-id="remote:account-box:session:account-box-agent-codex"].is-resource').count(), 0);
    assert.equal(await page.locator('[data-swarmlab-canvas-pipe-card-id="remote:account-box:port:9123"].is-resource').count(), 0);

    await page.evaluate(() => {
      const root = document.querySelector("[data-swarmlab-canvas-root]");
      const region = root.__swarmlabCanvasRegionsById["gpu-cluster"];
      const layout = root.__swarmlabCanvasLayout;
      layout["session:session-1"] = {
        ...layout["session:session-1"],
        x: region.x + 82,
        y: region.y + 140,
        regionId: "gpu-cluster",
      };
      window.localStorage.setItem(root.dataset.swarmlabCanvasStorageKey, JSON.stringify(layout));
      window.localStorage.setItem(
        root.dataset.swarmlabCanvasViewportStorageKey,
        JSON.stringify({ x: 120 - region.x * 0.52, y: 96 - region.y * 0.52, zoom: 0.52 }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:session-1"].is-cross-region', { timeout: 10_000 });
    assert.equal(await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-canvas-agent-capsule]').count(), 0);
    assert.match(
      await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-transfer-bar]').innerText(),
      /View relocated to GPU Cluster\. Agent keeps running on Mac Main\. Pair this machine to start a copy there\./,
    );
    const pairButton = page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-canvas-pair-region="gpu-cluster"]');
    await pairButton.waitFor({ timeout: 10_000 });
    await pairButton.click();
    for (let attempt = 0; attempt < 20 && postedRemotePairs.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedRemotePairs.length, 1);
    assert.equal(postedRemotePairs[0].baseUrl, "https://gpu-node.example.test");
    assert.equal(postedRemotePairs[0].label, "GPU Cluster");
    for (let attempt = 0; attempt < 20 && directPairCompletes.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(directPairStarts.length, 1);
    assert.equal(directPairStarts[0].accountBaseUrl, baseUrl);
    assert.equal(directPairStarts[0].label, "GPU Cluster");
    assert.deepEqual(approvedPairings[0], {
      pairingId: "pair_canvas_gpu",
      pairingCode: "PAIR-GPU",
    });
    assert.equal(directPairCompletes.length, 1);
    assert.equal(directPairCompletes[0].accountBaseUrl, baseUrl);
    assert.equal(directPairCompletes[0].grant, "grant_canvas_pair");
    assert.equal(directPairCompletes[0].pairingId, "pair_canvas_gpu");
    assert.equal(directPairHeartbeats.length, 1);
    assert.equal(directPairHeartbeats[0].reason, "browser-remote-pair");

    await page.evaluate(() => {
      const answers = [
        "train on gpu and validate on pi",
        "pi@home-raspi",
      ];
      window.prompt = () => answers.shift() || "";
    });
    await page.click("[data-swarmlab-canvas-new-handoff]");
    for (let attempt = 0; attempt < 20 && postedHandoffJobs.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedHandoffJobs.length, 1);
    assert.equal(postedHandoffJobs[0].objective, "train on gpu and validate on pi");
    assert.equal(postedHandoffJobs[0].target.sshTarget, "pi@home-raspi");

    const queryFleetPosts = postedFleetNodes.filter((node) => node.source === "query");
    assert.ok(queryFleetPosts.some((node) => node.url === "https://query-node.example.test"));
    const snapshotFleetPosts = postedFleetNodes.filter((node) => node.source === "snapshot");
    assert.ok(snapshotFleetPosts.some((node) => node.url === "https://gpu-node.example.test" && node.snapshot?.node?.name === "GPU Cluster"));
    assert.ok(snapshotFleetPosts.some((node) => node.url === "https://registry-node.example.test" && node.snapshot?.node?.name === "Registry Box"));

    await page.evaluate(() => {
      window.prompt = () => "https://manual-node.example.test/secret?token=manual";
    });
    await page.locator(".swarmlab-canvas-advanced").evaluate((element) => { element.open = true; });
    await page.click("[data-swarmlab-canvas-add-node]");
    for (let attempt = 0; attempt < 20 && !postedFleetNodes.some((node) => node.source === "manual"); attempt += 1) {
      await page.waitForTimeout(50);
    }
    const manualFleetPost = postedFleetNodes.find((node) => node.source === "manual");
    assert.equal(manualFleetPost.url, "https://manual-node.example.test");
    const savedRemoteUrls = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.remoteNodes.v1") || "[]"),
    );
    assert.ok(!savedRemoteUrls.some((url) => /token=manual|\/secret/u.test(url)));

    await page.locator("[data-swarmlab-canvas-account-login]").click();
    await page.waitForFunction(() => window.__openedSwarmlabAccountUrls?.length === 1, null, { timeout: 10_000 });
    assert.equal(accountPairStarts.length, 1);
    assert.equal(accountPairStarts[0].label, "Swarmlab");
    assert.match(accountPairStarts[0].redirectUri, /\/account\/auth\/complete$/);
    assert.deepEqual(
      await page.evaluate(() => window.__openedSwarmlabAccountUrls),
      [`${baseUrl}/account/pair?pairingId=pair_canvas_login`],
    );
    await page.waitForFunction(() =>
      document.querySelector("[data-swarmlab-canvas-account-label]")?.textContent?.includes("Waiting"),
    null, { timeout: 10_000 });
    accountConnected = true;
    await page.evaluate(() => {
      window.postMessage({
        type: "swarmlab-account-pairing-result",
        status: "success",
        message: "Vibe account connected. Returning to Swarmlab.",
      }, window.location.origin);
    });
    await page.waitForFunction(() =>
      document.querySelector("[data-swarmlab-canvas-account-label]")?.textContent?.includes("Linked") ||
        document.querySelector("[data-swarmlab-canvas-account-label]")?.textContent?.includes("@mark"),
    null, { timeout: 10_000 });
    assert.match(await page.locator("[data-swarmlab-canvas-notice]").innerText(), /Vibe account connected|Machines will appear/i);
  } finally {
    await browser?.close().catch(() => {});
    await app.close();
  }
});

test("canvas agent launcher renders the created native session on the board", async () => {
  const executablePath = await resolveBrowserExecutablePath({ env: process.env });
  if (!executablePath) {
    test.skip("Playwright browser executable is not available in this environment.");
    return;
  }

  const workspaceDir = await createTempWorkspace("swarmlab-canvas-open-agent-");
  const stateDir = path.join(workspaceDir, ".vibe-research");
  const { app, baseUrl } = await startApp({ cwd: workspaceDir, stateDir });
  let browser = null;

  try {
    const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wikiPath: workspaceDir }),
    });
    assert.equal(settingsResponse.status, 200);

    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("vibeResearch.agentSetupComplete.v1", "1");
      window.localStorage.setItem("vibe-research-guided-onboarding-v2", "1");
    });

    const postedSessions = [];
    await page.route(`${baseUrl}/api/node/snapshot**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          node: {
            id: "mac-main",
            name: "Mac Main",
            status: "online",
            os: "darwin",
            version: "1.0.19",
          },
          sessions: [],
          ports: [],
          launchers: [
            { id: "provider:codex", label: "Codex", kind: "agent-provider", providerId: "codex", defaultName: "Codex", available: true },
            { id: "provider:shell", label: "Terminal", kind: "agent-provider", category: "terminal", providerId: "shell", defaultName: "Terminal", available: true },
          ],
          counts: { sessions: 0, ports: 0, approvals: 0, artifacts: 0 },
          generatedAt: "2026-05-13T12:00:00.000Z",
        }),
      });
    });
    await page.route(`${baseUrl}/api/sessions`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      const postedSession = JSON.parse(route.request().postData() || "{}");
      postedSessions.push(postedSession);
      const isShell = postedSession.providerId === "shell";
      const providerLabel = isShell ? "Terminal" : "Codex";
      const sessionId = isShell ? "canvas-terminal-session" : "canvas-codex-session";
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            providerId: postedSession.providerId || "codex",
            providerLabel,
            name: postedSession.name || providerLabel,
            cwd: workspaceDir,
            status: "running",
          },
        }),
      });
    });
    await page.route(`${baseUrl}/api/sessions/**/narrative`, async (route) => {
      const parts = new URL(route.request().url()).pathname.split("/");
      const sessionId = parts[parts.length - 2] || "";
      const isShell = sessionId.includes("terminal");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative: {
            providerId: isShell ? "shell" : "codex",
            providerLabel: isShell ? "Terminal" : "Codex",
            entries: isShell ? [{
              kind: "tool",
              label: "Snippet",
              outputPreview: [
                "1;36m[vibe-research]0m session restored after restart",
                "1;36m[vibe-research]0m cwd: /Users/mark/vibe-projects/vibe-research/user",
                "1;36m[vibe-research]0m persistent terminal: reattached vibe-research-terminal",
                "1;36m[vibe-research]0m vanilla shell restored   \u001b=            m         >c>q",
              ].join("\n"),
            }, {
              kind: "tool",
              label: "Snippet",
              outputPreview: "\u001b[32mready\u001b[0m\n(base) 32m1m➜ 36muserm 34m1mgit:(31mmain34m) 33m✗m m (base)",
            }, {
              kind: "tool",
              label: "Snippet",
              outputPreview: "(base) 32m1m➜ 36muserm 34m1mgit:(31mmain34m) 33m✗m m (base) 32m1m➜ 36muserm",
            }, {
              kind: "tool",
              label: "Result",
              outputPreview: "cost is $5\n# heading remains useful output",
            }] : [],
          },
        }),
      });
    });

    await page.goto(`${baseUrl}/?view=canvas`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-swarmlab-canvas-toggle-launch-dock]").click();
    await page.waitForSelector(".swarmlab-canvas-launch-panel", { state: "visible", timeout: 10_000 });
    await page.waitForSelector('[data-swarmlab-canvas-launcher="launcher:provider:codex"]', { state: "visible", timeout: 10_000 });
    await page.click('[data-swarmlab-canvas-launcher="launcher:provider:codex"]');

    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:canvas-codex-session"]', { timeout: 10_000 });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:canvas-codex-session"][data-swarmlab-canvas-focused-card="true"]', { timeout: 10_000 });
    await page.waitForFunction(() => {
      const active = document.activeElement;
      return active instanceof HTMLTextAreaElement
        && active.closest('[data-swarmlab-canvas-card-id="session:canvas-codex-session"]');
    });
    assert.equal(postedSessions.length, 1);
    assert.equal(postedSessions[0].providerId, "codex");
    assert.equal(postedSessions[0].name, "Codex");
    assert.equal(new URL(page.url()).searchParams.get("view"), "canvas");
    const viewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v4:machine:mac-main") || "{}"),
    );
    assert.ok(Number(viewport.zoom) >= 0.5, "new canvas agent should be focused into the visible work area");
    assert.match(
      await page.locator('[data-swarmlab-canvas-card-id="session:canvas-codex-session"]').innerText(),
      /Codex/,
    );

    await page.waitForSelector('[data-swarmlab-canvas-shell-dock] [data-swarmlab-canvas-launcher="launcher:provider:shell"]', { timeout: 10_000 });
    await page.click('[data-swarmlab-canvas-shell-dock] [data-swarmlab-canvas-launcher="launcher:provider:shell"]');
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:canvas-terminal-session"]', { timeout: 10_000 });
    await page.waitForSelector('[data-swarmlab-canvas-card-id="session:canvas-terminal-session"][data-swarmlab-canvas-focused-card="true"]', { timeout: 10_000 });

    assert.equal(postedSessions.length, 2);
    assert.equal(postedSessions[1].providerId, "shell");
    assert.equal(postedSessions[1].name, "Terminal");
    const terminalCard = page.locator('[data-swarmlab-canvas-card-id="session:canvas-terminal-session"]');
    const terminalText = await terminalCard.innerText();
    assert.match(terminalText, /Terminal/);
    assert.match(terminalText, /ready/);
    assert.match(terminalText, /cost is \$5/);
    assert.match(terminalText, /# heading remains useful output/);
    assert.doesNotMatch(terminalText, /\[vibe-research\].*session restored/i);
    assert.doesNotMatch(terminalText, /SNIPPET[\s\S]*git:\(main\)/);
    assert.doesNotMatch(terminalText, /32m|36m|34m|31m|33m|1m|✗m|userm|m \(base\)/);
    assert.equal(await terminalCard.locator('textarea[name="input"]').getAttribute("placeholder"), "Type a terminal command");
    assert.equal((await terminalCard.getAttribute("class")).includes("is-terminal-session"), true);
    assert.match(await page.locator("[data-swarmlab-canvas-shell-dock]").innerText(), /Terminal/);
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
});
