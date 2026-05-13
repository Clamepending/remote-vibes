# Vibe Account Machine Dashboard

Date: 2026-05-12
Status: implementation in progress
Confidence: high that Swarmlab needs this; moderate on relay breadth until hosted account auth is wired into production.

## Goal

A user should be able to install Swarmlab on multiple machines with curl, then open the desktop app or `vibe-research.net` and switch between live dashboards for those machines.

Target examples:

- MacBook running local agents and browser tasks
- Raspberry Pi running camera/VideoMemory or small automation agents
- GPU workstation running training jobs
- cluster login node supervising remote jobs
- cloud VM running agents in isolated worktrees

The user-facing product should feel like one account-level control plane:

```text
Vibe account
  This Mac
    agents, browsers, apps, approvals, artifacts
  home-raspi
    camera monitors, agents, ports, system status
  gpu-box
    GPUs, training jobs, agents, TensorBoard, artifacts
```

The technical product should remain local-first: each machine owns its secrets, processes, terminals, browser profile, local apps, and raw logs. The account service coordinates identity, machine registry, presence, routing, and optional relay.

## Strongest Counterargument

The dangerous version of this is a cloud remote-control product that tunnels every terminal, browser, localhost app, and secret through a hosted account service. That would be expensive to secure, hard to debug, and at odds with Swarmlab's localhost-first strengths.

The right version is narrower:

- account stores machine registry and low-risk summaries
- direct private networking is preferred
- relay is optional and scoped
- raw credentials stay on the node
- destructive actions still require node-side authorization and audit
- web access is a client into the user's machines, not a replacement for the machines

Precondition: the current local daemon surface must be hardened before it is treated as a remotely accessible node. Account pairing must not make existing local endpoints remotely callable by default.

## System Components

### Swarmlab Node

Every curl install runs a local Node/Express daemon. This daemon is the authority for:

- sessions
- PTYs
- browser-use tasks
- local app ports
- system/GPU/camera status
- BuildingHub/building state
- action items and approvals
- artifacts
- local filesystem access
- local secrets

The node exposes a node API:

- manifest
- status
- snapshot
- events
- short-lived browser/dashboard tokens
- action endpoints

### Vibe Account Service

A hosted service at the Vibe account layer. It is the authority for:

- user identity
- node registry
- node pairing
- node presence
- account-level machine names and groups
- relay session negotiation
- access grants
- audit summaries
- optional redacted dashboard thumbnails

It is not the authority for:

- raw terminal transcripts by default
- API keys
- browser cookies
- local filesystem data
- payment cards
- private project files

### Desktop App

The desktop app is both:

- local node launcher for the current machine
- account/fleet client for all registered machines

It should prefer direct connections:

1. local `http://127.0.0.1:<port>`
2. LAN URL
3. Tailscale HTTPS URL
4. SSH tunnel URL
5. account relay

### Web App

The web app is an account client. It should show the same fleet dashboard as the desktop app, but with stricter defaults:

- no direct localhost assumptions
- no raw node token exposure
- remote actions require signed, scoped grants
- if direct Tailscale/LAN URL is unavailable from the browser, use relay only for allowed surfaces

## Connection Modes

| Mode | Description | Best for | Security posture |
| --- | --- | --- | --- |
| Local | Browser talks to `127.0.0.1` | current machine | simplest, private |
| LAN | Browser talks to `http://<host-ip>:<port>` | same network | needs node auth |
| Tailscale | Browser talks to tailnet URL | personal devices and servers | preferred remote path |
| SSH tunnel | Desktop creates local tunnel | cluster/login nodes | good for advanced users |
| Relay | Node opens outbound WS to account service | web from arbitrary device | optional, scoped, audited |

Direct private networking should be the default answer. Relay is a fallback, not the foundation.

Reachability and authorization are separate:

- Tailscale answers whether packets can reach the node.
- Vibe grants answer whether the actor may perform a scoped action.
- Node policy answers whether this machine will accept the action under its local rules.

All three must pass for remote control.

## Node Identity

Each install creates:

