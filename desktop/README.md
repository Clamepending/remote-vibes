# Vibe Research Desktop

This package builds a thin desktop launcher and first-run installer for Vibe Research.

The desktop app does not run the server inside Electron. Release builds bundle a Vibe Research source template, copy it into `~/.vibe-research/app`, ensure a local Node.js runtime exists, start the normal local server, then load `http://127.0.0.1:4123/` in an Electron window. That keeps the terminal and native dependency path the same as the shell installer while avoiding a first-run Git dependency for nontechnical macOS users.

## Development

```bash
npm run desktop:install
npm run desktop:dev
```

Development launches from the source checkout. Set `VIBE_RESEARCH_DESKTOP_USE_SOURCE=0` to exercise the installed-app path.

## Packaging

```bash
npm run desktop:pack
npm run desktop:dist
```

macOS artifacts are written to `desktop/dist/`. Local builds use ad-hoc signing unless a Developer ID certificate is available. Public release tags require these GitHub secrets so the build is signed, notarized, and usable without Gatekeeper warnings:

- `MACOS_CSC_LINK` — base64-encoded Developer ID Application certificate export (`.p12`).
- `MACOS_CSC_KEY_PASSWORD` — password for that certificate export.
- `APPLE_ID` — Apple Developer account email.
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for notarization.
- `APPLE_TEAM_ID` — Apple Developer team id.

Tag builds publish the DMG, ZIP, blockmaps, and `latest-mac.yml` through `electron-builder` so `electron-updater` can update installed desktop apps from GitHub Releases.
