import { timingSafeEqual } from "node:crypto";
import net from "node:net";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const CONTROL_ROUTE_PATTERNS = [
  { method: "PATCH", pattern: /^\/api\/settings\/?$/ },
  { method: "GET", pattern: /^\/api\/fleet\/nodes\/?$/ },
  { method: "POST", pattern: /^\/api\/fleet\/nodes\/?$/ },
  { method: "DELETE", pattern: /^\/api\/fleet\/nodes\/[^/]+\/?$/ },
  { method: "GET", pattern: /^\/api\/node\/account\/status\/?$/ },
  { method: "GET", pattern: /^\/api\/node\/account\/nodes\/?$/ },
  { method: "POST", pattern: /^\/api\/node\/account\/(?:pair\/start|pair\/complete|heartbeat|disconnect|commands\/poll)\/?$/ },
  { method: "POST", pattern: /^\/api\/files\/(?:upload|folder|file)\/?$/ },
  { method: "PATCH", pattern: /^\/api\/files\/?$/ },
  { method: "DELETE", pattern: /^\/api\/files\/?$/ },
  { method: "PUT", pattern: /^\/api\/files\/text\/?$/ },
  { method: "PATCH", pattern: /^\/api\/ports\/\d+\/?$/ },
  { method: "POST", pattern: /^\/api\/ports\/\d+\/tailscale\/?$/ },
  { method: "POST", pattern: /^\/api\/system\/gpu-restrictions\/?$/ },
  { method: "POST", pattern: /^\/api\/sessions\/?$/ },
  { method: "PATCH", pattern: /^\/api\/sessions\/[^/]+\/?$/ },
  { method: "PUT", pattern: /^\/api\/sessions\/[^/]+\/?$/ },
  { method: "DELETE", pattern: /^\/api\/sessions\/[^/]+\/?$/ },
  { method: "POST", pattern: /^\/api\/sessions\/[^/]+\/.+/ },
  { method: "POST", pattern: /^\/api\/terminate\/?$/ },
  { method: "POST", pattern: /^\/api\/relaunch\/?$/ },
  { method: "ALL", pattern: /^\/proxy\/\d+(?:\/|$)/ },
];

function stripIpv6Prefix(value) {
  const text = String(value || "").trim();
  if (text.startsWith("::ffff:")) {
    return text.slice("::ffff:".length);
  }
  return text;
}

export function isLoopbackAddress(value) {
  const address = stripIpv6Prefix(value).replace(/^\[|\]$/g, "").toLowerCase();
  if (!address) return false;
  if (LOOPBACK_HOSTS.has(address)) return true;
  if (address.startsWith("127.")) return true;
  return false;
}

export function isLocalRequest(request) {
  const remoteAddress =
    request?.socket?.remoteAddress ||
    request?.connection?.remoteAddress ||
    "";
  return isLoopbackAddress(remoteAddress);
}

function extractBearerToken(headerValue) {
  const header = String(headerValue || "").trim();
  const match = header.match(/^bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function getRequestNodeToken(request) {
  return (
    String(request?.headers?.["x-swarmlab-node-token"] || "").trim() ||
    String(request?.headers?.["x-vibe-research-node-token"] || "").trim() ||
    extractBearerToken(request?.headers?.authorization)
  );
}

export function createLocalOrNodeTokenMiddleware({ nodeIdentityStore } = {}) {
  return function requireLocalOrNodeToken(request, response, next) {
    if (isLocalRequest(request)) {
      next();
      return;
    }

    const expected = nodeIdentityStore?.getLocalApiToken?.();
    const provided = getRequestNodeToken(request);
    if (expected && safeTokenEqual(provided, expected)) {
      next();
      return;
    }

    response.status(403).json({
      error: "This Swarmlab route requires local access or a valid node token.",
      code: "SWARMLAB_LOCAL_OR_NODE_AUTH_REQUIRED",
    });
  };
}

export function buildRouteClass({
  path,
  method,
  classification,
  description,
} = {}) {
  return {
    path: String(path || ""),
    method: String(method || "").toUpperCase(),
    classification: String(classification || "unclassified"),
    description: String(description || ""),
  };
}

export function classifyNodeRoute({
  method = "GET",
  path = "",
  isLoopback = false,
  hasNodeAuth = false,
  hasGrant = false,
} = {}) {
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  const normalizedPath = String(path || "").split("?")[0] || "/";
  const controlRoute = CONTROL_ROUTE_PATTERNS.some((entry) =>
    (entry.method === "ALL" || entry.method === normalizedMethod) && entry.pattern.test(normalizedPath),
  );

  if (!controlRoute) {
    return {
      method: normalizedMethod,
      path: normalizedPath,
      classification: "read",
      requiresAuth: false,
      allowUnauthenticatedNonLoopback: true,
      decision: "allow",
    };
  }

  const allowed = Boolean(isLoopback || hasNodeAuth || hasGrant);
  return {
    method: normalizedMethod,
    path: normalizedPath,
    classification: "local-auth",
    requiresAuth: true,
    allowUnauthenticatedNonLoopback: false,
    decision: allowed ? "allow" : "deny",
    allowed,
  };
}

export function normalizeHostForDiagnostics(host) {
  const value = String(host || "").trim();
  if (!value) return "";
  if (net.isIP(stripIpv6Prefix(value))) return stripIpv6Prefix(value);
  return value.toLowerCase();
}
