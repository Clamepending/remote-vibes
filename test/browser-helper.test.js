import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { createRemoteVibesApp } from "../src/create-app.js";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const browserHelperPath = path.join(rootDir, "bin", "rv-browser");
const browserTestEnv = {
  ...process.env,
  PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(path.delimiter),
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function parseJsonPayload(text) {
  const rawText = String(text ?? "");
  const jsonStart = rawText.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(`No JSON payload found in:\n${rawText}`);
  }

  return JSON.parse(rawText.slice(jsonStart));
}

async function waitForFile(filePath, timeoutMs = 20_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await stat(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

async function startDemoServer() {
  const server = http.createServer((request, response) => {
    if (request.url !== "/") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Model Lab</title>
    <style>
      body { font-family: sans-serif; padding: 24px; }
      textarea { width: 100%; min-height: 100px; }
      .stack { display: grid; gap: 12px; max-width: 680px; }
      #result, #upload-result, #status { padding: 12px; border: 1px solid #d0d7de; }
    </style>
  </head>
  <body>
    <div class="stack">
      <h1>Localhost Eval Harness</h1>
      <label>
        Prompt
        <textarea id="prompt"></textarea>
      </label>
      <label>
        Mode
        <select id="mode">
          <option value="fast">fast</option>
          <option value="qa">qa</option>
        </select>
      </label>
      <label>
        <input id="accept" type="checkbox" />
        Approve result
      </label>
      <label>
        Upload
        <input id="upload" type="file" />
      </label>
      <div id="upload-result">Uploaded: none</div>
      <button id="generate" type="button">Generate</button>
      <div id="status">idle</div>
      <div id="result">Generated: none</div>
    </div>
    <script>
      const prompt = document.querySelector("#prompt");
      const mode = document.querySelector("#mode");
      const accept = document.querySelector("#accept");
      const upload = document.querySelector("#upload");
      const uploadResult = document.querySelector("#upload-result");
      const status = document.querySelector("#status");
      const result = document.querySelector("#result");
      const generate = document.querySelector("#generate");

      upload.addEventListener("change", () => {
        const [file] = upload.files;
        uploadResult.textContent = file ? "Uploaded: " + file.name : "Uploaded: none";
      });

      generate.addEventListener("click", () => {
        status.textContent = "running";
        result.textContent = "Generated: pending";

        window.setTimeout(() => {
          const promptValue = prompt.value.trim() || "empty";
          const modeValue = mode.value;
          const approvalValue = accept.checked ? "approved" : "pending";
          status.textContent = "ready";
          result.textContent = "Generated (" + modeValue + ", " + approvalValue + "): " + promptValue;
        }, 180);
      });
    </script>
  </body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function startRemoteVibes(options = {}) {
  const app = await createRemoteVibesApp({
    host: "127.0.0.1",
    port: 0,
    cwd: process.cwd(),
    persistSessions: false,
    ...options,
  });

  return {
    app,
    baseUrl: `http://127.0.0.1:${app.config.port}`,
  };
}

test("rv-browser doctor resolves a usable local browser", async () => {
  const result = await execFile(browserHelperPath, ["doctor"], {
    cwd: rootDir,
    env: browserTestEnv,
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "doctor");
  assert.equal(typeof payload.browser.executablePath, "string");
  assert.ok(payload.browser.executablePath.length > 0);
});

test("rv-browser run can drive a localhost app, upload files, and save screenshots", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "remote-vibes-browser-"));
  const demoServer = await startDemoServer();
  const demoPort = demoServer.address().port;

  try {
    const uploadFilePath = path.join(workspaceDir, "sample.txt");
    const stepsFilePath = path.join(workspaceDir, "steps.json");
    const finalShotPath = path.join(workspaceDir, "artifacts", "final.png");
    const stepShotPath = path.join(workspaceDir, "artifacts", "step.png");

    await writeFile(uploadFilePath, "sample artifact\n", "utf8");
    await writeFile(
      stepsFilePath,
      `${JSON.stringify(
        [
          { action: "fill", selector: "#prompt", value: "a cinematic fox" },
          { action: "select", selector: "#mode", value: "qa" },
          { action: "check", selector: "#accept" },
          { action: "setInputFiles", selector: "#upload", path: "sample.txt" },
          { action: "waitForText", text: "Uploaded: sample.txt" },
          { action: "click", selector: "#generate" },
          { action: "waitForText", text: "Generated (qa, approved): a cinematic fox" },
          { action: "screenshot", path: "artifacts/step.png", fullPage: true },
        ],
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await execFile(
      browserHelperPath,
      ["run", String(demoPort), "--steps-file", path.basename(stepsFilePath), "--output", "artifacts/final.png"],
      {
        cwd: workspaceDir,
        env: browserTestEnv,
      },
    );
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.command, "run");
    assert.match(payload.title, /Model Lab/);
    assert.match(payload.text, /Uploaded: sample\.txt/);
    assert.match(payload.text, /Generated \(qa, approved\): a cinematic fox/);
    assert.equal(await realpath(payload.outputPath), await realpath(finalShotPath));
    assert.equal(await realpath(payload.stepResults.at(-1).path), await realpath(stepShotPath));
    assert.ok((await stat(finalShotPath)).size > 0);
    assert.ok((await stat(stepShotPath)).size > 0);
  } finally {
    await new Promise((resolve) => demoServer.close(resolve));
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("rv-browser rejects non-local targets", async () => {
  await assert.rejects(
    execFile(browserHelperPath, ["screenshot", "https://example.com"], {
      cwd: rootDir,
      env: browserTestEnv,
    }),
    (error) => {
      const payload = parseJsonPayload(error.stderr);
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, "TARGET_NOT_LOCAL");
      return true;
    },
  );
});

test("shell sessions can invoke rv-browser against localhost apps", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "remote-vibes-session-browser-"));
  const demoServer = await startDemoServer();
  const remoteVibes = await startRemoteVibes({
    cwd: workspaceDir,
  });

  try {
    const demoPort = demoServer.address().port;
    const createResponse = await fetch(`${remoteVibes.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Browser Shell",
        cwd: workspaceDir,
      }),
    });
    assert.equal(createResponse.status, 201);

    const { session } = await createResponse.json();
    const websocket = new WebSocket(`${remoteVibes.baseUrl.replace("http", "ws")}/ws?sessionId=${session.id}`);
    const marker = "REMOTE_VIBES_BROWSER_SESSION_DONE";
    const commandPath = path.join(workspaceDir, "rv-browser-command.txt");
    const jsonPath = path.join(workspaceDir, "rv-browser-session.json");
    const screenshotPath = path.join(workspaceDir, "rv-browser-session.png");

    const snapshot = await new Promise((resolve, reject) => {
      let combined = "";
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for the shell snapshot.\n${combined}`));
      }, 20_000);

      websocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));
        const data = payload.data || "";
        combined += data;

        if (payload.type === "snapshot") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    assert.equal(snapshot.type, "snapshot");
    websocket.send(
      JSON.stringify({
        type: "resize",
        cols: 120,
        rows: 34,
      }),
    );
    websocket.send(
      JSON.stringify({
        type: "input",
        data:
          [
            `command -v rv-browser > ${shellQuote(commandPath)}`,
            `rv-browser screenshot ${demoPort} ${shellQuote(screenshotPath)} > ${shellQuote(jsonPath)}`,
            `printf "${marker}\\n"`,
          ].join(" && ") + "\r",
      }),
    );

    await waitForFile(commandPath);
    await waitForFile(jsonPath);
    await waitForFile(screenshotPath);
    websocket.close();
    await once(websocket, "close");

    const resolvedCommand = (await readFile(commandPath, "utf8")).trim();
    assert.match(resolvedCommand, /rv-browser$/);

    const payload = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "screenshot");
    assert.ok((await stat(screenshotPath)).size > 0);
  } finally {
    await remoteVibes.app.close();
    await new Promise((resolve) => demoServer.close(resolve));
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
