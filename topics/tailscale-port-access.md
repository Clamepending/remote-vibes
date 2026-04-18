# Tailscale Port Access

updated_at: 2026-04-17T08:28:23Z
scope: Remote Vibes sidebar port access
confidence: high

Remote Vibes now treats `/proxy/<port>/` as the fallback instead of the first choice.

- For services listening on all interfaces, the sidebar prefers `http://<tailscale-ip>:<port>/`.
- For localhost-only services, the sidebar can call `POST /api/ports/:port/tailscale`, which runs Tailscale Serve as a background TCP forwarder for that port.
- The Tailscale Serve command path is `tailscale serve --bg --yes --tcp=<port> tcp://localhost:<port>`, with a fallback that retries without `--yes` for older CLIs.
- The port payload reports `preferredAccess` as `direct`, `tailscale-serve`, or `proxy`, plus `preferredUrl`, `directUrl`, `tailscaleUrl`, and eligibility flags.
- Focused tests cover direct URL preference, localhost-only expose behavior, status parsing, CLI command generation, and old-CLI fallback.

Sources:
- commit `dc75124` (`Add Tailscale port access`)
- `src/create-app.js`
- `src/tailscale-serve.js`
- `test/remote-vibes.test.js`
- `test/tailscale-serve.test.js`
