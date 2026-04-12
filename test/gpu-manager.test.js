import assert from "node:assert/strict";
import test from "node:test";
import { findDescendantPids, getGpuStatus, summarizeGpuUsage } from "../src/gpu-manager.js";

test("findDescendantPids expands process roots through the parent map", () => {
  const descendants = findDescendantPids(
    [10],
    new Map([
      [10, 1],
      [11, 10],
      [12, 11],
      [99, 1],
    ]),
  );

  assert.deepEqual([...descendants].sort((left, right) => left - right), [10, 11, 12]);
});

test("summarizeGpuUsage counts only GPUs used by live non-shell agent descendants", () => {
  const summary = summarizeGpuUsage({
    gpuRows: [
      { index: "0", uuid: "GPU-0", memory_total_mb: "1000" },
      { index: "1", uuid: "GPU-1", memory_total_mb: "2000" },
      { index: "2", uuid: "GPU-2", memory_total_mb: "3000" },
    ],
    computeRows: [
      { gpu_uuid: "GPU-0", pid: "201", used_memory_mb: "400" },
      { gpu_uuid: "GPU-1", pid: "202", used_memory_mb: "600" },
      { gpu_uuid: "GPU-2", pid: "900", used_memory_mb: "900" },
    ],
    parentByPid: new Map([
      [101, 1],
      [201, 101],
      [202, 201],
      [300, 1],
      [900, 300],
    ]),
    sessionRoots: [
      { providerId: "codex", pid: 101 },
      { providerId: "shell", pid: 300 },
    ],
  });

  assert.deepEqual(summary, {
    available: true,
    total: 3,
    used: 2,
    idle: 1,
    activeAgentSessions: 1,
    totalMemoryMb: 6000,
    remoteVibesMemoryMb: 1000,
    otherMemoryMb: 900,
    freeMemoryMb: 4100,
    perGpu: [
      { index: "0", totalMemoryMb: 1000, remoteVibesMemoryMb: 400, otherMemoryMb: 0, freeMemoryMb: 600 },
      { index: "1", totalMemoryMb: 2000, remoteVibesMemoryMb: 600, otherMemoryMb: 0, freeMemoryMb: 1400 },
      { index: "2", totalMemoryMb: 3000, remoteVibesMemoryMb: 0, otherMemoryMb: 900, freeMemoryMb: 2100 },
    ],
  });
});

test("getGpuStatus falls back cleanly when gpu inspection is unavailable", async () => {
  const status = await getGpuStatus({
    sessionRoots: [
      { providerId: "codex", pid: 111 },
      { providerId: "shell", pid: 222 },
    ],
    execFileImpl: async () => {
      throw new Error("nvidia-smi unavailable");
    },
  });

  assert.equal(status.available, false);
  assert.equal(status.total, 0);
  assert.equal(status.used, 0);
  assert.equal(status.activeAgentSessions, 1);
  assert.deepEqual(status.perGpu, []);
});
