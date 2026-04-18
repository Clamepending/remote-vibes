import path from "node:path";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { resolveCwd } from "./session-manager.js";

function buildHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRelativePath(value) {
  if (!value) {
    return "";
  }

  const normalized = String(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return normalized === "." ? "" : normalized;
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return normalizeRelativePath(relativePath);
  }

  throw buildHttpError("Path escapes the selected folder root.", 400);
}

function normalizeFolderName(value) {
  const folderName = String(value || "").trim();

  if (!folderName) {
    throw buildHttpError("Folder name is required.", 400);
  }

  if (
    folderName.includes("\0") ||
    folderName.includes("/") ||
    folderName.includes("\\") ||
    folderName === "." ||
    folderName === ".."
  ) {
    throw buildHttpError("Folder name must be a single folder name.", 400);
  }

  return folderName;
}

export async function listFolderEntries({
  root,
  relativePath = "",
  fallbackCwd,
}) {
  const rootPath = resolveCwd(root || fallbackCwd, fallbackCwd);
  const realRootPath = await realpath(rootPath);
  const requestedPath = path.resolve(realRootPath, relativePath || ".");
  const realTargetPath = await realpath(requestedPath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw buildHttpError(`Folder does not exist: ${normalizeRelativePath(relativePath) || rootPath}`, 404);
    }

    throw error;
  });
  const normalizedRelativePath = ensurePathInsideRoot(realRootPath, realTargetPath);
  const entryStats = await stat(realTargetPath);

  if (!entryStats.isDirectory()) {
    throw buildHttpError("Selected path is not a folder.", 400);
  }

  const directoryEntries = await readdir(realTargetPath, { withFileTypes: true });
  const entries = directoryEntries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      path: path.join(realTargetPath, entry.name),
      relativePath: normalizeRelativePath(path.relative(realRootPath, path.join(realTargetPath, entry.name))),
      type: "directory",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parentPath =
    realTargetPath === path.parse(realTargetPath).root ? "" : path.dirname(realTargetPath);

  return {
    currentPath: realTargetPath,
    entries,
    parentPath,
    relativePath: normalizedRelativePath,
    root: realRootPath,
  };
}

export async function createFolderEntry({
  root,
  relativePath = "",
  name,
  fallbackCwd,
}) {
  const folderName = normalizeFolderName(name);
  const rootPath = resolveCwd(root || fallbackCwd, fallbackCwd);
  const realRootPath = await realpath(rootPath);
  const requestedPath = path.resolve(realRootPath, relativePath || ".");
  const realParentPath = await realpath(requestedPath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw buildHttpError(`Folder does not exist: ${normalizeRelativePath(relativePath) || rootPath}`, 404);
    }

    throw error;
  });
  ensurePathInsideRoot(realRootPath, realParentPath);

  const parentStats = await stat(realParentPath);
  if (!parentStats.isDirectory()) {
    throw buildHttpError("Selected path is not a folder.", 400);
  }

  const targetPath = path.join(realParentPath, folderName);
  ensurePathInsideRoot(realRootPath, targetPath);

  try {
    await mkdir(targetPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw buildHttpError("Folder already exists.", 409);
    }

    throw error;
  }

  const realTargetPath = await realpath(targetPath);

  return {
    folder: {
      name: folderName,
      path: realTargetPath,
      relativePath: normalizeRelativePath(path.relative(realRootPath, realTargetPath)),
      type: "directory",
    },
  };
}
