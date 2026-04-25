import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";

const WORKSPACE_FILE_VERSION = 1;
const DEFAULT_WORKSPACE_ID = "default";

function buildPayload(workspaces) {
  return {
    version: WORKSPACE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    workspaces,
  };
}

function workspaceIdForPath(rootPath) {
  const hash = createHash("sha256").update(path.resolve(rootPath)).digest("hex").slice(0, 16);
  return `workspace-${hash}`;
}

function pathExistsAsDirectory(value) {
  if (!value) return false;
  const stats = statSync(value, { throwIfNoEntry: false });
  return Boolean(stats?.isDirectory());
}

export function isVolatileWorkspacePath(value) {
  const normalized = path.resolve(String(value || ""));
  return (
    normalized.startsWith(`${path.sep}private${path.sep}tmp${path.sep}vibe-research-`)
    || normalized.startsWith(`${path.sep}tmp${path.sep}vibe-research-`)
    || normalized.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
    || normalized.includes(`${path.sep}.vibe-research${path.sep}app${path.sep}output${path.sep}`)
    || normalized.includes(`${path.sep}output${path.sep}`)
  );
}

export class WorkspaceStore {
  constructor({ enabled = true, stateDir, defaultWorkspaceRoot }) {
    this.enabled = enabled;
    this.stateDir = stateDir;
    this.filePath = path.join(stateDir, "workspaces.json");
    this.defaultWorkspaceRoot = path.resolve(defaultWorkspaceRoot || process.cwd());
    this.workspaces = new Map();
    this.saveCounter = 0;
    this.saveQueue = Promise.resolve();
  }

