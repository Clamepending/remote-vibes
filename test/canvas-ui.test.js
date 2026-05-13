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
    });
    const postedInputs = [];
    const postedRemoteCommands = [];
    const remoteCommandsById = new Map();
    const postedAppLaunches = [];
    const postedRemotePairs = [];
    const deletedSessions = [];
    const directPairStarts = [];
    const directPairCompletes = [];
    const directPairHeartbeats = [];
    const approvedPairings = [];
    const postedFleetNodes = [];
    const postedHandoffJobs = [];
    const remoteSnapshotHits = new Map();
    const directSnapshotHits = new Map();
    const extraRemoteSessions = new Map();
    const extraRemotePorts = new Map();
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
        launchers: origin === "https://account-node.example.test"
          ? [
              { id: "provider:codex", label: "Codex", kind: "agent-provider", providerId: "codex", defaultName: "Codex", available: true },
              { id: "app:cursor", label: "Cursor", kind: "desktop-app", appId: "cursor", available: true, platform: "linux" },
            ]
          : [],
        counts: { sessions: 1, ports: 1, approvals: 0, artifacts: 0 },
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
          ports: Array.from({ length: 6 }, (_, index) => ({
            port: 5173 + index,
            name: index === 0 ? "Vite app" : `Preview ${index + 1}`,
            preferredAccess: index % 2 ? "direct" : "proxy",
          })),
          launchers: [
            { id: "provider:codex", label: "Codex", kind: "agent-provider", providerId: "codex", defaultName: "Codex", available: true },
            { id: "app:cursor", label: "Cursor", kind: "desktop-app", appId: "cursor", available: true, platform: "darwin" },
          ],
          handoffJobs: [
            {
              id: "deploy-pi",
              title: "Train on GPU deploy to Pi",
              status: "planned",
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
          ],
        }),
      });
    });
    await page.route("**/api/account/nodes/account-node/commands**", async (route) => {
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
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ launched: true, launcher: { id: postedAppLaunches.at(-1).appId } }),
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
    assert.match(rendered, /2 sessions, 1 apps, 1 handoffs/);
    assert.match(rendered, /6 gpus/);
    assert.doesNotMatch(rendered, /private|token=secret|token=registry/);
    assert.match(rendered, /Worker B/);
    assert.match(rendered, /Quiet agents/);
    assert.match(rendered, /Resolved requests/);
    assert.match(rendered, /Approve deploy/);
    assert.match(rendered, /Train on GPU deploy to Pi/);
    assert.match(rendered, /Train model/);
    assert.match(rendered, /Swarmlab brain/);
    assert.match(rendered, /Pi deploy/);
    assert.match(rendered, /More local apps/);
    assert.match(rendered, /Vite app/);
    assert.match(rendered, /Result chart/);
    assert.match(rendered, /Cursor/);
    assert.match(rendered, /Handoff/);
    assert.match(rendered, /Vibe account/);
    assert.doesNotMatch(rendered, /Add machine/);
    assert.match(rendered, /Please inspect the dashboard/);
    assert.match(rendered, /native session feed/);
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
    const localAgentSize = await page.locator('[data-swarmlab-canvas-card-id="session:session-1"]').evaluate((element) => ({
      width: Number.parseFloat(element.style.width || "0"),
      height: Number.parseFloat(element.style.height || "0"),
    }));
    assert.ok(localAgentSize.width >= 620, "local agent canvas card should be a large work surface");
    assert.ok(localAgentSize.height >= 700, "local agent canvas card should preserve visible chat history");
    const composerBox = await page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-composer]').boundingBox();
    assert.ok(composerBox && composerBox.height <= 62, "canvas chat composer should stay compact on a large agent card");
    assert.equal(await page.locator(".swarmlab-canvas-card.is-summary:not(.is-remote)").count(), 2);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-remote").count(), 13);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-launcher").count(), 0);
    assert.equal(await page.locator(".swarmlab-canvas-launch-dock").count(), 1);
    assert.equal(await page.locator("[data-swarmlab-canvas-launcher]").count(), 4);
    const dockText = await page.locator(".swarmlab-canvas-launch-dock").innerText();
    assert.match(dockText, /MAC MAIN/);
    assert.match(dockText, /ACCOUNT WORKSTATION/);
    assert.match(dockText, /Codex/);
    assert.match(dockText, /Cursor/);
    const regionIds = await page.locator(".swarmlab-canvas-region").evaluateAll((regions) =>
      regions.map((region) => region.getAttribute("data-swarmlab-canvas-region-id")).filter(Boolean),
    );
    assert.deepEqual(regionIds, ["mac-main", "registry-box", "offline-gpu", "account-box", "gpu-cluster", "query-box"]);
    assert.equal(await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="mac-main"]').count(), 1);
    assert.equal(await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="account-box"]').getAttribute("data-swarmlab-canvas-region-remote-node-id"), "account-node");
    assert.equal(await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="gpu-cluster"]').getAttribute("data-swarmlab-canvas-region-remote-node-id"), null);
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="mac-main"] .swarmlab-canvas-region-badges').innerText(),
      /local/i,
    );
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="account-box"] .swarmlab-canvas-region-badges').innerText(),
      /account/i,
    );
    assert.match(
      await page.locator('.swarmlab-canvas-region[data-swarmlab-canvas-region-id="gpu-cluster"] .swarmlab-canvas-region-badges').innerText(),
      /view only/i,
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
    assert.equal(await page.locator(".swarmlab-canvas-card.is-app").count(), 9);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-app:not(.is-remote)").count(), 5);
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

    await page.click('[data-swarmlab-canvas-launcher="launcher:app:cursor"]');
    for (let attempt = 0; attempt < 20 && postedAppLaunches.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedAppLaunches.length, 1);
    assert.equal(postedAppLaunches[0].appId, "cursor");

    const sessionCard = page.locator('[data-swarmlab-canvas-card-id="session:session-1"]');
    const before = await sessionCard.boundingBox();
    assert.ok(before, "session card should be visible before drag");
    await page.mouse.move(before.x + 20, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x + 110, before.y + 72);
    await page.mouse.up();

    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.layout.v6:fleet:mac-main") || "{}"),
    );
    assert.ok(saved["session:session-1"], "drag should persist session layout");
    assert.ok(saved["session:session-1"].x > 0);
    assert.ok(saved["session:session-1"].y > 0);

    await page.click("[data-swarmlab-canvas-zoom-in]");
    const viewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v2:fleet:mac-main") || "{}"),
    );
    assert.ok(viewport.zoom > 0.74, "zoom controls should persist a zoomed viewport");

    const localComposer = page.locator('[data-swarmlab-canvas-card-id="session:session-1"] [data-swarmlab-agent-composer] textarea[name="input"]');
    await localComposer.fill("continue from canvas");
    await localComposer.press("Enter");
    for (let attempt = 0; attempt < 20 && postedInputs.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedInputs.length, 1);
    assert.equal(postedInputs[0].input, "continue from canvas");

    const remoteComposerForm = page.locator('[data-swarmlab-canvas-card-id="remote:account-box:session:account-box-agent-1"] [data-swarmlab-agent-composer]');
    assert.equal(await remoteComposerForm.getAttribute("data-swarmlab-agent-remote-node-id"), "account-node");
    const remoteComposer = remoteComposerForm.locator('textarea[name="input"]');
    await remoteComposer.fill("continue remote from canvas");
    await remoteComposerForm.evaluate((form) => form.requestSubmit());
    for (let attempt = 0; attempt < 20 && postedRemoteCommands.length === 0; attempt += 1) {
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
  } finally {
    await browser?.close().catch(() => {});
    await app.close();
  }
});
