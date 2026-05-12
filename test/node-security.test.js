import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalOrNodeTokenMiddleware,
  isLocalRequest,
} from "../src/node/security.js";

function createResponseProbe() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("local request detection trusts socket loopback, not Host spoofing", () => {
  assert.equal(isLocalRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "example.com" } }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: "::1" }, headers: { host: "example.com" } }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { host: "example.com" } }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: "100.64.0.5" }, headers: { host: "localhost:4826" } }), false);
});

test("local-or-node-token middleware allows loopback and valid tokens only", () => {
  const nodeIdentityStore = {
    getLocalApiToken() {
      return "secret-node-token";
    },
  };
  const middleware = createLocalOrNodeTokenMiddleware({ nodeIdentityStore });

  let passed = false;
  middleware({ socket: { remoteAddress: "127.0.0.1" }, headers: {} }, createResponseProbe(), () => {
    passed = true;
  });
  assert.equal(passed, true);

  const denied = createResponseProbe();
  middleware({ socket: { remoteAddress: "100.64.0.5" }, headers: { host: "localhost" } }, denied, () => {
    assert.fail("unexpected pass");
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.payload.code, "SWARMLAB_LOCAL_OR_NODE_AUTH_REQUIRED");

  passed = false;
  middleware(
    {
      socket: { remoteAddress: "100.64.0.5" },
      headers: { authorization: "Bearer secret-node-token" },
    },
    createResponseProbe(),
    () => {
      passed = true;
    },
  );
  assert.equal(passed, true);

  let listed = false;
  middleware(
    {
      socket: { remoteAddress: "100.64.0.5" },
      headers: { "x-swarmlab-node-token": "secret-node-token" },
      method: "GET",
      path: "/api/node/account/nodes",
    },
    createResponseProbe(),
    () => {
      listed = true;
    },
  );
  assert.equal(listed, true);
});

test("fleet registry routes are local-or-node-token protected", () => {
  const nodeIdentityStore = {
    getLocalApiToken() {
      return "secret-node-token";
    },
  };
  const middleware = createLocalOrNodeTokenMiddleware({ nodeIdentityStore });

  const denied = createResponseProbe();
  middleware(
    {
      socket: { remoteAddress: "100.64.0.5" },
      headers: {},
      method: "GET",
      path: "/api/fleet/nodes",
    },
    denied,
    () => {
      assert.fail("unexpected pass");
    },
  );
  assert.equal(denied.statusCode, 403);

  let passed = false;
  middleware(
    {
      socket: { remoteAddress: "100.64.0.5" },
      headers: { "x-swarmlab-node-token": "secret-node-token" },
      method: "GET",
      path: "/api/fleet/nodes",
    },
    createResponseProbe(),
    () => {
      passed = true;
    },
  );
  assert.equal(passed, true);
});

test("node account routes are local-or-node-token protected", () => {
  const nodeIdentityStore = {
    getLocalApiToken() {
      return "secret-node-token";
    },
  };
  const middleware = createLocalOrNodeTokenMiddleware({ nodeIdentityStore });

  const denied = createResponseProbe();
  middleware(
    {
      socket: { remoteAddress: "100.64.0.5" },
      headers: {},
      method: "POST",
      path: "/api/node/account/heartbeat",
    },
    denied,
    () => {
      assert.fail("unexpected pass");
    },
  );
  assert.equal(denied.statusCode, 403);

  let passed = false;
  middleware(
    {
      socket: { remoteAddress: "100.64.0.5" },
      headers: { authorization: "Bearer secret-node-token" },
      method: "POST",
      path: "/api/node/account/heartbeat",
    },
    createResponseProbe(),
    () => {
      passed = true;
    },
  );
  assert.equal(passed, true);
});