- `nodeId`: stable random id
- `installId`: existing or new install identity
- `nodeKeypair`: Ed25519 or P-256 signing key
- `localApiToken`: secret for local API calls
- `accountRefreshToken`: optional token after pairing

Suggested files:

```text
~/.swarmlab/node.json
~/.swarmlab/node-key.json
~/.swarmlab/account.json
```

Do not use hostname as identity. Hostnames change, collide, and leak details. Hostname is display metadata only.

## Pairing Flow

### From Desktop Or Local Web

1. User opens Swarmlab on a machine.
2. User clicks `Connect Vibe account`.
3. Node opens account OAuth/magic-link flow in system browser.
4. Account returns a one-time grant to local callback.
5. Node exchanges grant for account-scoped node token.
6. Node registers public key, machine metadata, and reachable URLs.
7. Account dashboard shows the machine.

This can reuse the current BuildingHub account-login pattern in `src/buildinghub-account-service.js` and `src/buildinghub-account-token-store.js`, but it should become first-class Vibe account code rather than BuildingHub-specific code.

### From Headless Curl Install

1. Installer prints:

```text
Open https://vibe-research.net/pair and enter code ABCD-EFGH
```

2. Node polls or maintains outbound pairing request.
3. User approves in account web.
4. Node receives account token and registers.
5. User can rename the machine from any account client.

This is required for Pi, SSH server, GPU box, and cluster setups.

## Heartbeats

Nodes should heartbeat to the account service every 15-60 seconds while online.

Heartbeat payload:

```ts
interface NodeHeartbeat {
  nodeId: string;
  schemaVersion: 1;
  swarmlabVersion: string;
  displayName: string;
  os: string;
  arch: string;
  hostnameHash: string;
  urls: {
    tailscale?: string;
    lan?: string;
    publicBase?: string;
    relay?: string;
  };
  status: "online" | "idle" | "busy";
  counts: {
    sessions: number;
    runningSessions: number;
    approvals: number;
    browserTasks: number;
    ports: number;
  };
  capabilities: {
    providers: string[];
    buildings: string[];
    gpuCount: number;
    cameraCount: number;
    hasTailscale: boolean;
    hasTmux: boolean;
  };
  generatedAt: string;
  signature: string;
}
```

Avoid sending:

- raw command text
- raw transcripts
- file paths by default
- env vars
- API keys
- browser URLs that may contain tokens

The account dashboard can request richer detail only when the user opens a machine and obtains a scoped grant.

## Account Data Model

```ts
interface AccountNode {
  id: string;
  ownerAccountId: string;
  displayName: string;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string;
  status: "online" | "stale" | "offline";
  connectionHints: ConnectionHint[];
  capabilities: MachineCapabilities;
  summary: MachineSummary;
}

interface ConnectionHint {
  kind: "tailscale" | "lan" | "public" | "relay" | "manual";
  url: string;
  lastVerifiedAt?: string;
  usableFromBrowser?: boolean;
  usableFromDesktop?: boolean;
}

interface AccountGrant {
  id: string;
  iss: "vibe-account";
  sub: string;
  aud: string;
  accountId: string;
  actorId: string;
  nodeId: string;
  scopes: string[];
  resources: Record<string, string[]>;
  methods?: string[];
  paths?: string[];
  iat: number;
  jti: string;
  payloadHash?: string;
  requireUserGesture?: boolean;
  expiresAt: string;
  createdAt: string;
}
```

This is the same grant contract the node verifies. The authoritative implementation should live in a shared schema, for example `schemas/node-grant.schema.json`, and both account service and node code should validate against it. `jti`, `iat`, `aud`, `nodeId`, `scopes`, `resources`, and expiry are mandatory. `methods`, `paths`, and `payloadHash` are mandatory for any relay-forwarded request. A scope without resource binding is invalid except global redacted summaries such as `node.summary.read`.

Scopes should be explicit:

- `node.summary.read`
- `node.snapshot.read.redacted`
- `approval.list`
- `approval.decide:{approvalId}`
- `artifact.thumbnail.read:{artifactId}`
- `artifact.read:{artifactId}`
- `session.summary.read:{sessionId}`

Implemented narrow command-queue scope:

- `session.input.write:{sessionId}` through a signed account command queue, node polling, node-side execution, and signed ack

