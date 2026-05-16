import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const appLauncherDefinitions = [
  {
    id: "browser",
    label: "Browser",
    kind: "canvas-app",
    category: "browser",
    priority: 97,
    description: "Open an embedded browser surface in the canvas on this machine.",
    canvasSurface: "browser",
  },
  {
    id: "codex",
    label: "Codex",
    kind: "desktop-app",
    category: "agent-app",
    priority: 95,
    description: "Open the Codex desktop app on this machine.",
    macAppName: "Codex",
    macPaths: [
      "/Applications/Codex.app",
      "~/Applications/Codex.app",
    ],
  },
  {
    id: "claude",
    label: "Claude",
    kind: "desktop-app",
    category: "agent-app",
    priority: 92,
    description: "Open the Claude desktop app on this machine.",
    macAppName: "Claude",
    macPaths: [
      "/Applications/Claude.app",
      "~/Applications/Claude.app",
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "desktop-app",
    category: "editor",
    priority: 90,
    description: "Open Cursor on this machine.",
    macAppName: "Cursor",
    macPaths: [
      "/Applications/Cursor.app",
      "~/Applications/Cursor.app",
    ],
    commands: ["cursor", "cursor-insiders"],
  },
  {
    id: "vscode",
    label: "VS Code",
    kind: "desktop-app",
    category: "editor",
    priority: 82,
    description: "Open Visual Studio Code on this machine.",
    macAppName: "Visual Studio Code",
    macPaths: [
      "/Applications/Visual Studio Code.app",
      "~/Applications/Visual Studio Code.app",
    ],
    commands: ["code"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "desktop-app",
    category: "editor",
    priority: 78,
    description: "Open Windsurf on this machine.",
    macAppName: "Windsurf",
    macPaths: [
      "/Applications/Windsurf.app",
      "~/Applications/Windsurf.app",
    ],
    commands: ["windsurf"],
  },
  {
    id: "zed",
    label: "Zed",
    kind: "desktop-app",
    category: "editor",
    priority: 74,
    description: "Open Zed on this machine.",
    macAppName: "Zed",
    macPaths: [
      "/Applications/Zed.app",
      "~/Applications/Zed.app",
    ],
    commands: ["zed"],
  },
  {
    id: "pycharm",
    label: "PyCharm",
    kind: "desktop-app",
    category: "editor",
    priority: 70,
    description: "Open PyCharm on this machine.",
    macAppName: "PyCharm",
    macPaths: [
      "/Applications/PyCharm.app",
      "/Applications/PyCharm CE.app",
      "~/Applications/PyCharm.app",
      "~/Applications/PyCharm CE.app",
    ],
    commands: ["pycharm"],
  },
  {
    id: "intellij",
    label: "IntelliJ",
    kind: "desktop-app",
    category: "editor",
    priority: 68,
    description: "Open IntelliJ IDEA on this machine.",
    macAppName: "IntelliJ IDEA",
    macPaths: [
      "/Applications/IntelliJ IDEA.app",
      "/Applications/IntelliJ IDEA CE.app",
      "~/Applications/IntelliJ IDEA.app",
      "~/Applications/IntelliJ IDEA CE.app",
    ],
    commands: ["idea", "intellij-idea"],
  },
  {
    id: "dataspell",
    label: "DataSpell",
    kind: "desktop-app",
    category: "editor",
    priority: 66,
    description: "Open DataSpell on this machine.",
    macAppName: "DataSpell",
    macPaths: [
      "/Applications/DataSpell.app",
      "~/Applications/DataSpell.app",
    ],
    commands: ["dataspell"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    kind: "desktop-app",
    category: "agent-app",
    priority: 76,
    description: "Open OpenCode on this machine.",
    macAppName: "OpenCode",
    macPaths: [
      "/Applications/OpenCode.app",
      "~/Applications/OpenCode.app",
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    kind: "desktop-app",
    category: "terminal",
    priority: 58,
    description: "Open a local terminal on this machine.",
    macAppName: "Terminal",
    macPaths: [
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Utilities/Terminal.app",
    ],
    commands: ["x-terminal-emulator", "gnome-terminal", "konsole"],
  },
  {
    id: "iterm",
    label: "iTerm",
    kind: "desktop-app",
    category: "terminal",
    priority: 56,
    description: "Open iTerm on this machine.",
    macAppName: "iTerm",
    macPaths: [
      "/Applications/iTerm.app",
      "/Applications/iTerm2.app",
      "~/Applications/iTerm.app",
      "~/Applications/iTerm2.app",
    ],
  },
  {
    id: "warp",
    label: "Warp",
    kind: "desktop-app",
    category: "terminal",
    priority: 54,
    description: "Open Warp on this machine.",
    macAppName: "Warp",
    macPaths: [
      "/Applications/Warp.app",
      "~/Applications/Warp.app",
    ],
    commands: ["warp"],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    kind: "desktop-app",
    category: "terminal",
    priority: 53,
    description: "Open Ghostty on this machine.",
    macAppName: "Ghostty",
    macPaths: [
      "/Applications/Ghostty.app",
      "~/Applications/Ghostty.app",
    ],
    commands: ["ghostty"],
  },
  {
    id: "wezterm",
    label: "WezTerm",
    kind: "desktop-app",
    category: "terminal",
    priority: 52,
    description: "Open WezTerm on this machine.",
    macAppName: "WezTerm",
    macPaths: [
      "/Applications/WezTerm.app",
      "~/Applications/WezTerm.app",
    ],
    commands: ["wezterm"],
  },
  {
    id: "kitty",
    label: "Kitty",
    kind: "desktop-app",
    category: "terminal",
    priority: 51,
    description: "Open Kitty on this machine.",
    macAppName: "kitty",
    macPaths: [
      "/Applications/kitty.app",
      "~/Applications/kitty.app",
    ],
    commands: ["kitty"],
  },
  {
    id: "chrome",
    label: "Chrome",
    kind: "desktop-app",
    category: "browser",
    priority: 48,
    description: "Open Google Chrome on this machine.",
    macAppName: "Google Chrome",
    macPaths: [
      "/Applications/Google Chrome.app",
      "~/Applications/Google Chrome.app",
    ],
    commands: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  },
  {
    id: "brave",
    label: "Brave",
    kind: "desktop-app",
    category: "browser",
    priority: 47,
    description: "Open Brave Browser on this machine.",
    macAppName: "Brave Browser",
    macPaths: [
      "/Applications/Brave Browser.app",
      "~/Applications/Brave Browser.app",
    ],
    commands: ["brave-browser", "brave"],
  },
  {
    id: "firefox",
    label: "Firefox",
    kind: "desktop-app",
    category: "browser",
    priority: 46,
    description: "Open Firefox on this machine.",
    macAppName: "Firefox",
    macPaths: [
      "/Applications/Firefox.app",
      "~/Applications/Firefox.app",
    ],
    commands: ["firefox"],
  },
  {
    id: "edge",
    label: "Edge",
    kind: "desktop-app",
    category: "browser",
    priority: 44,
    description: "Open Microsoft Edge on this machine.",
    macAppName: "Microsoft Edge",
    macPaths: [
      "/Applications/Microsoft Edge.app",
      "~/Applications/Microsoft Edge.app",
    ],
    commands: ["microsoft-edge", "microsoft-edge-stable"],
  },
  {
    id: "safari",
    label: "Safari",
    kind: "desktop-app",
    category: "browser",
    priority: 42,
    description: "Open Safari on this machine.",
    macAppName: "Safari",
    macPaths: [
      "/Applications/Safari.app",
      "/System/Applications/Safari.app",
    ],
  },
  {
    id: "arc",
    label: "Arc",
    kind: "desktop-app",
    category: "browser",
    priority: 40,
    description: "Open Arc on this machine.",
    macAppName: "Arc",
    macPaths: [
      "/Applications/Arc.app",
      "~/Applications/Arc.app",
    ],
  },
  {
    id: "jupyterlab",
    label: "JupyterLab",
    kind: "desktop-app",
    category: "research",
    priority: 38,
    description: "Open JupyterLab on this machine.",
    commands: ["jupyter-lab", "jupyter"],
  },
  {
    id: "rstudio",
    label: "RStudio",
    kind: "desktop-app",
    category: "research",
    priority: 37,
    description: "Open RStudio on this machine.",
    macAppName: "RStudio",
    macPaths: [
      "/Applications/RStudio.app",
      "~/Applications/RStudio.app",
    ],
    commands: ["rstudio"],
  },
  {
    id: "docker",
    label: "Docker",
    kind: "desktop-app",
    category: "runtime",
    priority: 36,
    description: "Open Docker Desktop on this machine.",
    macAppName: "Docker",
    macPaths: [
      "/Applications/Docker.app",
      "~/Applications/Docker.app",
    ],
  },
  {
    id: "xcode",
    label: "Xcode",
    kind: "desktop-app",
    category: "developer",
    priority: 30,
    description: "Open Xcode on this machine.",
    macAppName: "Xcode",
    macPaths: [
      "/Applications/Xcode.app",
      "~/Applications/Xcode.app",
    ],
  },
  {
    id: "obsidian",
    label: "Obsidian",
    kind: "desktop-app",
    category: "knowledge",
    priority: 28,
    description: "Open Obsidian on this machine.",
    macAppName: "Obsidian",
    macPaths: [
      "/Applications/Obsidian.app",
      "~/Applications/Obsidian.app",
    ],
    commands: ["obsidian"],
  },
  {
    id: "notion",
    label: "Notion",
    kind: "desktop-app",
    category: "knowledge",
    priority: 26,
    description: "Open Notion on this machine.",
    macAppName: "Notion",
    macPaths: [
      "/Applications/Notion.app",
      "~/Applications/Notion.app",
    ],
  },
  {
    id: "slack",
    label: "Slack",
    kind: "desktop-app",
    category: "communication",
    priority: 24,
    description: "Open Slack on this machine.",
    macAppName: "Slack",
    macPaths: [
      "/Applications/Slack.app",
      "~/Applications/Slack.app",
    ],
    commands: ["slack"],
  },
  {
    id: "zoom",
    label: "Zoom",
    kind: "desktop-app",
    category: "communication",
    priority: 22,
    description: "Open Zoom on this machine.",
    macAppName: "zoom.us",
    macPaths: [
      "/Applications/zoom.us.app",
      "~/Applications/zoom.us.app",
    ],
  },
];

function compactText(value, max = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function expandPath(value, env = process.env) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "~") return env.HOME || process.env.HOME || "";
  if (text.startsWith("~/")) {
    const home = env.HOME || process.env.HOME || "";
    return home ? path.join(home, text.slice(2)) : "";
  }
  return text;
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findCommand(command, env = process.env) {
  if (!command) return "";
  try {
    const { stdout } = await execFileAsync("/bin/sh", ["-lc", "command -v -- \"$1\"", "sh", String(command)], {
      env,
      timeout: 5_000,
    });
    return stdout
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .pop() || "";
  } catch {
    return "";
  }
}

function normalizePriority(value) {
  const priority = Number(value);
  return Number.isFinite(priority) ? Math.round(priority) : 0;
}

function normalizeStringList(value, max = 20) {
  const source = Array.isArray(value) ? value : (value ? [value] : []);
  return source
    .map((entry) => compactText(entry, 240))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeLauncherDefinition(definition = {}) {
  const id = compactText(definition.id, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (!id) return null;
  const label = compactText(definition.label || id, 80);
  return {
    id,
    label,
    kind: compactText(definition.kind || "desktop-app", 40),
    category: compactText(definition.category || "app", 40).toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
    priority: normalizePriority(definition.priority),
    description: compactText(definition.description || "", 160),
    canvasSurface: compactText(definition.canvasSurface || definition.surface || "", 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
    defaultUrl: compactText(definition.defaultUrl || definition.url || "", 2048),
    macAppName: compactText(definition.macAppName || definition.appName || label, 80),
    macPaths: normalizeStringList(definition.macPaths || definition.paths),
    commands: normalizeStringList(definition.commands || definition.command),
  };
}

export function customAppLauncherDefinitionsFromEnv(env = process.env) {
  const raw = String(
    env.SWARMLAB_APP_LAUNCHERS_JSON ||
      env.VIBE_RESEARCH_APP_LAUNCHERS_JSON ||
      "",
  ).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : [])
      .map(normalizeLauncherDefinition)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getAppLauncherDefinitions(env = process.env, baseDefinitions = appLauncherDefinitions) {
  const seen = new Set();
  return [
    ...(Array.isArray(baseDefinitions) ? baseDefinitions : []),
    ...customAppLauncherDefinitionsFromEnv(env),
  ]
    .map(normalizeLauncherDefinition)
    .filter((definition) => {
      if (!definition || seen.has(definition.id)) return false;
      seen.add(definition.id);
      return true;
    });
}

async function detectAppLauncher(definition, env = process.env, platform = os.platform()) {
  const normalized = normalizeLauncherDefinition(definition);
  const id = normalized?.id || "";
  if (!normalized || !id) return null;
  const base = {
    id,
    label: normalized.label,
    kind: normalized.kind,
    category: normalized.category,
    priority: normalized.priority,
    description: normalized.description,
    available: false,
    platform,
  };

  if (normalized.kind === "canvas-app" || normalized.canvasSurface) {
    return {
      ...base,
      kind: "canvas-app",
      available: true,
      launchMode: "canvas-surface",
      canvasSurface: normalized.canvasSurface || id,
      defaultUrl: normalized.defaultUrl,
    };
  }

  if (platform === "darwin") {
    for (const candidate of normalized.macPaths) {
      const appPath = expandPath(candidate, env);
      if (appPath && await pathExists(appPath)) {
        return {
          ...base,
          available: true,
          launchMode: "mac-app-path",
          appPath,
          appName: normalized.macAppName,
        };
      }
    }
  }

  for (const command of normalized.commands) {
    const resolvedCommand = await findCommand(command, env);
    if (resolvedCommand) {
      return {
        ...base,
        available: true,
        launchMode: "command",
        command: resolvedCommand,
      };
    }
  }

  return base;
}

export async function detectAppLaunchers(definitions = null, env = process.env, platform = os.platform()) {
  const launcherDefinitions = definitions || getAppLauncherDefinitions(env);
  const detected = await Promise.all(
    (Array.isArray(launcherDefinitions) ? launcherDefinitions : []).map((definition) => detectAppLauncher(definition, env, platform)),
  );
  return detected
    .filter(Boolean)
    .sort((left, right) => Number(right.available) - Number(left.available) || (right.priority || 0) - (left.priority || 0) || left.label.localeCompare(right.label));
}

export function summarizeAppLauncher(launcher = {}) {
  return {
    id: compactText(launcher.id, 80),
    label: compactText(launcher.label || launcher.id, 80),
    kind: compactText(launcher.kind || "desktop-app", 40),
    category: compactText(launcher.category || "app", 40),
    priority: normalizePriority(launcher.priority),
    description: compactText(launcher.description || "", 160),
    available: Boolean(launcher.available),
    platform: compactText(launcher.platform, 40),
    canvasSurface: compactText(launcher.canvasSurface || launcher.surface || "", 80),
    defaultUrl: compactText(launcher.defaultUrl || launcher.url || "", 2048),
  };
}

export async function launchAppLauncher(launcherId, launchers = [], {
  execFileImpl = execFileAsync,
  spawnImpl = spawn,
  timeoutMs = 10_000,
} = {}) {
  const id = compactText(launcherId, 80);
  const launcher = (Array.isArray(launchers) ? launchers : []).find((entry) => entry?.id === id);
  if (!launcher) {
    throw new Error(`Unknown app launcher: ${id || "unknown"}`);
  }
  if (!launcher.available) {
    throw new Error(`${launcher.label || id} is not available on this machine.`);
  }

  if (launcher.launchMode === "mac-app-path" && launcher.appPath) {
    await execFileImpl("open", [launcher.appPath], { timeout: timeoutMs });
    return { launched: true, launcher: summarizeAppLauncher(launcher) };
  }
  if (launcher.launchMode === "mac-app-name" && launcher.appName) {
    await execFileImpl("open", ["-a", launcher.appName], { timeout: timeoutMs });
    return { launched: true, launcher: summarizeAppLauncher(launcher) };
  }
  if (launcher.launchMode === "command" && launcher.command) {
    const child = spawnImpl(launcher.command, [], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref?.();
    return { launched: true, launcher: summarizeAppLauncher(launcher) };
  }
  if (launcher.launchMode === "canvas-surface") {
    return {
      launched: true,
      embedded: true,
      surface: compactText(launcher.canvasSurface || launcher.surface || launcher.id, 80),
      url: compactText(launcher.defaultUrl || launcher.url || "", 2048),
      launcher: summarizeAppLauncher(launcher),
    };
  }

  throw new Error(`${launcher.label || id} does not have a launch command for this platform.`);
}
