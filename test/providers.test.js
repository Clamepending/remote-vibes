import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { detectProviders, getDefaultProviderId, providerDefinitions, resolveProviderCommand } from "../src/providers.js";

test("resolveProviderCommand falls back to executable path hints", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-provider-"));
  const fakeCodexPath = path.join(tempDir, "codex");

  try {
    await writeFile(fakeCodexPath, "#!/usr/bin/env bash\nexit 0\n");
    await chmod(fakeCodexPath, 0o755);

    const result = await resolveProviderCommand(
      {
        id: "codex",
        label: "Codex",
        command: "codex",
        launchCommand: "codex",
        pathHints: [fakeCodexPath],
      },
      { HOME: tempDir, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" },
    );

    assert.deepEqual(result, {
      available: true,
      resolvedCommand: fakeCodexPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveProviderCommand verifies hinted executables with their bin directory on PATH", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-provider-verify-path-"));
  const toolBinDir = path.join(tempDir, "tool-bin");
  const fakeClaudePath = path.join(toolBinDir, "claude");
  const helperPath = path.join(toolBinDir, "claude-runtime-helper");

  try {
    await mkdir(toolBinDir, { recursive: true });
    await writeFile(helperPath, "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(
      fakeClaudePath,
      [
        "#!/usr/bin/env bash",
        "claude-runtime-helper >/dev/null 2>&1 || exit 1",
        "if [ \"$1\" = \"--version\" ]; then",
        "  printf 'Claude Code 2.1.117\\n'",
        "fi",
      ].join("\n") + "\n",
      "utf8",
    );
    await chmod(helperPath, 0o755);
    await chmod(fakeClaudePath, 0o755);

    const result = await resolveProviderCommand(
      {
        id: "claude",
        label: "Claude Code",
        command: "claude",
        launchCommand: "claude",
        verifyArgs: ["--version"],
        pathHints: [fakeClaudePath],
      },
      { HOME: tempDir, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" },
    );

    assert.deepEqual(result, {
      available: true,
      resolvedCommand: fakeClaudePath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("detectProviders promotes a hinted executable into the launch command", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-provider-"));
  const fakeCodexPath = path.join(tempDir, "codex");

  try {
    await writeFile(fakeCodexPath, "#!/usr/bin/env bash\nexit 0\n");
    await chmod(fakeCodexPath, 0o755);

    const [provider] = await detectProviders(
      [
        {
          id: "codex",
          label: "Codex",
          command: "codex",
          launchCommand: "codex",
          defaultName: "Codex",
          pathHints: [fakeCodexPath],
        },
      ],
      { HOME: tempDir, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh" },
    );

    assert.equal(provider.available, true);
    assert.equal(provider.launchCommand, fakeCodexPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("provider definitions include one-command installer hints for onboarding", () => {
  const installers = Object.fromEntries(
    providerDefinitions
      .filter((provider) => provider.installCommand)
      .map((provider) => [provider.id, provider.installCommand]),
  );

  assert.match(installers.claude, /https:\/\/claude\.ai\/install\.sh/);
  assert.match(installers.claude, /@anthropic-ai\/claude-code/);
  assert.match(installers.claude, /timeout 600s/);
  assert.match(installers.claude, /claude --version/);
  assert.equal(installers.codex, "npm install -g @openai/codex");
});

test("default provider prefers Claude, then any installed coding agent, before shell", () => {
  assert.equal(getDefaultProviderId([
    { id: "shell", available: true },
    { id: "codex", available: true },
  ]), "codex");

  assert.equal(getDefaultProviderId([
    { id: "shell", available: true },
    { id: "codex", available: true },
    { id: "claude", available: true },
  ]), "claude");

  assert.equal(getDefaultProviderId([
    { id: "shell", available: true },
    { id: "codex", available: false },
  ]), "shell");
});

test("provider definitions include real auth entrypoints for onboarding", () => {
  const authCommands = Object.fromEntries(
    providerDefinitions
      .filter((provider) => provider.authCommand)
      .map((provider) => [provider.id, provider.authCommand]),
  );

  assert.equal(authCommands.claude, "claude auth login");
  assert.equal(authCommands.codex, "codex login --device-auth");
});

test("providerDefinitions only expose Claude Code, Codex, and the internal shell fallback", () => {
  assert.deepEqual(
    providerDefinitions.map((provider) => provider.id),
    ["claude", "codex", "shell"],
  );
});

test("Codex onboarding uses device auth so remote browsers avoid localhost callback failures", () => {
  const provider = providerDefinitions.find((entry) => entry.id === "codex");

  assert.ok(provider);
  assert.equal(provider.authCommand, "codex login --device-auth");
});

test("resolveProviderCommand prefers Claude native path hints over PATH shims", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-provider-native-"));
  const nativeBinDir = path.join(tempDir, ".local", "bin");
  const pathShimDir = path.join(tempDir, "path-bin");
  const nativeClaudePath = path.join(nativeBinDir, "claude");
  const pathShimClaudePath = path.join(pathShimDir, "claude");

  try {
    await mkdir(nativeBinDir, { recursive: true });
    await mkdir(pathShimDir, { recursive: true });
    await writeFile(nativeClaudePath, "#!/usr/bin/env bash\nprintf 'native claude\\n'\n", "utf8");
    await writeFile(pathShimClaudePath, "#!/usr/bin/env bash\nprintf 'path shim claude\\n'\n", "utf8");
    await chmod(nativeClaudePath, 0o755);
    await chmod(pathShimClaudePath, 0o755);

    const result = await resolveProviderCommand(
      {
        id: "claude",
        label: "Claude Code",
        command: "claude",
        launchCommand: "claude",
        verifyArgs: ["--version"],
        preferPathHints: true,
        pathHints: ["~/.local/bin/claude"],
      },
      {
        HOME: tempDir,
        PATH: `${pathShimDir}:/usr/bin:/bin`,
        SHELL: "/bin/zsh",
      },
    );

    assert.deepEqual(result, {
      available: true,
      resolvedCommand: nativeClaudePath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveProviderCommand falls back to a globally installed npm package bin", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-provider-npm-"));
  const fakeNpmRoot = path.join(tempDir, "npm-root");
  const packageDir = path.join(fakeNpmRoot, "@anthropic-ai", "claude-code");
  const fakeCliPath = path.join(packageDir, "cli.js");
  const fakePackageJsonPath = path.join(packageDir, "package.json");

  try {
    await mkdir(packageDir, { recursive: true });
    await writeFile(fakeCliPath, "#!/usr/bin/env node\nprocess.exit(0)\n");
    await chmod(fakeCliPath, 0o755);
    await writeFile(
      fakePackageJsonPath,
      JSON.stringify({
        name: "@anthropic-ai/claude-code",
        bin: {
          claude: "cli.js",
        },
      }),
    );

    const result = await resolveProviderCommand(
      {
        id: "claude",
        label: "Claude Code",
        command: "claude",
        launchCommand: "claude",
        npmPackage: {
          name: "@anthropic-ai/claude-code",
          bin: "claude",
        },
      },
      {
        HOME: tempDir,
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/zsh",
        VIBE_RESEARCH_NPM_ROOT: fakeNpmRoot,
      },
    );

    assert.deepEqual(result, {
      available: true,
      resolvedCommand: fakeCliPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("providerDefinitions includes Claude npm package fallback metadata", () => {
  const provider = providerDefinitions.find((entry) => entry.id === "claude");

  assert.ok(provider);
  assert.deepEqual(provider.verifyArgs, ["--version"]);
  assert.deepEqual(provider.npmPackage, {
    name: "@anthropic-ai/claude-code",
    bin: "claude",
  });
});

test("resolveProviderCommand rejects a discovered command that fails provider verification", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-provider-verify-"));
  const fakeBinDir = path.join(tempDir, "bin");
  const fakeClaudePath = path.join(fakeBinDir, "claude");

  try {
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeClaudePath, "#!/usr/bin/env bash\nexit 1\n");
    await chmod(fakeClaudePath, 0o755);

    const result = await resolveProviderCommand(
      {
        id: "claude",
        label: "Claude Code",
        command: "claude",
        launchCommand: "claude",
        verifyArgs: ["--version"],
      },
      {
        HOME: tempDir,
        PATH: `${fakeBinDir}:/usr/bin:/bin`,
        SHELL: "/bin/zsh",
      },
    );

    assert.deepEqual(result, {
      available: false,
      resolvedCommand: null,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("providerDefinitions includes Claude path hints for common installs", () => {
  const provider = providerDefinitions.find((entry) => entry.id === "claude");

  assert.ok(provider);
  assert.deepEqual(provider.pathHints, [
    "~/.local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]);
  assert.equal(provider.preferPathHints, true);
});