Deferred scopes requiring separate threat review:

- `session.transcript.read:{sessionId}`
- `process.stop:{sessionId}`
- `port.list`
- `port.open:{port}`
- `port.expose.tailscale:{port}`
- `file.read:{pathPrefix}`
- `file.write:{pathPrefix}`
- `settings.write:{settingKey}`

Start with read-summary and approval scopes. Defer raw transcripts, file access, process control, port exposure, settings mutation, and app proxying until auth, audit, and route-level scope checks are mature.

## Web Access Architecture

The web dashboard should follow this connection order:

1. Load account machine registry.
2. For each node, show heartbeat summary immediately.
3. When user opens a node, ask account for a short-lived connection grant.
4. Try direct browser connection to Tailscale/LAN/public URL with grant.
5. If direct connection fails, offer relay mode.
6. If relay is disabled on the node, show stale summary and setup instructions.

The web app should not need the user's local node token. It should receive a short-lived grant signed by the account service and verified by the node.

Desktop/manual machine registry tokens follow the same rule. If the desktop app stores manually added machines, its `machines.json` may store a machine id, display name, base URL, connection kind, and `authTokenRef`, but the raw token belongs in macOS Keychain, Windows Credential Manager, libsecret, or an equivalent OS credential store.

## Relay Design

Relay is for connectivity, not authority.

Node opens an outbound WebSocket:

```text
node -> wss://vibe-research.net/relay/nodes/<nodeId>
```

The account service can multiplex short-lived client sessions over that socket.

Relay surfaces, in order of priority:

1. node status and events
2. approval decisions
3. snapshot reads
4. session summaries
5. artifact thumbnails
6. terminal stream viewing, post-v1 and separate threat review only
7. app/browser proxying, post-v1 and separate threat review only

Do not start with full arbitrary reverse proxying. It is the highest-risk piece. For v1, relay should be enough to show live status and approve blocked actions. Full remote dashboard/app embedding can come after auth, audit, and rate limits are proven.

Relay v1 must not support:

- arbitrary `/proxy/:port` equivalent
- terminal PTY streaming
- raw transcript fetch
- file browser
- settings mutation
- OAuth callback completion
- Tailscale Serve exposure
- browser profile/cookie access
- starting agents remotely

## Data Classification

| Data | Default location | Account sync? | Notes |
| --- | --- | --- | --- |
| Machine id/name | account + node | yes | user-visible registry |
| Presence heartbeat | account | yes | redacted summaries only |
| Active session count | account | yes | no raw prompts |
| Pending approval count | account | yes | detail only with grant |
| Approval title/detail | node | optional | sync only if user enables web approvals |
| Raw transcript | node | no by default | opt-in later |
| Browser cookies/profile | node | never | no cloud sync |
| API keys | node | never by default | explicit credential sync is separate product |
| File paths | node | no by default | can leak project names |
| Artifacts | node | thumbnail optional | full artifact with grant |
| Local app URLs | node/account hints | redacted | tokens stripped |
| GPU/system summary | account | yes | useful for machine choice |

## UI Shape

### Fleet Home

Top-level account view:

- machine rail
- all pending approvals
- all running agents
- redacted live app/port counts
- capabilities filter: GPU, camera, browser, provider, building
- stale/offline section

Fleet Home must not list raw app names, port names, browser URLs, repo names, project paths, or hostnames by default. Those details appear only after the user opens a machine and the node accepts a scoped grant. The first screen should be useful as a dispatch board, not a leak of every local service on every machine.

Machine card:

```text
home-raspi
online 18s ago
2 agents · 1 approval · 1 camera · no GPU
Tailscale available
[Open] [Approvals] [Ports]
```

The `[Ports]` action should open a redacted count/health view unless the client has a `port.list` or `port.open:{port}` grant. In v1, account web should prefer opening the node dashboard directly over proxying the app through the account origin.

### Machine Canvas

After selecting a machine, render the machine's own canvas board. This should use the same card model as the local canvas, but data comes through direct or relay connection.

Top bar:

- selected machine name
- connection mode
- latency
- online/stale
- node version
- switcher
- open direct URL

