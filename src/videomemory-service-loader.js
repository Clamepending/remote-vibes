import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VIDEOMEMORY_RUNTIME_ENV_KEYS = Object.freeze([
  "VIBE_RESEARCH_VIDEOMEMORY_SERVICE_PATH",
  "REMOTE_VIBES_VIDEOMEMORY_SERVICE_PATH",
  "VIDEOMEMORY_SERVICE_PATH",
]);
const STANDALONE_RUNTIME_PACKAGE = "@clamepending/videomemory-building/tools/videomemory-service.js";

const appRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveRuntimePath(candidatePath, baseDir) {
  const normalizedPath = String(candidatePath || "").trim();
  if (!normalizedPath) {
    return "";
  }

  return path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(baseDir, normalizedPath);
}

async function canAccessFile(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importRuntimeModule(modulePath) {
  const runtime = await import(pathToFileURL(modulePath).href);
  if (typeof runtime?.VideoMemoryService !== "function") {
    throw new Error(`missing VideoMemoryService export in ${modulePath}`);
  }
  return runtime;
}

function getConfiguredRuntimePath(env, baseDir) {
  for (const key of VIDEOMEMORY_RUNTIME_ENV_KEYS) {
    const resolvedPath = resolveRuntimePath(env?.[key], baseDir);
    if (resolvedPath) {
      return { key, path: resolvedPath };
    }
  }
  return null;
}

export async function loadVideoMemoryRuntime({
  baseDir = appRootDir,
  env = process.env,
  preferStandalone = true,
} = {}) {
  const configuredRuntime = getConfiguredRuntimePath(env, baseDir);
  if (configuredRuntime) {
    if (!(await canAccessFile(configuredRuntime.path))) {
      throw new Error(
        `${configuredRuntime.key} points to a missing VideoMemory runtime: ${configuredRuntime.path}`,
      );
    }
    return importRuntimeModule(configuredRuntime.path);
  }

  if (preferStandalone) {
    try {
      const runtime = await import(STANDALONE_RUNTIME_PACKAGE);
      if (typeof runtime?.VideoMemoryService === "function") {
        return runtime;
      }
    } catch {
      // Fall through to adjacent-repo discovery or the in-repo snapshot.
    }

    const adjacentRuntimePath = path.resolve(baseDir, "..", "videomemory-building", "tools", "videomemory-service.js");
    if (await canAccessFile(adjacentRuntimePath)) {
      try {
        return await importRuntimeModule(adjacentRuntimePath);
      } catch {
        // Fall back to the in-repo snapshot if the standalone checkout is unavailable or broken.
      }
    }
  }

  return import("./videomemory-service.js");
}
