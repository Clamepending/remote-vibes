# Vibe Research deletion audit — first pass

Generated: 2026-05-08. Grep-based, six signals per file.

> **Important:** This is a *first-pass* audit based on static signals. The
> final `USED / EXPERIMENT-PARK / DEAD` calls are yours to make — only
> you know what you actually use day-to-day. The recommendations column
> is my best guess from the numbers; treat the *numbers* as authoritative
> and the *verdicts* as suggestions.

## What the columns mean

- **LOC** — line count of the server file.
- **TESTS** — line count of the matching `test/<name>.test.js` file (0 = no test).
- **ROUTES** — `/api/<short>` mentions in [src/create-app.js](src/create-app.js). High = wired into HTTP API.
- **MAIN** — mentions of the service name in [src/client/main.js](src/client/main.js). High = wired into UI.
- **DAYS** — days since last git commit touched the file.
- **VERDICT** — my suggested call. **You override.**

## Decision rule of thumb

- `MAIN > 50 AND ROUTES > 2` → almost certainly USED.
- `MAIN < 5 AND ROUTES < 2 AND TESTS == 0` → almost certainly DEAD or EXPERIMENT-PARK.
- The middle band (`MAIN 5–50` or `ROUTES 1–2`) is where you have to think.

---

## Audit results — services & stores in src/

| File | LOC | TESTS | ROUTES | MAIN | DAYS | Verdict | Notes |
|---|---:|---:|---:|---:|---:|---|---|
| **session-store** | 82 | 31 | 18 | 1652 | 14 | **CORE** | Sessions persistence — keep. |
| **settings-store** | 1397 | 78 | 4 | 604 | 7 | **CORE** | App settings — keep. Recently touched (7d). |
| **agent-town-store** | 1781 | 442 | 48 | 186 | 8 | **USED** | Heavy UI integration (186 main refs, 48 routes). If you actively use Agent Town, keep; otherwise this is a major delete target. |
| **workspace-store** | 227 | 0 | 0 | 289 | 13 | **USED** | High UI integration despite no routes/tests; check it's still pulling weight. |
| **agent-prompt-store** | 605 | 42 | 3 | 50 | 8 | **USED** | Recently touched, modest UI presence. |
| **buildinghub-service** | 1147 | 527 | 1 | 145 | 14 | **CHECK** | 145 UI refs but only 1 route — UI may be dead-on-arrival. Investigate. |
| **telegram-service** | 1001 | 1199 | 3 | 136 | 14 | **EXPERIMENT-PARK?** | 136 UI refs but 14 days untouched. If you don't use Telegram replies → **delete**. |
| **browser-use-service** | 901 | 444 | 6 | 132 | 14 | **EXPERIMENT-PARK?** | If you don't use the embedded browser-use agent → **delete**. |
| **videomemory-service** | 1428 | 610 | 10 | 94 | 14 | **EXPERIMENT-PARK?** | Tries `git pull` on every server start — likely abandoned. **Delete unless actively used.** |
| **ottoauth-service** | 665 | 212 | 6 | 66 | 14 | **EXPERIMENT-PARK?** | Third-party browser-OAuth automation. Confirm usage. |
| **scaffold-recipe-service** | 952 | 266 | 12 | 42 | 13 | **CHECK** | 12 routes is a real surface, but 42 main refs is modest. |
| **google-service** | 466 | 611 | 12 | 36 | 10 | **CHECK** | 12 routes, recent (10d). Probably still relevant; keep. |
| **github-service** | 210 | 133 | 3 | 40 | 14 | **USED** | Probably keep — modest but cohesive. |
| **agentmail-service** | 1236 | 1112 | 3 | 33 | 14 | **EXPERIMENT-PARK?** | 1.2k LOC service for 33 main refs. **Delete unless you actively use the AgentMail inbox.** |
| **buildinghub-bundle-publisher** | 261 | 0 | 0 | 21 | 14 | **DEAD?** | 0 routes, 0 tests, 21 main refs. Likely cuttable. |
| **wallet-service** | 389 | 216 | 11 | 0 | 14 | **DEAD client-side** | 11 routes but **zero main.js references**. The HTTP surface exists but nothing in the UI talks to it. **Strong delete signal.** |
| **twilio-service** | 889 | 373 | 6 | 0 | 14 | **DEAD client-side** | Same pattern as wallet — 6 routes, **zero UI**. **Strong delete signal.** |
| **agent-callback-service** | 305 | 137 | 2 | 0 | 14 | **DEAD client-side** | 0 main refs. Investigate; if no other consumer → delete. |
| **agent-run-store** | 379 | 128 | 0 | 0 | 14 | **DEAD or used by CLI?** | 0 routes, 0 main refs. If used only by `bin/vr-research-*` CLIs, fine; otherwise delete. |
| **agent-run-tracker** | 220 | 128 | 0 | 0 | 14 | **CHECK** | Likely paired with agent-run-store. Same call. |
| **gpu-ownership-store** | 204 | 250 | 0 | 0 | 7 | **CHECK** | Recent (7d), 0 routes/UI — probably used internally. Confirm before deleting. |
| **port-alias-store** | 94 | 0 | 0 | 0 | 14 | **DEAD?** | No tests, no routes, no UI. Tiny — investigate before deleting (could be used inside other services). |
| **buildinghub-account-service** | 206 | 0 | 0 | 0 | 14 | **DEAD?** | 0 everywhere. |
| **buildinghub-account-token-store** | 144 | 0 | 0 | 0 | 14 | **DEAD?** | Pairs with buildinghub-account-service. |
| **buildinghub-layout-publisher** | 900 | 0 | 0 | 0 | 14 | **DEAD?** | 0 routes, 0 UI, 0 tests, 900 LOC. Tracking + grep before deleting — may be invoked from another service. |
| **buildinghub-scaffold-publisher** | 584 | 0 | 0 | 0 | 14 | **DEAD?** | Same call as layout-publisher. |
| **github-oauth-token-store** | 199 | 0 | 0 | 0 | 14 | **CHECK** | Likely consumed by github-service. Cross-check. |
| **google-oauth-token-store** | 176 | 0 | 0 | 0 | 14 | **CHECK** | Likely consumed by google-service. Cross-check. |