### Global Approval Queue

Account-level queue across machines:

```text
gpu-box / agent train-v2
Wants to launch Modal training job
Evidence: plan.md, estimated $3.20
[Approve once] [Deny] [Steer]
```

This is the most valuable cross-device feature. It lets the user unblock work from phone/web without remote-controlling the full desktop.

## Security Requirements

### Node-Side Verification

The node must verify:

- grant signature
- grant expiry
- node id
- requested scope
- action payload

The account service should not be trusted just because traffic came through the relay.

### Audit

Every remote action should append a node-local audit entry:

```ts
interface RemoteAuditEntry {
  id: string;
  accountId: string;
  nodeId: string;
  actorLabel: string;
  action: string;
  scopes: string[];
  target: string;
  decision?: "approved" | "denied";
  createdAt: string;
  clientIpHash?: string;
}
```

The account service can store a redacted copy.

### Capability Gating

Reuse the existing capability language from Agent Town/action items:

- `runs-shell`
- `reads-files`
- `writes-files`
- `uses-browser`
- `uses-camera`
- `uses-credentials`
- `spends-money`
- `publishes-code`
- `controls-devices`

Remote approvals should display capabilities prominently.

### Emergency Stop

Every machine card should expose local-safe recovery actions:

- disable relay
- disconnect account
- open local/desktop recovery instructions

Stopping selected agents or all running agents is a local desktop/direct-node feature until `process.stop:{sessionId}` has a separate threat review, one-use grant, and node-side audit path. Remote web should not ship a broad "stop everything on this machine" button in v1.

These should be node-side actions with audit entries.

## Relation To Existing BuildingHub Account Code

Current code has:

- `BuildingHubAccountTokenStore`
- `BuildingHubAccountService`
- GitHub OAuth integration for BuildingHub publishing
- hosted BuildingHub publication sync

This is a useful prototype, but the machine dashboard needs a broader account layer. Do not overload BuildingHub forever.

Recommended refactor:

```text
src/account/
  account-token-store.js
  account-service.js
  node-registration-service.js
  node-heartbeat-service.js
  relay-client.js

src/buildinghub-*.js
  consumes account identity when available
  remains focused on building/layout/recipe publication
```

Account identity should own machines. BuildingHub should own shared building/layout/recipe publication.

## API Sketch

### Node Local API

```http
GET /api/node/manifest
GET /api/node/status
GET /api/node/snapshot?mode=redacted
GET /api/node/snapshot?mode=privileged
POST /api/node/account/pair/start
POST /api/node/account/pair/complete
POST /api/node/account/disconnect
GET /api/node/account/status
POST /api/node/grants/verify
GET /api/node/events?since=123
WS /ws/node?grant=...
```

### Account API

```http
GET /api/account/me
GET /api/account/nodes
POST /api/account/nodes/pairing
POST /api/account/nodes/:nodeId/grants
POST /api/account/nodes/:nodeId/commands
GET /api/account/nodes/:nodeId/commands
GET /api/account/nodes/:nodeId/commands/:commandId
GET /api/account/nodes/:nodeId/commands/pending
POST /api/account/nodes/:nodeId/commands/:commandId/ack
GET /api/account/nodes/:nodeId/status
GET /api/account/nodes/:nodeId/relay
POST /api/account/nodes/:nodeId/rename
POST /api/account/nodes/:nodeId/disconnect
GET /api/account/approvals
POST /api/account/approvals/:approvalId/decision
```

### Relay Protocol

```ts
type RelayOperation =
  | "node.status"
  | "node.snapshot.redacted"
  | "approval.list"
  | "approval.decide"
  | "artifact.thumbnail.read"
  | "session.summary.read";

type RelayMessage =
  | { type: "node.hello"; nodeId: string; signature: string }
  | { type: "node.heartbeat"; heartbeat: NodeHeartbeat }
  | { type: "client.open"; grant: string; requestId: string }
  | { type: "client.request"; requestId: string; operation: RelayOperation; resourceId?: string; body?: unknown }
  | { type: "node.response"; requestId: string; status: number; body: unknown }
  | { type: "node.event"; event: NodeEvent };
```

