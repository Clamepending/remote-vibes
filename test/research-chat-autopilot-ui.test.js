import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createVibeResearchApp } from "../src/create-app.js";
import { resolveBrowserExecutablePath } from "../src/browser-runtime.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

async function startApp({ cwd, providers }) {
  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd,
    stateDir: path.join(cwd, ".vibe-research"),
    persistSessions: false,
    persistentTerminals: false,
    providers,
    sleepPreventionFactory: (settings) => new SleepPreventionService({
      enabled: settings.preventSleepEnabled,
      platform: "test",
    }),
  });
  return { app, baseUrl: `http://127.0.0.1:${app.config.port}` };
}

test("same-chat supervisor Start creates project memory and queues takeover while agent is busy", async (t) => {
  const executablePath = await resolveBrowserExecutablePath({ env: process.env });
  if (!executablePath) {
    t.skip("No local Chromium/Chrome executable available for the chat supervisor UI canary.");
    return;
  }

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-chat-supervisor-ui-"));
  const providers = [
    { id: "claude", label: "Claude Code", available: true, command: "claude", launchCommand: "claude", defaultName: "Claude" },
    { id: "shell", label: "Shell", available: true, command: null, launchCommand: null, defaultName: "Shell" },
  ];
  const { app, baseUrl } = await startApp({ cwd: workspaceDir, providers });
  let browser = null;

  try {
    const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRootPath: workspaceDir, wikiPathConfigured: true }),
    });
    assert.equal(settingsResponse.status, 200);

    const timestamp = "2026-05-01T10:00:00.000Z";
    const session = app.sessionManager.buildSessionRecord({
      id: "chat-supervisor-start-session",
      providerId: "claude",
      providerLabel: "Claude Code",
      name: "Supervisor start smoke",
      cwd: workspaceDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "running",
      streamMode: true,
    });
    session.streamWorking = true;
    app.sessionManager.sessions.set(session.id, session);
    app.sessionManager.getSessionNarrative = async (sessionId) => {
      if (sessionId !== session.id) return null;
      return {
        providerBacked: true,
        providerId: "claude",
        providerLabel: "Claude Code",
        sourceLabel: "test fixture",
        updatedAt: timestamp,
        entries: [
          {
            id: "busy-turn",
            kind: "assistant",
            label: "Claude Code",
            text: "I am still working on the current turn.",
            status: "running",
            timestamp,
          },
        ],
      };
    };

    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?view=shell`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#toggle-shell-surface-native", { timeout: 30_000 });
    await page.click("#toggle-shell-surface-native");
    await page.waitForSelector(".rich-session-surface.is-active", { timeout: 10_000 });

    const startButton = page.locator("[data-chat-autopilot-start-project]");
    await startButton.waitFor({ timeout: 20_000 });
    assert.match(
      await page.locator(".rich-session-autopilot-status").textContent(),
      /ready to supervise this chat/,
    );
    await startButton.click();

    await page.waitForSelector('[data-rich-session-queue-item^="autopilot-"]', { timeout: 20_000 });
    const uiState = await page.evaluate((sessionId) => {
      const rawQueue = window.localStorage.getItem("vibe-research-composer-queue-v1") || "{}";
      const queue = JSON.parse(rawQueue);
      const items = Array.isArray(queue[sessionId]) ? queue[sessionId] : [];
      const first = items[0] || null;
      const status = document.querySelector(".rich-session-autopilot-status")?.textContent?.trim() || "";
      const projectLabel = document.querySelector(".rich-session-autopilot-project-pill")?.textContent?.trim() || "";
      const queuePreview = document.querySelector(".rich-session-queue-text")?.textContent?.trim() || "";
      return {
        status,
        projectLabel,
        queuePreview,
        queuedId: first?.id || "",
        queuedText: first?.text || "",
      };
    }, session.id);

    assert.match(uiState.status, /supervisor directive queued|watching current turn|using wiki goal/);
    assert.match(uiState.projectLabel, /vibe-research-chat-supervisor/);
    assert.match(uiState.queuedId, /^autopilot-/);
    assert.match(uiState.queuePreview, /Claim QUEUE row 1/);
    assert.match(uiState.queuedText, /Claim QUEUE row 1 \(initial-research-loop\)/);
    assert.match(uiState.queuedText, /Use the project objective as the north star/);
    assert.doesNotMatch(uiState.queuedText, /Autopilot/i);

    const projectsResponse = await fetch(`${baseUrl}/api/research/projects`);
    assert.equal(projectsResponse.status, 200);
    const projectsPayload = await projectsResponse.json();
    assert.equal(projectsPayload.projects.length, 1);
    const projectName = projectsPayload.projects[0].name;
    assert.match(projectName, /^vibe-research-chat-supervisor-ui-/);
    assert.equal(projectsPayload.projects[0].queueSize, 1);

    const attachmentResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/research-autopilot`);
    assert.equal(attachmentResponse.status, 200);
    const attachmentPayload = await attachmentResponse.json();
    assert.equal(attachmentPayload.attachment.enabled, true);
    assert.equal(attachmentPayload.attachment.driver, "session");
    assert.equal(attachmentPayload.attachment.projectName, projectName);
    assert.match(attachmentPayload.attachment.lastMessage, /Claim QUEUE row 1/);
  } finally {
    await browser?.close().catch(() => {});
    await app.close?.().catch(() => {});
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
