#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const assetsDir = path.join(desktopDir, "assets");
const iconsetDir = path.join(assetsDir, "icon.iconset");
const sourceIcon = path.join(assetsDir, "source-icon.png");
const sizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

if (!existsSync(sourceIcon)) {
  throw new Error(`[vibe-research-desktop] missing source icon at ${sourceIcon}`);
}

if (process.platform !== "darwin") {
  throw new Error("[vibe-research-desktop] icon generation requires macOS (uses sips + iconutil)");
}

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

function resizeTo(size, outputPath) {
  execFileSync(
    "sips",
    ["-z", String(size), String(size), sourceIcon, "--out", outputPath],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

for (const [fileName, size] of sizes) {
  resizeTo(size, path.join(iconsetDir, fileName));
}

const iconPngPath = path.join(assetsDir, "icon.png");
resizeTo(1024, iconPngPath);

execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(assetsDir, "icon.icns")], {
  stdio: "inherit",
});

const iconBytes = readFileSync(iconPngPath);
console.log(`[vibe-research-desktop] wrote icons from ${path.basename(sourceIcon)} ${createHash("sha256").update(iconBytes).digest("hex").slice(0, 12)}`);
