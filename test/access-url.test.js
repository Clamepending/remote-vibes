import assert from "node:assert/strict";
import test from "node:test";
import {
  getTailscaleDnsNameFromStatus,
  getTailscaleHttpsUrlFromServeStatus,
  hasTailscaleHttpsRootServe,
  pickPreferredUrl,
} from "../src/access-url.js";

test("preferred access URL uses Tailscale HTTPS over raw tailnet HTTP", () => {
  const preferred = pickPreferredUrl([
    { label: "Local", url: "http://localhost:4123" },
    { label: "Tailscale", url: "http://100.87.72.76:4123" },
    { label: "Tailscale HTTPS", url: "https://home-raspi.tail8dd042.ts.net/" },
  ]);

  assert.deepEqual(preferred, {
    label: "Tailscale HTTPS",
    url: "https://home-raspi.tail8dd042.ts.net/",
  });
});

test("extracts the current machine MagicDNS name from Tailscale status", () => {
  assert.equal(
    getTailscaleDnsNameFromStatus({
      Self: {
        DNSName: "home-raspi.tail8dd042.ts.net.",
      },
    }),
    "home-raspi.tail8dd042.ts.net",
  );
});

test("detects Tailscale Serve HTTPS root for the current Remote Vibes port", () => {
  const serveStatus = {
    Web: {
      "home-raspi.tail8dd042.ts.net:443": {
        Handlers: {
          "/": {
            Proxy: "http://127.0.0.1:4123",
          },
        },
      },
    },
  };

  assert.equal(
    getTailscaleHttpsUrlFromServeStatus(serveStatus, 4123, "home-raspi.tail8dd042.ts.net"),
    "https://home-raspi.tail8dd042.ts.net/",
  );
  assert.equal(hasTailscaleHttpsRootServe(serveStatus, "home-raspi.tail8dd042.ts.net"), true);
});

test("does not treat another HTTPS root service as Remote Vibes", () => {
  const serveStatus = {
    Web: {
      "home-raspi.tail8dd042.ts.net:443": {
        Handlers: {
          "/": {
            Proxy: "http://127.0.0.1:19080",
          },
        },
      },
    },
  };

  assert.equal(
    getTailscaleHttpsUrlFromServeStatus(serveStatus, 4123, "home-raspi.tail8dd042.ts.net"),
    "",
  );
  assert.equal(hasTailscaleHttpsRootServe(serveStatus, "home-raspi.tail8dd042.ts.net"), true);
});