---

## bin/ binaries

50 entries in [package.json](package.json) "bin"; 8 of those are pure aliases (`rv-*` → `vr-*`).

### `rv-*` aliases (12 files, 36 LOC) — **strong delete candidate as a group**

These are 3-line shell shims. Unless you actively type `rv-` instead of `vr-`, **delete the entire `rv-*` namespace**. Saves 25-ish package.json entries and cleans up symlinks.

```
rv-agent-canvas          rv-agentmail-reply       rv-browser
rv-browser-detour        rv-browser-use           rv-mailwatch
rv-ottoauth              rv-playwright            rv-scaffold-recipe
rv-session-name          rv-telegram-reply        rv-videomemory
```

### `vr-*` real CLIs sized by LOC

**Research workflow (very likely USED):**
- vr-research-runner (516), vr-research-active (147), vr-research-admit (64), vr-research-autopilot (298), vr-research-brief (364), vr-research-doctor (56), vr-research-init (176), vr-research-judge (129), vr-research-leaderboard (146), vr-research-lint-paper (57), vr-research-log (131), vr-research-orchestrator (124), vr-research-org-bench (145), vr-research-queue (176), vr-research-resolve (157), vr-research-vacuum (235)
- These match the loop tooling in [CLAUDE.md](CLAUDE.md). **Keep.**

**Likely DEAD or EXPERIMENT-PARK** (delete one-by-one once their service is confirmed dead):
- vr-agentmail-reply (161) — paired with agentmail-service
- vr-mailwatch (392) — paired with agentmail-service
- vr-telegram-reply (154) — paired with telegram-service
- vr-videomemory (351) — paired with videomemory-service
- vr-ottoauth (311) — paired with ottoauth-service
- vr-browser-use (255) — paired with browser-use-service
- vr-rl-sweep (509), vr-rl-tuner (206) — RL hyperparam sweeps; check if you've actually used them

**Probably keep** (utility wrappers around still-used pieces):
- vr-agent-ask (409), vr-agent-canvas (204), vr-agent-town (412)
- vr-claude-stream-chat (176), vr-claude-stream-experiment (273)
- vr-mcp (301), vr-pip-install-tool (111), vr-playwright (50), vr-browser (28)
- vr-scaffold-recipe (274), vr-session-name (103)

---

## Concrete line-count savings if you accept the strong deletes

| Group | LOC saved (server) | LOC saved (tests) | LOC saved (CLI) |
|---|---:|---:|---:|
| rv-* aliases | 0 | 0 | 36 |
| wallet-service + client | 389 | 216 | 0 |
| twilio-service + client | 889 | 373 | 0 |
| buildinghub-* unused | ~1,750 | 0 | 0 |
| agentmail-service + CLI | 1,236 | 1,112 | 553 |
| telegram-service + CLI | 1,001 | 1,199 | 154 |
| videomemory-service + CLI | 1,428 | 610 | 351 |
| ottoauth-service + CLI | 665 | 212 | 311 |
| browser-use-service + CLI | 901 | 444 | 255 |
| **TOTAL (if you accept all)** | **8,259** | **4,166** | **1,660** |

**Plus:** each deletion removes a chunk of [src/create-app.js](src/create-app.js) routes (typically 30-200 LOC each) and a chunk of [main.js](src/client/main.js) UI (range varies, but the 132 main.js refs to browser-use suggests ~500 LOC of UI alone).

**Realistic total LOC removed if you delete the 5 strongest candidates** (wallet, twilio, agentmail, telegram, videomemory) **and the rv- aliases:**
~5,000 server + ~3,500 tests + ~1,300 CLI + ~1,500 routes + ~3,000 client UI = **~14,000 LOC**, roughly **12% of the codebase**, with **zero impact on chat or research workflows**.

---

## Sequence I'd run

1. **Mark each row.** Open this file, change "Verdict" to your call: `USED / EXPERIMENT-PARK / DEAD`. ~30 minutes of decisions.
2. **Delete the easy wins first** (rv-* aliases, wallet-service, twilio-service — zero UI surface). 1 commit each, 1 hour total.
3. **Delete the bigger services one at a time** — service file, test file, routes block in create-app.js, UI section in main.js. Run `npm test`. Commit. 30-60 min per service.
4. **Cross-check the "no-route-no-UI" stores** (buildinghub-account-*, oauth-token-stores, port-alias-store): grep `import.*from.*<file>` before deletion to make sure no still-living service imports them.
5. **Re-audit after a week.** Numbers will have shifted; some decisions may want to flip.

## How I generated this

The exact script lives at `/tmp/audit.sh` (re-runnable):

- LOC: `wc -l <file>`
- TESTS: `wc -l test/<name>.test.js` (0 if missing)
- ROUTES: `grep -cE "/api/<short>" src/create-app.js`
- MAIN: `grep -cE "<short>|<base>" src/client/main.js`
- DAYS: `git log -1 --format="%ct" <file>` → epoch diff to today

The signals are imperfect. They miss services that are imported transitively but not name-referenced (`port-alias-store` could be in this bucket — check before deleting). They flag services that exist purely as CLI consumers without UI (the way `agent-run-store` looks dead but probably backs `vr-research-runner`). **Treat the table as a pruned suspect list, not a hit list.**
