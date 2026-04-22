const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const manifestFileName = ".vibe-research-desktop-template.json";

function expandHome(input) {
  if (!input) {
    return input;
  }
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function looksLikeVibeResearchApp(appDir) {
  return Boolean(
    appDir &&
      fs.existsSync(path.join(appDir, "start.sh")) &&
      fs.existsSync(path.join(appDir, "src", "server.js")) &&
      fs.existsSync(path.join(appDir, "package.json")),
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readPackageVersion(appDir) {
  const packageJson = readJson(path.join(appDir, "package.json"));
  return typeof packageJson?.version === "string" ? packageJson.version : "";
}

function parseSemver(version) {
  const match = String(version || "").match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }
  return match.slice(1).map((part) => Number(part));
}

function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    return String(left || "").localeCompare(String(right || ""));
  }

  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) {
      return parsedLeft[index] - parsedRight[index];
    }
  }
  return 0;
}

function readDesktopManifest(appDir) {
  const manifest = readJson(path.join(appDir, manifestFileName));
  if (!manifest || manifest.schemaVersion !== 1) {
    return null;
  }
  return manifest;
}

function listTemplateFiles(templateDir) {
  const files = [];

  function visit(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(templateDir, absolutePath);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relativePath);
      }
    }
  }

  visit(templateDir);
  return files.sort();
}

function removeEmptyParents(startDir, stopDir) {
  let current = startDir;
  while (current && current !== stopDir && current.startsWith(stopDir)) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function copyTemplateApp({ templateDir, appDir, logger = () => {} }) {
  const templateVersion = readPackageVersion(templateDir);
  const files = listTemplateFiles(templateDir);
  const nextFiles = new Set(files);
  const previousManifest = readDesktopManifest(appDir);
  const previousFiles = Array.isArray(previousManifest?.files) ? previousManifest.files : [];

  fs.mkdirSync(appDir, { recursive: true });

  for (const relativePath of previousFiles) {
    if (nextFiles.has(relativePath)) {
      continue;
    }

    const targetPath = path.join(appDir, relativePath);
    try {
      fs.rmSync(targetPath, { force: true });
      removeEmptyParents(path.dirname(targetPath), appDir);
    } catch {
      logger(`Could not remove old bundled file ${relativePath}; leaving it in place.`);
    }
  }

  for (const relativePath of files) {
    const sourcePath = path.join(templateDir, relativePath);
    const targetPath = path.join(appDir, relativePath);
    const stat = fs.statSync(sourcePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    fs.chmodSync(targetPath, stat.mode & 0o777);
  }

  fs.writeFileSync(
    path.join(appDir, manifestFileName),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        templateVersion,
        installedAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    )}\n`,
  );

  return { templateVersion, fileCount: files.length };
}

function shouldSyncTemplate({ templateDir, appDir, force = false }) {
  if (!templateDir || !fs.existsSync(templateDir)) {
    return false;
  }
  if (force) {
    return true;
  }

  const manifest = readDesktopManifest(appDir);
  if (!looksLikeVibeResearchApp(appDir)) {
    return true;
  }

  if (!manifest) {
    return false;
  }

  const templateVersion = readPackageVersion(templateDir);
  const installedVersion = manifest.templateVersion || readPackageVersion(appDir);
  return Boolean(templateVersion && compareSemver(templateVersion, installedVersion) > 0);
}

module.exports = {
  compareSemver,
  copyTemplateApp,
  expandHome,
  listTemplateFiles,
  looksLikeVibeResearchApp,
  manifestFileName,
  readDesktopManifest,
  readPackageVersion,
  shouldSyncTemplate,
};
