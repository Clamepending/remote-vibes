import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountTokenStore } from "../src/account/account-token-store.js";

test("AccountTokenStore persists account records without exposing the raw token in status", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-store-"));
  try {
    const first = new AccountTokenStore({ stateDir });
    await first.load();
    await first.setRecord({
      accessToken: "secret-account-token",
      appBaseUrl: "https://vibe-research.net/",
      account: {
        id: "acct_1",
        login: "mark",
        profileUrl: "https://vibe-research.net/u/mark#private",
      },
      node: {
        nodeId: "node_1",
        displayName: "GPU node",
        connectionHints: [
          { kind: "tailscale", url: "https://gpu.tailnet.test/private?token=secret", label: "Tailnet" },
        ],
      },
    });

    const status = first.getStatus();
    assert.equal(status.configured, true);
    assert.equal(status.appBaseUrl, "https://vibe-research.net");
    assert.equal(status.account.login, "mark");
    assert.equal(status.node.connectionHints[0].url, "https://gpu.tailnet.test");
    assert.doesNotMatch(JSON.stringify(status), /secret-account-token/);

    const filePath = path.join(stateDir, "account.json");
    const persisted = await readFile(filePath, "utf8");
    assert.match(persisted, /secret-account-token/);
    assert.doesNotMatch(persisted, /private|token=secret/);
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);

    const second = new AccountTokenStore({ stateDir });
    await second.load();
    assert.equal(second.getRecord().accessToken, "secret-account-token");
    assert.equal(second.getStatus().node.nodeId, "node_1");
    assert.doesNotMatch(JSON.stringify(second.getStatus()), /secret-account-token/);

    await second.clear();
    assert.equal(second.getStatus().configured, false);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
