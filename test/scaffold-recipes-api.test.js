import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createVibeResearchApp } from "../src/create-app.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const shellProvider = {
  id: "shell",
  label: "Vanilla Shell",
  command: null,
  launchCommand: null,
  defaultName: "Shell",
  available: true,
};

async function createTempWorkspace(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function removeTempWorkspace(workspacePath) {
  await rm(workspacePath, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 50,
  });
}

function createGitHubFetchImpl(profile = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://github.com/login/oauth/access_token") {
      return new Response(JSON.stringify({
        access_token: "github-access-token-test",
        scope: "read:user",
        token_type: "bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (String(url) === "https://api.github.com/user") {
      return new Response(JSON.stringify({
        id: 5,
        login: "meta-builder",
        name: "Meta Builder",
        html_url: "https://github.com/meta-builder",
        avatar_url: "https://avatars.githubusercontent.com/u/5?v=4",
        ...profile,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ message: `Unexpected GitHub fetch URL: ${url}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };

  fetchImpl.calls = calls;
  return fetchImpl;
}

async function connectBuildingHubGitHub(baseUrl, clientId = "test-github-client-id") {
  const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      githubOAuthClientId: clientId,
      githubOAuthClientSecret: "test-github-client-secret",
    }),
  });
  assert.equal(settingsResponse.status, 200);

  const oauthStartResponse = await fetch(`${baseUrl}/buildinghub/auth/github/start`, { redirect: "manual" });
  assert.equal(oauthStartResponse.status, 302);
  const location = oauthStartResponse.headers.get("location") || "";
  const githubUrl = new URL(location);
  const stateToken = githubUrl.searchParams.get("state");
  assert.ok(stateToken);

  const callbackResponse = await fetch(
    `${baseUrl}/buildinghub/auth/github/callback?state=${encodeURIComponent(stateToken)}&code=test-auth-code`,
  );
  assert.equal(callbackResponse.status, 200);
}

async function startFakeHostedBuildingHub() {
  const grants = new Map();
  const publications = [];
  const recipes = new Map();
  let nextGrantId = 1;
  let baseUrl = "";
  const account = {
    provider: "buildinghub",
    id: "bhusr_recipe_1",
    login: "recipe-builder",
    name: "Recipe Builder",
  };

  async function readRequestJson(request) {
    return JSON.parse(await new Promise((resolve, reject) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => resolve(raw || "{}"));
      request.on("error", reject);
    }));
  }

  const server = (await import("node:http")).createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const hostedAccount = {
      ...account,
      profileUrl: `${baseUrl}/u/${account.login}`,
    };

    if (request.method === "GET" && url.pathname === "/auth/github/start") {
      const returnTo = String(url.searchParams.get("return_to") || "").trim();
      const grant = `bhg_recipe_${nextGrantId++}`;
      grants.set(grant, returnTo);
      const redirectUrl = new URL(returnTo);
      redirectUrl.searchParams.set("buildinghub_grant", grant);
      response.statusCode = 302;
      response.setHeader("Location", redirectUrl.toString());
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/exchange") {
      const body = await readRequestJson(request);
      if (!body.grant || grants.get(body.grant) !== body.redirectUri) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "Invalid BuildingHub grant." }));
        return;
      }
      grants.delete(body.grant);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        ok: true,
        accessToken: "bhp_recipe_token",
        account: hostedAccount,
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/recipes") {
      if (String(request.headers.authorization || "").trim() !== "Bearer bhp_recipe_token") {
        response.statusCode = 401;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const body = await readRequestJson(request);
      const recipe = {
        ...(body.recipe || {}),
        source: {
          ...((body.recipe && body.recipe.source) || {}),
          recipeUrl: `${baseUrl}/recipes/${body.recipe?.id || "recipe"}/`,
          publisher: hostedAccount,
        },
      };
      recipes.set(recipe.id, recipe);
      publications.push({
        kind: "recipe",
        id: recipe.id,
        name: recipe.name,
        url: recipe.source.recipeUrl,
      });
      response.statusCode = 201;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        ok: true,
        recipeId: recipe.id,
        recipeUrl: recipe.source.recipeUrl,
        repositoryUrl: recipe.source.repositoryUrl || "",
        publisher: hostedAccount,
        publishedVia: "api",
        recordedByBuildingHub: true,
        sourceId: "hosted",
        status: "published",
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/registry.json") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ recipes: [...recipes.values()] }));
      return;
    }

    response.statusCode = 404;
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    account: {
      ...account,
      profileUrl: `${baseUrl}/u/${account.login}`,
    },
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    publications,
    recipes,
  };
}

async function connectHostedBuildingHubAccount(baseUrl, hostedBuildingHubBaseUrl) {
  const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      buildingHubAppUrl: hostedBuildingHubBaseUrl,
      buildingHubCatalogUrl: `${hostedBuildingHubBaseUrl}/registry.json`,
    }),
  });
  assert.equal(settingsResponse.status, 200);

  const oauthStartResponse = await fetch(`${baseUrl}/buildinghub/auth/github/start`, { redirect: "manual" });
  assert.equal(oauthStartResponse.status, 302);
  const hostedStartUrl = new URL(oauthStartResponse.headers.get("location") || "");
  const hostedCallbackResponse = await fetch(hostedStartUrl.toString(), { redirect: "manual" });
  assert.equal(hostedCallbackResponse.status, 302);
  const completionResponse = await fetch(hostedCallbackResponse.headers.get("location") || "");
  assert.equal(completionResponse.status, 200);
}

async function createBuildingHubRepoFixture(prefix = "vr-scaffold-buildinghub-") {
  const repoDir = await createTempWorkspace(prefix);
  const remoteDir = `${repoDir}-remote.git`;
  await mkdir(path.join(repoDir, "bin"), { recursive: true });
  await mkdir(path.join(repoDir, "layouts"), { recursive: true });
  await mkdir(path.join(repoDir, "site"), { recursive: true });
  await writeFile(
    path.join(repoDir, "bin", "buildinghub.mjs"),
    "#!/usr/bin/env node\nprocess.stdout.write('buildinghub fixture\\n');\n",
    "utf8",
  );
  await writeFile(path.join(repoDir, "README.md"), "# BuildingHub Fixture\n", "utf8");
  await writeFile(path.join(repoDir, "site", "index.html"), "<!doctype html><title>BuildingHub</title>\n", "utf8");
  await execFileAsync("git", ["-C", repoDir, "init", "-b", "main"]);
  await execFileAsync("git", ["-C", repoDir, "config", "user.name", "Vibe Research Test"]);
  await execFileAsync("git", ["-C", repoDir, "config", "user.email", "vibe-research@example.test"]);
  await execFileAsync("git", ["-C", repoDir, "add", "."]);
  await execFileAsync("git", ["-C", repoDir, "commit", "-m", "seed buildinghub fixture"]);
  await execFileAsync("git", ["clone", "--bare", repoDir, remoteDir]);
  await execFileAsync("git", ["-C", repoDir, "remote", "add", "origin", remoteDir]);
  await execFileAsync("git", ["-C", repoDir, "push", "-u", "origin", "main"]);

  return {
    publicBaseUrl: "https://buildinghub.example.test/catalog/",
    registryUrl: "https://buildinghub.example.test/catalog/registry.json",
    remoteDir,
    repoDir,
  };
}

async function startApp(options = {}) {
  const cwd = options.cwd || process.cwd();
  const stateDir = options.stateDir || path.join(cwd, ".vibe-research");
  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd,
    stateDir,
    persistSessions: false,
    persistentTerminals: false,
    providers: [shellProvider],
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({
        enabled: settings.preventSleepEnabled,
        platform: "test",
      }),
    ...options,
  });

  return {
    app,
    baseUrl: `http://127.0.0.1:${app.config.port}`,
  };
}

function cliEnv(baseUrl, extra = {}) {
  return {
    ...process.env,
    ...extra,
    VIBE_RESEARCH_SCAFFOLD_RECIPES_API: `${baseUrl}/api/scaffold-recipes`,
  };
}

async function runRecipeCli(baseUrl, args, options = {}) {
  const { stdout } = await execFileAsync(path.join(rootDir, "bin", "vr-scaffold-recipe"), args, {
    cwd: options.cwd || rootDir,
    env: cliEnv(baseUrl, options.env),
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

test("scaffold recipe API exports, saves, previews, applies, publishes, and supports the agent CLI", async () => {
  const workspaceDir = await createTempWorkspace("vr-scaffold-api-workspace");
  const stateDir = await createTempWorkspace("vr-scaffold-api-state");
  const applyWorkspaceDir = await createTempWorkspace("vr-scaffold-api-apply");
  const buildingHub = await createBuildingHubRepoFixture();
  const githubFetchImpl = createGitHubFetchImpl({
    id: 41,
    login: "meta-builder",
    name: "Meta Builder",
    html_url: "https://github.com/meta-builder",
  });
  const { app, baseUrl } = await startApp({ cwd: workspaceDir, stateDir, githubFetchImpl });

  try {
    const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentCommunicationDmBody: "freeform",
        agentCommunicationDmEnabled: true,
        agentCommunicationDmVisibility: "workspace",
        agentCommunicationGroupInboxes: "resource-hall,gpu-desk",
        agentCommunicationMaxThreadDepth: 8,
        agentCommunicationMaxUnrepliedPerAgent: 1,
        agentCommunicationRequireRelatedObject: true,
        agentOpenAiApiKey: "sk-test-secret",
        buildingHubCatalogPath: buildingHub.repoDir,
        buildingHubCatalogUrl: buildingHub.registryUrl,
        buildingHubEnabled: true,
        browserUseEnabled: true,
        workspaceRootPath: workspaceDir,
      }),
    });
    assert.equal(settingsResponse.status, 200);
    await connectBuildingHubGitHub(baseUrl);

    const layoutResponse = await fetch(`${baseUrl}/api/agent-town/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: {
          decorations: [{ id: "road-1", itemId: "road-square", x: 240, y: 280 }],
          functional: { "scaffold-recipes": { x: 336, y: 224 } },
          themeId: "green-field",
          dogName: "Scout",
        },
      }),
    });
    assert.equal(layoutResponse.status, 200);

    const currentResponse = await fetch(`${baseUrl}/api/scaffold-recipes/current?name=Meta%20Bench&tags=benchmark,harbor`);
    assert.equal(currentResponse.status, 200);
    const currentPayload = await currentResponse.json();
    assert.equal(currentPayload.recipe.id, "meta-bench");
    assert.equal(currentPayload.recipe.communication.dm.enabled, true);
    assert.deepEqual(currentPayload.recipe.communication.groupInboxes, ["resource-hall", "gpu-desk"]);
    assert.equal(currentPayload.recipe.layout.decorations.length, 1);
    assert.ok(currentPayload.recipe.buildings.some((building) => building.id === "scaffold-recipes"));
    assert.equal(currentPayload.recipe.settings.portable.agentOpenAiApiKey, undefined);
    assert.ok(currentPayload.recipe.localBindingsRequired.some((entry) => entry.key === "agentOpenAiApiKey"));
    assert.doesNotMatch(JSON.stringify(currentPayload.recipe), /sk-test-secret/);

    const cliExport = JSON.parse(await runRecipeCli(baseUrl, ["export", "--name", "Meta Bench", "--pretty"]));
    assert.equal(cliExport.id, "meta-bench");
    assert.equal(cliExport.communication.dm.maxThreadDepth, 8);

    const saveResponse = await fetch(`${baseUrl}/api/scaffold-recipes/current`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "meta-bench",
        name: "Meta Bench",
        description: "Benchmarking the normal Vibe Research setup.",
        tags: ["benchmark", "harbor"],
      }),
    });
    assert.equal(saveResponse.status, 201);
    const savedPayload = await saveResponse.json();
    assert.equal(savedPayload.recipe.id, "meta-bench");

    const cliList = JSON.parse(await runRecipeCli(baseUrl, ["list"]));
    assert.equal(cliList.recipes[0].id, "meta-bench");

    const variantRecipe = {
      ...savedPayload.recipe,
      id: "quiet-bench",
      name: "Quiet Bench",
      communication: {
        ...savedPayload.recipe.communication,
        dm: {
          ...savedPayload.recipe.communication.dm,
          enabled: false,
          maxThreadDepth: 3,
        },
        groupInboxes: ["reviews"],
      },
      layout: {
        decorations: [{ id: "planter-1", itemId: "planter", x: 150, y: 160 }],
        functional: { buildinghub: { x: 300, y: 320 } },
        themeId: "snowy",
        dogName: "Patch",
      },
      settings: {
        ...savedPayload.recipe.settings,
        portable: {
          ...savedPayload.recipe.settings.portable,
          browserUseEnabled: false,
        },
      },
    };

    const previewResponse = await fetch(`${baseUrl}/api/scaffold-recipes/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe: variantRecipe,
        localBindings: {
          agentOpenAiApiKey: "sk-next",
          workspaceRootPath: applyWorkspaceDir,
        },
      }),
    });
    assert.equal(previewResponse.status, 200);
    const previewPayload = await previewResponse.json();
    assert.equal(previewPayload.preview.ok, true);
    assert.equal(previewPayload.preview.changes.layout.themeId, "snowy");
    assert.equal(previewPayload.preview.localBindingsRequired.find((entry) => entry.key === "agentOpenAiApiKey").provided, true);

    const recipeFilePath = path.join(workspaceDir, "quiet-bench.json");
    await writeFile(recipeFilePath, `${JSON.stringify(variantRecipe, null, 2)}\n`, "utf8");
    const cliPreview = JSON.parse(await runRecipeCli(baseUrl, [
      "preview",
      recipeFilePath,
      "--binding",
      `workspaceRootPath=${applyWorkspaceDir}`,
    ]));
    assert.equal(cliPreview.preview.recipe.id, "quiet-bench");
    assert.equal(cliPreview.preview.ok, true);

    const cliApply = JSON.parse(await runRecipeCli(baseUrl, [
      "apply",
      recipeFilePath,
      "--binding",
      `workspaceRootPath=${applyWorkspaceDir}`,
      "--binding",
      "agentOpenAiApiKey=sk-next",
    ]));
    assert.equal(cliApply.settings.agentCommunicationDmEnabled, false);
    assert.equal(cliApply.settings.agentCommunicationMaxThreadDepth, 3);
    assert.equal(cliApply.settings.agentCommunicationGroupInboxes, "reviews");
    assert.equal(cliApply.settings.agentOpenAiApiKeyConfigured, true);
    assert.equal(cliApply.settings.browserUseEnabled, false);
    assert.equal(cliApply.agentTown.layout.themeId, "snowy");
    assert.equal(cliApply.agentTown.layout.decorations[0].itemId, "planter");

    const publishResponse = await fetch(`${baseUrl}/api/scaffold-recipes/meta-bench/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Meta Bench",
        description: "A shareable benchmark scaffold.",
      }),
    });
    assert.equal(publishResponse.status, 201);
    const publishPayload = await publishResponse.json();
    assert.equal(publishPayload.buildingHub.recipeId, "meta-bench");
    assert.equal(publishPayload.buildingHub.recipeUrl, `${buildingHub.publicBaseUrl}recipes/meta-bench/`);
    assert.equal(publishPayload.buildingHub.pushed, true);
    assert.equal(publishPayload.buildingHub.publisher.login, "meta-builder");
    assert.equal(publishPayload.buildingHubStatus.recipeCount, 1);

    const recipeManifest = JSON.parse(await readFile(path.join(buildingHub.repoDir, "recipes", "meta-bench", "recipe.json"), "utf8"));
    assert.equal(recipeManifest.id, "meta-bench");
    assert.equal(recipeManifest.source.recipeUrl, `${buildingHub.publicBaseUrl}recipes/meta-bench/`);
    assert.equal(recipeManifest.source.publisher.login, "meta-builder");
    assert.equal(recipeManifest.source.publisher.profileUrl, "https://github.com/meta-builder");
    assert.equal(recipeManifest.settings.portable.agentOpenAiApiKey, undefined);
    assert.doesNotMatch(JSON.stringify(recipeManifest), /sk-test-secret|sk-next/);

    const readme = await readFile(path.join(buildingHub.repoDir, "recipes", "meta-bench", "README.md"), "utf8");
    assert.match(readme, /# Meta Bench/);
    assert.match(readme, /DM policy:/);
    assert.match(readme, /meta-builder/);

    const staticPage = await readFile(path.join(buildingHub.repoDir, "site", "recipes", "meta-bench", "index.html"), "utf8");
    assert.match(staticPage, /Meta Bench - BuildingHub/);
    assert.match(staticPage, /local bindings to supply/);
    assert.match(staticPage, /Published by/);
    assert.match(staticPage, /meta-builder/);

    const remoteHead = await execFileAsync("git", ["--git-dir", buildingHub.remoteDir, "log", "--oneline", "-1", "main"]);
    assert.match(remoteHead.stdout, /Publish Vibe Research scaffold recipe meta-bench/);

    const catalogResponse = await fetch(`${baseUrl}/api/buildinghub/catalog?force=1`);
    assert.equal(catalogResponse.status, 200);
    const catalogPayload = await catalogResponse.json();
    assert.equal(catalogPayload.recipes[0].id, "meta-bench");
  } finally {
    await app.close();
    await removeTempWorkspace(workspaceDir);
    await removeTempWorkspace(stateDir);
    await removeTempWorkspace(applyWorkspaceDir);
    await removeTempWorkspace(buildingHub.repoDir);
    await removeTempWorkspace(buildingHub.remoteDir);
  }
});

test("scaffold recipe publish uses hosted BuildingHub API when a hosted account is connected", async () => {
  const workspaceDir = await createTempWorkspace("vr-scaffold-hosted-api-workspace");
  const stateDir = await createTempWorkspace("vr-scaffold-hosted-api-state");
  const hostedBuildingHub = await startFakeHostedBuildingHub();
  const { app, baseUrl } = await startApp({ cwd: workspaceDir, stateDir });

  try {
    const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buildingHubCatalogUrl: `${hostedBuildingHub.baseUrl}/registry.json`,
        buildingHubEnabled: true,
        workspaceRootPath: workspaceDir,
      }),
    });
    assert.equal(settingsResponse.status, 200);
    await connectHostedBuildingHubAccount(baseUrl, hostedBuildingHub.baseUrl);

    const saveResponse = await fetch(`${baseUrl}/api/scaffold-recipes/current`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "hosted-meta-bench",
        name: "Hosted Meta Bench",
        description: "A hosted BuildingHub recipe publish.",
        tags: ["benchmark"],
      }),
    });
    assert.equal(saveResponse.status, 201);

    const publishResponse = await fetch(`${baseUrl}/api/scaffold-recipes/hosted-meta-bench/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Hosted Meta Bench",
        description: "Published through hosted BuildingHub.",
      }),
    });
    assert.equal(publishResponse.status, 201);
    const publishPayload = await publishResponse.json();
    assert.equal(publishPayload.buildingHub.publishedVia, "api");
    assert.equal(publishPayload.buildingHub.recipeUrl, `${hostedBuildingHub.baseUrl}/recipes/hosted-meta-bench/`);
    assert.equal(publishPayload.buildingHub.publisher.login, hostedBuildingHub.account.login);
    assert.equal(publishPayload.buildingHubStatus.recipeCount, 1);

    const hostedRecipe = hostedBuildingHub.recipes.get("hosted-meta-bench");
    assert.ok(hostedRecipe);
    assert.equal(hostedRecipe.source.publisher.login, hostedBuildingHub.account.login);
    assert.equal(hostedRecipe.source.recipeUrl, `${hostedBuildingHub.baseUrl}/recipes/hosted-meta-bench/`);
    assert.equal(hostedBuildingHub.publications.length, 1);
    assert.equal(hostedBuildingHub.publications[0].kind, "recipe");
  } finally {
    await app.close();
    await hostedBuildingHub.close();
    await removeTempWorkspace(workspaceDir);
    await removeTempWorkspace(stateDir);
  }
});
