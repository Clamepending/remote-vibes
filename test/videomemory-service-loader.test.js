import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { VideoMemoryService as LocalVideoMemoryService } from "../src/videomemory-service.js";
import { loadVideoMemoryRuntime } from "../src/videomemory-service-loader.js";

test("loadVideoMemoryRuntime honors explicit runtime overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vr-videomemory-runtime-"));

  try {
    const runtimePath = path.join(tempDir, "tools", "custom-videomemory-service.js");
    await mkdir(path.dirname(runtimePath), { recursive: true });
    await writeFile(
      runtimePath,
      [
        "export class VideoMemoryService {",
        "  static source = 'standalone-test';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const runtime = await loadVideoMemoryRuntime({
      baseDir: tempDir,
      env: {
        VIBE_RESEARCH_VIDEOMEMORY_SERVICE_PATH: "./tools/custom-videomemory-service.js",
      },
      preferStandalone: false,
    });

    assert.equal(runtime.VideoMemoryService.source, "standalone-test");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadVideoMemoryRuntime falls back to the in-repo snapshot when standalone discovery is disabled", async () => {
  const runtime = await loadVideoMemoryRuntime({
    env: {},
    preferStandalone: false,
  });

  assert.equal(runtime.VideoMemoryService, LocalVideoMemoryService);
});
