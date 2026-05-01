// Tests for the right-click create/rename/delete operations on the
// workspace file tree (server side).
//
// Covers the new helper functions in src/workspace-files.js used by the
// explorer's context menu:
//   - createEmptyWorkspaceFile  (POST /api/files/file)
//   - renameWorkspaceEntry      (PATCH /api/files)
//   - removeWorkspaceEntry      (DELETE /api/files)
//
// Each branch of the security/edge-case posture is asserted explicitly,
// mirroring the upload-pipeline tests in workspace-files-upload.test.js.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEmptyWorkspaceFile,
  ensureWorkspaceDirectory,
  removeWorkspaceEntry,
  renameWorkspaceEntry,
} from "../src/workspace-files.js";

async function makeWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "vr-explorer-crud-test-"));
}

// ─── createEmptyWorkspaceFile ───────────────────────────────────────────

test("createEmptyWorkspaceFile: writes a 0-byte file at the workspace root", async () => {
  const root = await makeWorkspace();
  try {
    const result = await createEmptyWorkspaceFile({
      root,
      relativePath: "",
      name: "notes.md",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "notes.md");
    assert.equal(result.type, "file");
    assert.equal(result.isImage, false);
    const stats = await stat(path.join(root, "notes.md"));
    assert.equal(stats.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createEmptyWorkspaceFile: writes inside a nested directory", async () => {
  const root = await makeWorkspace();
  try {
    await mkdir(path.join(root, "a", "b"), { recursive: true });
    const result = await createEmptyWorkspaceFile({
      root,
      relativePath: "a/b",
      name: "leaf.txt",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "a/b/leaf.txt");
    const stats = await stat(path.join(root, "a", "b", "leaf.txt"));
    assert.equal(stats.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createEmptyWorkspaceFile: refuses to overwrite an existing file", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "exists.txt"), "keep me", "utf8");
    await assert.rejects(
      () =>
        createEmptyWorkspaceFile({
          root,
          relativePath: "",
          name: "exists.txt",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 409);
        return true;
      },
    );
    // The existing content must NOT have been clobbered.
    const stillThere = await readFile(path.join(root, "exists.txt"), "utf8");
    assert.equal(stillThere, "keep me");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createEmptyWorkspaceFile: blocks managed top-level file names (AGENTS.md, CLAUDE.md)", async () => {
  const root = await makeWorkspace();
  try {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      await assert.rejects(
        () =>
          createEmptyWorkspaceFile({
            root,
            relativePath: "",
            name,
            fallbackCwd: root,
          }),
        (error) => {
          assert.equal(error.statusCode, 400);
          return true;
        },
      );
    }
    // But the same names INSIDE a subdirectory are fine — the managed
    // pair only matters at the workspace root.
    await mkdir(path.join(root, "subproject"));
    const result = await createEmptyWorkspaceFile({
      root,
      relativePath: "subproject",
      name: "AGENTS.md",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "subproject/AGENTS.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createEmptyWorkspaceFile: blocks names matching internal segments", async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(
      () =>
        createEmptyWorkspaceFile({
          root,
          relativePath: "",
          name: ".vibe-research",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createEmptyWorkspaceFile: rejects empty / slash-bearing / control-char names", async () => {
  const root = await makeWorkspace();
  try {
    for (const bad of ["", "  ", "..", "."]) {
      await assert.rejects(
        () =>
          createEmptyWorkspaceFile({
            root,
            relativePath: "",
            name: bad,
            fallbackCwd: root,
          }),
        (error) => {
          assert.equal(error.statusCode, 400);
          return true;
        },
      );
    }
    // Slashes get stripped to the leaf — see sanitizeUploadFileName.
    // The created file should land at the WORKSPACE root, not at the
    // path the slash hinted at, because we sanitize to the leaf.
    const result = await createEmptyWorkspaceFile({
      root,
      relativePath: "",
      name: "evil/inner.txt",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "inner.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ─── renameWorkspaceEntry ───────────────────────────────────────────────

test("renameWorkspaceEntry: renames a file in place", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "old.txt"), "payload", "utf8");
    const result = await renameWorkspaceEntry({
      root,
      relativePath: "old.txt",
      newName: "new.txt",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "new.txt");
    assert.equal(result.previousRelativePath, "old.txt");
    assert.equal(result.type, "file");
    assert.equal(await readFile(path.join(root, "new.txt"), "utf8"), "payload");
    await assert.rejects(() => stat(path.join(root, "old.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renameWorkspaceEntry: renames a directory and preserves its contents", async () => {
  const root = await makeWorkspace();
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "main.js"), "console.log(1)", "utf8");
    const result = await renameWorkspaceEntry({
      root,
      relativePath: "src",
      newName: "lib",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "lib");
    assert.equal(result.type, "directory");
    assert.equal(await readFile(path.join(root, "lib", "main.js"), "utf8"), "console.log(1)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renameWorkspaceEntry: refuses to overwrite an existing entry", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "a.txt"), "A", "utf8");
    await writeFile(path.join(root, "b.txt"), "B", "utf8");
    await assert.rejects(
      () =>
        renameWorkspaceEntry({
          root,
          relativePath: "a.txt",
          newName: "b.txt",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 409);
        return true;
      },
    );
    // Neither file moved — both originals still readable.
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "A");
    assert.equal(await readFile(path.join(root, "b.txt"), "utf8"), "B");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renameWorkspaceEntry: rename to same name is a successful no-op", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "same.txt"), "x", "utf8");
    const result = await renameWorkspaceEntry({
      root,
      relativePath: "same.txt",
      newName: "same.txt",
      fallbackCwd: root,
    });
    assert.equal(result.relativePath, "same.txt");
    assert.equal(result.previousRelativePath, "same.txt");
    assert.equal(await readFile(path.join(root, "same.txt"), "utf8"), "x");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renameWorkspaceEntry: refuses to rename the workspace root", async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(
      () =>
        renameWorkspaceEntry({
          root,
          relativePath: "",
          newName: "wat",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renameWorkspaceEntry: refuses to rename managed top-level files", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "AGENTS.md"), "# managed", "utf8");
    await assert.rejects(
      () =>
        renameWorkspaceEntry({
          root,
          relativePath: "AGENTS.md",
          newName: "AGENTS-renamed.md",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
    // Original still untouched.
    assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), "# managed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renameWorkspaceEntry: rejects internal-segment names", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "harmless.txt"), "ok", "utf8");
    await assert.rejects(
      () =>
        renameWorkspaceEntry({
          root,
          relativePath: "harmless.txt",
          newName: ".vibe-research",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ─── removeWorkspaceEntry ───────────────────────────────────────────────

test("removeWorkspaceEntry: deletes a file", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "doomed.txt"), "bye", "utf8");
    const result = await removeWorkspaceEntry({
      root,
      relativePath: "doomed.txt",
      fallbackCwd: root,
    });
    assert.equal(result.type, "file");
    assert.equal(result.relativePath, "doomed.txt");
    await assert.rejects(() => stat(path.join(root, "doomed.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeWorkspaceEntry: deletes a directory recursively", async () => {
  const root = await makeWorkspace();
  try {
    await mkdir(path.join(root, "deep", "nest"), { recursive: true });
    await writeFile(path.join(root, "deep", "nest", "leaf.txt"), "x", "utf8");
    const result = await removeWorkspaceEntry({
      root,
      relativePath: "deep",
      fallbackCwd: root,
    });
    assert.equal(result.type, "directory");
    await assert.rejects(() => stat(path.join(root, "deep")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeWorkspaceEntry: refuses to delete the workspace root", async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(
      () =>
        removeWorkspaceEntry({
          root,
          relativePath: "",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
    // Workspace root still present.
    const stats = await stat(root);
    assert.ok(stats.isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeWorkspaceEntry: refuses to delete managed top-level files", async () => {
  const root = await makeWorkspace();
  try {
    await writeFile(path.join(root, "CLAUDE.md"), "# managed", "utf8");
    await assert.rejects(
      () =>
        removeWorkspaceEntry({
          root,
          relativePath: "CLAUDE.md",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
    assert.equal(await readFile(path.join(root, "CLAUDE.md"), "utf8"), "# managed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeWorkspaceEntry: 404s when the entry does not exist", async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(
      () =>
        removeWorkspaceEntry({
          root,
          relativePath: "ghost.txt",
          fallbackCwd: root,
        }),
      (error) => {
        assert.equal(error.statusCode, 404);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removeWorkspaceEntry: rejects path-traversal", async () => {
  const root = await makeWorkspace();
  try {
    // Try to delete the parent of the workspace root via "..". The
    // path-resolver rejects entries that resolve outside the root.
    await assert.rejects(
      () =>
        removeWorkspaceEntry({
          root,
          relativePath: "..",
          fallbackCwd: root,
        }),
      (error) => {
        assert.ok(error.statusCode === 400 || error.statusCode === 404);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ─── interaction with ensureWorkspaceDirectory ──────────────────────────

test("create + rename + delete: end-to-end on a freshly mkdir'd subdir", async () => {
  const root = await makeWorkspace();
  try {
    await ensureWorkspaceDirectory({
      root,
      relativePath: "",
      name: "scratch",
      fallbackCwd: root,
    });
    await createEmptyWorkspaceFile({
      root,
      relativePath: "scratch",
      name: "draft.md",
      fallbackCwd: root,
    });
    const renamed = await renameWorkspaceEntry({
      root,
      relativePath: "scratch/draft.md",
      newName: "final.md",
      fallbackCwd: root,
    });
    assert.equal(renamed.relativePath, "scratch/final.md");
    await removeWorkspaceEntry({
      root,
      relativePath: "scratch",
      fallbackCwd: root,
    });
    await assert.rejects(() => stat(path.join(root, "scratch")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
