import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("vibe-research --url defaults to the current local app port", async () => {
  const scriptPath = path.resolve("/Users/mark/Desktop/projects/vibe-research/bin/vibe-research");
  const { stdout } = await execFileAsync(scriptPath, ["--url"], {
    env: {
      ...process.env,
      LC_ALL: "C",
    },
  });

  assert.equal(stdout.trim(), "http://localhost:4826/");
});
