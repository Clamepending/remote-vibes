import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { GpuHistoryStore, downsampleSeries } from "../src/gpu-history-store.js";

test("downsampleSeries preserves endpoints and limits point count", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({ index }));
  const downsampled = downsampleSeries(points, 4);

  assert.equal(downsampled.length, 4);
  assert.equal(downsampled[0].index, 0);
  assert.equal(downsampled[downsampled.length - 1].index, 9);
});

test("gpu history store records, persists, and filters by range", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "remote-vibes-gpu-history-"));
  const store = new GpuHistoryStore({
    stateDir,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    sampleIntervalMs: 60 * 1000,
    maxPoints: 10,
  });
  const base = Date.now();

  try {
    await store.initialize();
    assert.equal(
      await store.record({
        available: true,
        perGpu: [
          { index: "0", totalMemoryMb: 1000, remoteVibesMemoryMb: 100, otherMemoryMb: 50, freeMemoryMb: 850 },
        ],
      }, base),
      true,
    );
    assert.equal(
      await store.record({
        available: true,
        perGpu: [
          { index: "0", totalMemoryMb: 1000, remoteVibesMemoryMb: 200, otherMemoryMb: 75, freeMemoryMb: 725 },
        ],
      }, base + 61_000),
      true,
    );

    const dayHistory = store.getHistory("1d", base + 2 * 60 * 1000);
    assert.equal(dayHistory.range, "1d");
    assert.equal(dayHistory.gpus.length, 1);
    assert.equal(dayHistory.gpus[0].points.length, 2);
    assert.equal(dayHistory.gpus[0].points[1].remoteVibesMemoryMb, 200);

    const reloaded = new GpuHistoryStore({ stateDir, sampleIntervalMs: 60 * 1000, maxPoints: 10 });
    await reloaded.initialize();
    const persistedHistory = reloaded.getHistory("30d", base + 2 * 60 * 1000);
    assert.equal(persistedHistory.gpus[0].points.length, 2);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