The relay must not forward arbitrary methods and paths. Each `RelayOperation` maps to a node handler with a fixed method, fixed route, max payload size, resource binding, replay check, and scope check. Terminal streams, app proxying, browser proxying, settings mutation, process stop, file access, OAuth callbacks, and Tailscale Serve exposure are not relay operations in v1.

## Rollout Plan

### Phase 1: Local Hardening And Node Snapshot

Add node identity and snapshot endpoints. No account backend. Harden local route/auth/redaction behavior first.

Done when:

- local desktop/web can render machine summary from `/api/node/snapshot?mode=privileged`
- account-style preview can render machine summary from `/api/node/snapshot?mode=redacted`
- tests cover node manifest and snapshot redaction
- non-loopback requests cannot mutate settings, proxy arbitrary ports, expose Tailscale Serve, send session input, or control sessions without node auth

### Product TODO: Account-First Onboarding

The default onboarding must be:

```text
curl install -> open Swarmlab -> log in to Vibe Research -> machine appears in account canvas
```

Do not make users choose, create, clone, or understand a Library before entering the product. The Library is account/workspace state that should be provisioned automatically after login. Manual machine URL entry remains only as an advanced fallback for development, private-network edge cases, or account-service outages.

Done when:

- first-run screen is a Vibe Research login screen
- account login pairs the current node and registers its heartbeat
- every curl-installed node appears automatically in the account/fleet canvas after login
- manual URL pairing is no longer a primary canvas toolbar action
- Library defaults are created/synced after account login without asking the user to pick clone/open/new modes
- hosted `vibe-research.net` and the desktop app show the same account machine regions

### Phase 2: Desktop Machine Registry

Allow account-populated machines to appear in the desktop app, with manual URL entry only as an advanced fallback.

Done when:

- desktop can switch between local machine and machines returned by the Vibe account node registry
- unreachable machine shows stale state
- manual URL fallback is available but visually secondary

### Phase 3: Account Pairing Prototype

Use a minimal hosted account registry.

Done when:

- a curl-installed node can pair with account by code
- web account page lists machine heartbeat summaries
- disconnect works from both node and account

### Phase 4: Remote Approval Queue

Ship the highest-value cross-device feature first.

Done when:

- pending approvals across machines appear in account web
- approving from account web unblocks the node
- node writes audit entry
- expired grant cannot approve

### Phase 5: Remote Machine Canvas

Render full machine canvas through direct URL first, relay second.

Done when:

- web can open a paired machine dashboard
- direct Tailscale/LAN path works
- relay path supports snapshot and events
- terminal/browser/app deep views can be opened safely or are explicitly marked unavailable

### Phase 6: Advanced Remote Control

Add scoped remote actions:

- start agent on chosen machine
- send message to session (implemented for `session.input.write` through the command queue)
- stop agent
- expose port
- open artifact

Do not ship file editing or arbitrary shell over account relay until approval, scope, and audit behavior has been hammered locally.

## Open Questions

- Is the Vibe account service a new hosted app, or should BuildingHub evolve into the account service?
- Should transcript sync be an account feature, or should transcripts remain node-only permanently?
- Should account web support arbitrary app proxying, or should it open direct Tailscale URLs only?
- What is the minimum mobile approval UI?
- Should machine pairing use GitHub OAuth, Google OAuth, email magic links, or all three?
- Should fleet dashboards be shareable with other account users?
- How much of node status should be visible when a machine is offline?

## Concrete Next Engineering Move

Build local route hardening, machine identity, and redacted node snapshot first:

1. Classify local routes as loopback-only, local-auth, grant-auth, or never-remote.
2. Reject unauthenticated non-loopback write/control requests.
3. Add node identity store under state dir.
4. Add `GET /api/node/manifest`.
5. Add `GET /api/node/status`.
6. Add `GET /api/node/snapshot?mode=redacted`.
7. Add `GET /api/node/snapshot?mode=privileged` behind local node auth.
8. Render a local machine card from the privileged snapshot and an account-safe machine card from the redacted snapshot.

This creates the foundation for both the canvas migration and the account fleet dashboard without prematurely committing to cloud relay complexity.
