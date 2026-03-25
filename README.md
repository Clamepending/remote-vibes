# Remote Vibes

Remote Vibes is a small browser terminal hub for your laptop. Start it with one command, open it from your phone over Tailscale, create shell windows, and jump into local web previews through a built-in port proxy.

## Quick start

```bash
./start.sh
```

On first run that installs dependencies, builds the client bundle, and starts the server.

At startup the app prints:

- `localhost` and LAN/Tailscale URLs
- installed CLI providers
- the proxy pattern for local web ports

## Features

- PTY-backed terminal windows in the browser
- provider presets for `claude`, `codex`, `gemini`, and a plain shell
- per-session working directories
- clickable detected ports that open through `/proxy/<port>/`
- mobile-friendly quick-send bar for dictation or one-line commands

## Session presets

- `Claude Code`: opens a shell and runs `claude`
- `Codex`: opens a shell and runs `codex`
- `Gemini CLI`: opens a shell and runs `gemini` if installed
- `Vanilla Shell`: opens a plain shell session on the host

If a CLI is missing, the preset is disabled in the UI.

## Config

Optional environment variables:

- `REMOTE_VIBES_HOST` defaults to `0.0.0.0`
- `REMOTE_VIBES_PORT` defaults to `4123`

Example:

```bash
REMOTE_VIBES_PORT=4200 ./start.sh
```

## Notes

- Sessions run locally on the host laptop. This is not an outbound SSH multiplexer yet.
- The built-in port list is backed by `lsof` and the proxy targets `127.0.0.1:<port>`.
- Some agent CLIs may still show their own trust or permissions prompts the first time they launch in a directory.
- On macOS, `node-pty` needs its `spawn-helper` marked executable. The repo fixes that automatically during `npm install`.

## Tests

```bash
npm test
```
