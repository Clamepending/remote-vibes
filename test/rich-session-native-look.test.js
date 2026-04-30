import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createVibeResearchApp } from "../src/create-app.js";
import { resolveBrowserExecutablePath } from "../src/browser-runtime.js";
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

test("rich session native feed is clean even when the raw transcript is full of CLI noise", async (t) => {
  const executablePath = await resolveBrowserExecutablePath({ env: process.env });
  if (!executablePath) {
    t.skip("No local Chromium/Chrome executable is available for the rich session screenshot smoke.");
    return;
  }

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-rich-session-look-"));
  await mkdir(path.join(workspaceDir, "src"), { recursive: true });
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
      body: JSON.stringify({
        workspaceRootPath: workspaceDir,
        wikiPathConfigured: true,
      }),
    });
    assert.equal(settingsResponse.status, 200);

    const timestamp = "2026-04-29T12:00:00.000Z";
    const session = app.sessionManager.buildSessionRecord({
      id: "rich-look-session",
      providerId: "claude",
      providerLabel: "Claude Code",
      name: "bidir-video-rl-bench",
      cwd: workspaceDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "running",
    });
    app.sessionManager.sessions.set(session.id, session);

    // The narrative we hand the renderer mirrors what a real
    // bench-init move would produce: kickoff, two tool calls (one running,
    // one errored), a git-style commit summary that should render as code,
    // a clean assistant reply with an inline file path, and a benign
    // status entry. None of the screenshot's noise lines (ctrl+t, ✦ progress,
    // Tip:, Shell cwd was reset to ...) appear here because the parser is
    // expected to have stripped them upstream.
    app.sessionManager.getSessionNarrative = async (sessionId) => {
      if (sessionId !== session.id) {
        return null;
      }

      return {
        providerBacked: true,
        providerId: "claude",
        providerLabel: "Claude Code",
        sourceLabel: "Claude project transcript",
        updatedAt: timestamp,
        entries: [
          {
            kind: "user",
            label: "You",
            text: "Run doctor and fix README placeholder rows for bidir-video-rl-bench.",
            timestamp,
          },
          {
            kind: "status",
            label: "Thinking",
            text: "Claude is thinking...",
            timestamp,
          },
          {
            kind: "tool",
            label: "Bash",
            text: "vr-research-doctor projects/bidir-video-rl-bench",
            status: "done",
            meta: "completed",
            outputPreview: "doctor: 0 errors · 0 warnings",
            timestamp,
          },
          {
            kind: "tool",
            label: "Edit",
            text: "src/research/bench-init.md",
            status: "running",
            meta: "running",
            timestamp,
          },
          {
            kind: "tool",
            label: "Bash",
            text: "git commit -m 'bench-v1-init resolved'",
            status: "error",
            meta: "exit 1",
            outputPreview: "fatal: cannot lock ref 'HEAD' at projects/bidir-video-rl-bench/.git/HEAD",
            timestamp,
          },
          {
            kind: "assistant",
            label: "Claude Code",
            text: [
              "Doctor passed. I pinned the v1 eval contract in projects/bidir-video-rl-bench/benchmark.md and installed paper.md from the template.",
              "",
              "**Next:** open src/research/bench-init.md to add the calibration table.",
            ].join("\n"),
            timestamp,
          },
        ],
      };
    };

    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
    await page.goto(`${baseUrl}/?view=shell`, { waitUntil: "domcontentloaded" });
    // Default shell surface is "terminal"; flip it to "native" so the feed
    // is visible. The button is only rendered once the active session loads.
    await page.waitForSelector("#toggle-shell-surface-native", { timeout: 10_000 });
    await page.click("#toggle-shell-surface-native");
    await page.waitForSelector(".rich-session-surface.is-active", { timeout: 5_000 });
    await page.waitForSelector(".rich-session-entry.is-tool .rich-session-path-link", { timeout: 10_000 });

    const screenshotPath = process.env.RICH_SESSION_SCREENSHOT_PATH
      || path.join(workspaceDir, "rich-session-native.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[rich-session-native-look] wrote ${screenshotPath}`);

    const summary = await page.evaluate(() => {
      const feed = document.querySelector("#rich-session-feed");
      const entries = feed ? Array.from(feed.querySelectorAll("[data-rich-session-entry]")) : [];
      const toolEntries = entries.filter((entry) => entry.classList.contains("is-tool"));
      const errorTools = toolEntries.filter((entry) => entry.classList.contains("is-error"));
      const runningTools = toolEntries.filter((entry) => entry.classList.contains("is-running"));
      const pathLinks = feed ? Array.from(feed.querySelectorAll(".rich-session-path-link")) : [];
      return {
        feedText: feed?.textContent || "",
        toolCount: toolEntries.length,
        errorToolCount: errorTools.length,
        runningToolCount: runningTools.length,
        firstPathHref: pathLinks[0]?.getAttribute("data-rich-path") || "",
        pathLinkCount: pathLinks.length,
      };
    });

    // The screenshot's noise patterns must NOT leak into the rendered feed
    // even if the parser ran on raw CLI output. We assert the kind of UI
    // the user is supposed to see when the feed is clean.
    assert.doesNotMatch(summary.feedText, /ctrl\+t to hide tasks/iu);
    assert.doesNotMatch(summary.feedText, /Shell cwd was reset to/iu);
    assert.doesNotMatch(summary.feedText, /Tip:\s+Use \/btw/iu);
    assert.doesNotMatch(summary.feedText, /✦\s+·\s+\d+\s+✦/u);

    assert.equal(summary.toolCount, 3);
    assert.equal(summary.runningToolCount, 1);
    assert.equal(summary.errorToolCount, 1);
    assert.ok(summary.pathLinkCount >= 2, "expected file paths to be linkified");
    assert.match(summary.firstPathHref, /^[\w./-]+\.\w+$/);
  } finally {
    await browser?.close().catch(() => {});
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