  async load() {
    this.workspaces.clear();
    if (!this.enabled) {
      this.ensureDefaultWorkspace();
      return;
    }

    try {
      const payload = JSON.parse(await readFile(this.filePath, "utf8"));
      if (payload?.version === WORKSPACE_FILE_VERSION && Array.isArray(payload.workspaces)) {
        for (const workspace of payload.workspaces) {
          if (!workspace?.id || !workspace?.root) continue;
          this.workspaces.set(String(workspace.id), {
            id: String(workspace.id),
            label: String(workspace.label || path.basename(workspace.root) || workspace.id),
            root: path.resolve(String(workspace.root)),
            kind: String(workspace.kind || "workspace"),
            createdAt: workspace.createdAt || new Date().toISOString(),
            updatedAt: workspace.updatedAt || workspace.createdAt || new Date().toISOString(),
            lastOpenedAt: workspace.lastOpenedAt || null,
          });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[vibe-research] failed to load workspaces", error);
      }
    }

    this.ensureDefaultWorkspace();
    await this.save();
  }

  ensureDefaultWorkspace() {
    const now = new Date().toISOString();
    const existing = this.workspaces.get(DEFAULT_WORKSPACE_ID);
    const root = this.defaultWorkspaceRoot;
    if (existing) {
      existing.root = root;
      existing.label = existing.label || path.basename(root) || "Workspace";
      existing.kind = existing.kind || "default";
      existing.updatedAt = now;
      return existing;
    }

    const workspace = {
      id: DEFAULT_WORKSPACE_ID,
      label: path.basename(root) || "Workspace",
      root,
      kind: "default",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  getDefaultWorkspace() {
    return this.ensureDefaultWorkspace();
  }

  ensureWorkspace(rootPath, { id = "", label = "", kind = "workspace", opened = false } = {}) {
    const root = path.resolve(rootPath || this.defaultWorkspaceRoot);
    const workspaceId = id || (root === this.defaultWorkspaceRoot ? DEFAULT_WORKSPACE_ID : workspaceIdForPath(root));
    const now = new Date().toISOString();
    const existing = this.workspaces.get(workspaceId);
    if (existing) {
      existing.root = root;
      existing.label = label || existing.label || path.basename(root) || workspaceId;
      existing.kind = kind || existing.kind || "workspace";
      existing.updatedAt = now;
      if (opened) existing.lastOpenedAt = now;
      return existing;
    }

    const workspace = {
      id: workspaceId,
      label: label || path.basename(root) || workspaceId,
      root,
      kind,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: opened ? now : null,
    };
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  getWorkspace(id) {
    return this.workspaces.get(String(id || "")) || null;
  }

  listWorkspaces() {
    return Array.from(this.workspaces.values())
      .map((workspace) => ({ ...workspace, exists: pathExistsAsDirectory(workspace.root) }))
      .sort((left, right) => String(right.lastOpenedAt || right.updatedAt || "").localeCompare(String(left.lastOpenedAt || left.updatedAt || "")));
  }

  resolveSessionCwd(session, fallbackCwd = this.defaultWorkspaceRoot) {
    const fallback = path.resolve(fallbackCwd || this.defaultWorkspaceRoot);
    const explicitWorkspaceId = String(session?.workspaceId || "").trim();
    const workspace = explicitWorkspaceId ? this.getWorkspace(explicitWorkspaceId) : null;
    const defaultWorkspace = this.getDefaultWorkspace();
    const relativePath = String(session?.launchContext?.relativePath || ".").trim() || ".";
    const workspaceCwd = workspace ? path.resolve(workspace.root, relativePath) : "";
    const persistedCwd = session?.cwd ? path.resolve(session.cwd) : "";

    if (workspace && pathExistsAsDirectory(workspaceCwd)) {
      return {
        cwd: workspaceCwd,
        workspace,
        repaired: Boolean(persistedCwd && persistedCwd !== workspaceCwd),
        reason: persistedCwd && persistedCwd !== workspaceCwd ? "workspace-registry" : "",
      };
    }

    if (persistedCwd && pathExistsAsDirectory(persistedCwd) && !isVolatileWorkspacePath(persistedCwd)) {
      const durableWorkspace = this.ensureWorkspace(persistedCwd, { opened: false });
      return {
        cwd: persistedCwd,
        workspace: durableWorkspace,
        repaired: Boolean(session?.workspaceId !== durableWorkspace.id),
        reason: session?.workspaceId !== durableWorkspace.id ? "registered-persisted-cwd" : "",
      };
    }

    if (persistedCwd && !pathExistsAsDirectory(persistedCwd) && !isVolatileWorkspacePath(persistedCwd)) {
      return {
        cwd: "",
        workspace: workspace || defaultWorkspace,
        repaired: false,
        reason: workspace ? "workspace-missing" : "cwd-missing",
        missingCwd: persistedCwd,
      };
    }

    if (pathExistsAsDirectory(fallback)) {
      const repairedWorkspace = this.ensureWorkspace(fallback, { id: DEFAULT_WORKSPACE_ID, kind: "default" });
      return {
        cwd: fallback,
        workspace: repairedWorkspace,
        repaired: Boolean(persistedCwd && persistedCwd !== fallback),
        reason: persistedCwd ? (isVolatileWorkspacePath(persistedCwd) ? "volatile-cwd-missing" : "cwd-missing") : "cwd-empty",
        missingCwd: persistedCwd || "",
      };
    }

    return {
      cwd: "",
      workspace,
      repaired: false,
      reason: "fallback-missing",
      missingCwd: persistedCwd || workspaceCwd || fallback,
    };
  }

  async save() {
    if (!this.enabled) return;
    const snapshot = this.listWorkspaces().map(({ exists, ...workspace }) => workspace);
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => this.writeSnapshot(snapshot));
    return this.saveQueue;
  }

  async writeSnapshot(workspaces) {
    await mkdir(this.stateDir, { recursive: true });
    this.saveCounter += 1;
    const tempFilePath = `${this.filePath}.${process.pid}.${this.saveCounter}.tmp`;
    try {
      await writeFile(tempFilePath, `${JSON.stringify(buildPayload(workspaces), null, 2)}\n`, "utf8");
      await rename(tempFilePath, this.filePath);
    } finally {
      await rm(tempFilePath, { force: true }).catch(() => {});
    }
  }
}
