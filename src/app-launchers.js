import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const appLauncherDefinitions = [
  {
    id: "cursor",
    label: "Cursor",
    kind: "desktop-app",
    macAppName: "Cursor",
    macPaths: [
      "/Applications/Cursor.app",
      "~/Applications/Cursor.app",
    ],
    commands: ["cursor", "cursor-insiders"],
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
    const { stdout } = await execFileAsync(process.env.SHELL || "/bin/sh", ["-lc", `command -v -- ${command}`], {
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

async function detectAppLauncher(definition, env = process.env, platform = os.platform()) {
  const id = compactText(definition?.id, 80);
  if (!id) return null;
  const base = {
    id,
    label: compactText(definition?.label || id, 80),
    kind: compactText(definition?.kind || "desktop-app", 40),
    available: false,
    platform,
  };

  if (platform === "darwin") {
    for (const candidate of Array.isArray(definition.macPaths) ? definition.macPaths : []) {
      const appPath = expandPath(candidate, env);
      if (appPath && await pathExists(appPath)) {
        return {
          ...base,
          available: true,
          launchMode: "mac-app-path",
          appPath,
          appName: compactText(definition.macAppName || definition.label || id, 80),
        };
      }
    }
  }

  for (const command of Array.isArray(definition.commands) ? definition.commands : []) {
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

export async function detectAppLaunchers(definitions = appLauncherDefinitions, env = process.env, platform = os.platform()) {
  const detected = await Promise.all(
    (Array.isArray(definitions) ? definitions : []).map((definition) => detectAppLauncher(definition, env, platform)),
  );
  return detected.filter(Boolean);
}

export function summarizeAppLauncher(launcher = {}) {
  return {
    id: compactText(launcher.id, 80),
    label: compactText(launcher.label || launcher.id, 80),
    kind: compactText(launcher.kind || "desktop-app", 40),
    available: Boolean(launcher.available),
    platform: compactText(launcher.platform, 40),
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

  throw new Error(`${launcher.label || id} does not have a launch command for this platform.`);
}
