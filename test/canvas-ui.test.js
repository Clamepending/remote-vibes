import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
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
      window.localStorage.setItem("swarmlab.canvas.remoteNodes.v1", JSON.stringify(["https://gpu-node.example.test"]));
    });
    const postedInputs = [];
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
          ],
          browserSessions: [
            {
              id: "browser-1",
              name: "Docs browser",
              status: "running",
              latestSnapshot: { url: "https://example.test/docs" },
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
          ],
          ports: Array.from({ length: 6 }, (_, index) => ({
            port: 5173 + index,
            name: index === 0 ? "Vite app" : `Preview ${index + 1}`,
            preferredAccess: index % 2 ? "direct" : "proxy",
          })),
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
    await page.route("https://gpu-node.example.test/api/node/snapshot?mode=redacted", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          snapshot: {
            schemaVersion: 1,
            mode: "redacted",
            node: {
              id: "gpu-cluster",
              name: "GPU Cluster",
              status: "online",
              os: "linux",
              version: "1.0.20",
            },
            sessions: [
              {
                id: "remote-agent-1",
                name: "Remote trainer",
                providerId: "codex",
                status: "running",
              },
            ],
            ports: [{ port: 6006, name: "TensorBoard", preferredAccess: "proxy" }],
            counts: { sessions: 1, ports: 1, approvals: 0, artifacts: 0 },
            generatedAt: "2026-05-12T12:00:10.000Z",
          },
        }),
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

    await page.goto(`${baseUrl}/?view=canvas`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".swarmlab-canvas-card", { timeout: 10_000 });
    await page.waitForSelector(".swarmlab-agent-message.is-agent", { timeout: 10_000 });

    const rendered = await page.evaluate(() => document.body.innerText);
    assert.match(rendered, /Swarmlab Canvas/);
    assert.match(rendered, /Mac Main/);
    assert.match(rendered, /GPU Cluster/);
    assert.match(rendered, /Remote trainer/);
    assert.match(rendered, /gpu-node\.example\.test/);
    assert.match(rendered, /Worker B/);
    assert.match(rendered, /Approve deploy/);
    assert.match(rendered, /Local apps/);
    assert.match(rendered, /Vite app/);
    assert.match(rendered, /Result chart/);
    assert.match(rendered, /Agent Town/);
    assert.match(rendered, /Please inspect the dashboard/);
    assert.match(rendered, /native session feed/);
    assert.equal(await page.locator(".swarmlab-agent-chat-window").count(), 1);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-remote").count(), 3);
    assert.equal(await page.locator(".swarmlab-canvas-floating-controls").count(), 1);
    assert.equal(await page.locator(".swarmlab-canvas-card.is-app").count(), 2);
    assert.equal(
      await page.locator(".swarmlab-canvas-stage").evaluate((element) => getComputedStyle(element).overflow),
      "hidden",
    );

    const sessionCard = page.locator('[data-swarmlab-canvas-card-id="session:session-1"]');
    const before = await sessionCard.boundingBox();
    assert.ok(before, "session card should be visible before drag");
    await page.mouse.move(before.x + 20, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x + 110, before.y + 72);
    await page.mouse.up();

    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.layout.v2:fleet:mac-main") || "{}"),
    );
    assert.ok(saved["session:session-1"], "drag should persist session layout");
    assert.ok(saved["session:session-1"].x > 0);
    assert.ok(saved["session:session-1"].y > 0);

    await page.click("[data-swarmlab-canvas-zoom-in]");
    const viewport = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("swarmlab.canvas.viewport.v1:fleet:mac-main") || "{}"),
    );
    assert.ok(viewport.zoom > 0.92, "zoom controls should persist a zoomed viewport");

    await page.locator('[data-swarmlab-agent-composer] textarea[name="input"]').fill("continue from canvas");
    await page.keyboard.press("Enter");
    for (let attempt = 0; attempt < 20 && postedInputs.length === 0; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.equal(postedInputs.length, 1);
    assert.equal(postedInputs[0].input, "continue from canvas");
  } finally {
    await browser?.close().catch(() => {});
    await app.close();
  }
});
