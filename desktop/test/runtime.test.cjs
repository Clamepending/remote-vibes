const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  compareSemver,
  copyTemplateApp,
  looksLikeVibeResearchApp,
  manifestFileName,
  readDesktopManifest,
  shouldSyncTemplate,
} = require("../src/runtime.cjs");

function writeFile(filePath, contents, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode });
}

function makeTemplate(root, version) {
  writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  writeFile(path.join(root, "start.sh"), "#!/usr/bin/env bash\n", 0o755);
  writeFile(path.join(root, "src/server.js"), "console.log('ok');\n");
}

test("copyTemplateApp installs and upgrades a managed app template without touching runtime files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vr-desktop-template-"));
  const template = path.join(tmp, "template");
  const appDir = path.join(tmp, "app");

  makeTemplate(template, "1.0.0");
  writeFile(path.join(appDir, "node_modules/preserved.txt"), "keep me\n");

  const first = copyTemplateApp({ templateDir: template, appDir });
  assert.equal(first.templateVersion, "1.0.0");
  assert.equal(looksLikeVibeResearchApp(appDir), true);
  assert.equal(fs.readFileSync(path.join(appDir, "node_modules/preserved.txt"), "utf8"), "keep me\n");
  assert.equal(readDesktopManifest(appDir).templateVersion, "1.0.0");
  assert.equal(shouldSyncTemplate({ templateDir: template, appDir }), false);

  fs.rmSync(path.join(template, "src/server.js"));
  writeFile(path.join(template, "src/server.js"), "console.log('new');\n");
  writeFile(path.join(template, "package.json"), JSON.stringify({ version: "1.0.1" }));

  assert.equal(shouldSyncTemplate({ templateDir: template, appDir }), true);
  copyTemplateApp({ templateDir: template, appDir });
  assert.equal(readDesktopManifest(appDir).templateVersion, "1.0.1");
  assert.match(fs.readFileSync(path.join(appDir, "src/server.js"), "utf8"), /new/);
});

test("copyTemplateApp removes files previously owned by the template", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vr-desktop-template-remove-"));
  const template = path.join(tmp, "template");
  const appDir = path.join(tmp, "app");

  makeTemplate(template, "1.0.0");
  writeFile(path.join(template, "docs/old.md"), "old\n");
  copyTemplateApp({ templateDir: template, appDir });
  assert.equal(fs.existsSync(path.join(appDir, "docs/old.md")), true);

  fs.rmSync(path.join(template, "docs/old.md"));
  writeFile(path.join(template, "package.json"), JSON.stringify({ version: "1.0.1" }));
  copyTemplateApp({ templateDir: template, appDir });

  assert.equal(fs.existsSync(path.join(appDir, "docs/old.md")), false);
  assert.equal(fs.existsSync(path.join(appDir, manifestFileName)), true);
});

test("compareSemver compares stable version triplets numerically", () => {
  assert.equal(compareSemver("1.10.0", "1.2.0") > 0, true);
  assert.equal(compareSemver("v2.0.0", "2.0.0"), 0);
  assert.equal(compareSemver("0.9.9", "1.0.0") < 0, true);
});
