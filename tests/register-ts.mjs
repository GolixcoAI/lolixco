import { register, createRequire, syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {
  createIsolatedEnvironment,
  spawnSync as isolatedSpawnSync,
  spawn as isolatedSpawn,
  execSync as isolatedExecSync,
  exec as isolatedExec,
  execFile as isolatedExecFile,
  execFileSync as isolatedExecFileSync,
  fork as isolatedFork,
} from "./isolated-child-process.mjs";

// 1. Register TypeScript loader hook for on-the-fly TS transpilation and module interception
register("./ts-hooks.mjs", import.meta.url);

// Determine if we are running in a test context
const isTestContext = (
  process.execArgv.includes("--test") ||
  process.env.npm_lifecycle_event === "test" ||
  process.env.NODE_ENV === "test" ||
  process.env.LOLIXCO_TEST_MODE === "1" ||
  process.env.LOLIXCO_TEST_ISOLATION === "1" ||
  typeof process.env.NODE_TEST_CONTEXT !== "undefined"
);

// 2. Redaction helper for safe error messages (strips credentials, tokens, query params)
export function sanitizeForError(urlOrHost) {
  try {
    const s = String(urlOrHost);
    if (s.includes("://")) {
      const u = new URL(s);
      u.search = "";
      u.username = "";
      u.password = "";
      u.hash = "";
      return u.toString();
    }
    return s.split("?")[0].split("#")[0];
  } catch {
    return "[redacted-target]";
  }
}

// 3. Robust Loopback Host Validator (parsed hostnames, no prefix matching)
export function isAllowedLoopback(hostOrUrl) {
  if (!hostOrUrl) return false;
  try {
    let hostname = String(hostOrUrl).trim();
    if (hostname.includes("://")) {
      const parsed = new URL(hostname);
      hostname = parsed.hostname;
    } else {
      if (hostname.startsWith("[") && hostname.includes("]")) {
        hostname = hostname.slice(1, hostname.indexOf("]"));
      } else if (hostname.split(":").length > 2) {
        // Bare IPv6 like ::1
      } else if (hostname.includes(":")) {
        // Host with port like localhost:3000 or 127.0.0.1:8080
        hostname = hostname.slice(0, hostname.indexOf(":"));
      }
    }
    hostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

// Helper to extract effective target host considering URL + options overrides
export function getEffectiveTargetHost(args) {
  let host = "";
  let options = null;

  if (typeof args[0] === "string" || args[0] instanceof URL) {
    try {
      const u = new URL(String(args[0]));
      host = u.hostname;
    } catch {
      host = String(args[0]);
    }
    if (typeof args[1] === "object" && args[1] !== null) {
      options = args[1];
    }
  } else if (typeof args[0] === "object" && args[0] !== null) {
    options = args[0];
  }

  if (options) {
    // In Node.js http.request, options.hostname or options.host overrides URL host
    if (options.hostname) {
      host = options.hostname;
    } else if (options.host) {
      host = String(options.host).split(":")[0];
    }
  }

  return host;
}

// 4. Activate Test Isolation and Network Blocking if in Test Context
if (isTestContext) {
  // Enforce fail-closed test environment flags
  process.env.NODE_ENV = "test";
  process.env.LOLIXCO_TEST_ISOLATION = "1";
  process.env.LOLIXCO_TEST_MODE = "1";

  // Sanitize workstation secrets from process environment
  delete process.env.YOUTUBE_DATA_API_KEY;
  process.env.YOUTUBE_API_KEY = "LOLIXCO_SYNTHETIC_TEST_KEY_HERMETIC";
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.NODE_OPTIONS;
  delete process.env.NODE_PATH;

  // Global fetch interceptor with redirect protection
  const _originalFetch = globalThis.fetch;

  async function failClosedFetch(input, init) {
    const urlStr = typeof input === "string" ? input : input?.href || String(input?.url || input);

    if (isAllowedLoopback(urlStr)) {
      if (typeof _originalFetch === "function") {
        // Enforce manual redirect handling to prevent loopback requests from redirecting externally
        const modifiedInit = { ...(init || {}), redirect: "manual" };
        const response = await _originalFetch(input, modifiedInit);

        // If response is a redirect, validate the redirect Location header
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location && !isAllowedLoopback(location)) {
            const safeRedirect = sanitizeForError(location);
            const err = new Error(
              `FAIL-CLOSED TEST NETWORK ISOLATION: Loopback redirect to external URL '${safeRedirect}' was blocked.`
            );
            err.code = "ENETWORK_BLOCKED_TEST_MODE";
            throw err;
          }
        }
        return response;
      }
    }

    const safeUrl = sanitizeForError(urlStr);
    const error = new Error(
      `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound network request to '${safeUrl}' was blocked. Tests must use deterministic mock transports or synthetic fixtures.`
    );
    error.code = "ENETWORK_BLOCKED_TEST_MODE";
    throw error;
  }

  globalThis.__LOLIXCO_FAIL_CLOSED_FETCH__ = failClosedFetch;
  globalThis.fetch = failClosedFetch;

  function getTargetDisplay(args) {
    const first = args[0];
    if (typeof first === "string" || first instanceof URL) {
      return sanitizeForError(first);
    }
    return sanitizeForError(getEffectiveTargetHost(args));
  }

  // Intercept node:http and node:https requests
  const _originalHttpRequest = http.request;
  http.request = function isolatedHttpRequest(...args) {
    const targetHost = getEffectiveTargetHost(args);

    if (!isAllowedLoopback(targetHost)) {
      const safeTarget = getTargetDisplay(args);
      const error = new Error(
        `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound HTTP request to '${safeTarget}' was blocked. Tests must use deterministic mock transports.`
      );
      error.code = "ENETWORK_BLOCKED_TEST_MODE";
      throw error;
    }

    return _originalHttpRequest.apply(this, args);
  };

  http.get = function isolatedHttpGet(...args) {
    const req = http.request(...args);
    req.end();
    return req;
  };

  const _originalHttpsRequest = https.request;
  https.request = function isolatedHttpsRequest(...args) {
    const targetHost = getEffectiveTargetHost(args);

    if (!isAllowedLoopback(targetHost)) {
      const safeTarget = getTargetDisplay(args);
      const error = new Error(
        `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound HTTPS request to '${safeTarget}' was blocked. Tests must use deterministic mock transports.`
      );
      error.code = "ENETWORK_BLOCKED_TEST_MODE";
      throw error;
    }

    return _originalHttpsRequest.apply(this, args);
  };

  https.get = function isolatedHttpsGet(...args) {
    const req = https.request(...args);
    req.end();
    return req;
  };

  // Intercept http.ClientRequest directly
  const _originalClientRequest = http.ClientRequest;
  http.ClientRequest = function isolatedClientRequest(...args) {
    const targetHost = getEffectiveTargetHost(args);
    if (!isAllowedLoopback(targetHost)) {
      const safeTarget = getTargetDisplay(args);
      const error = new Error(
        `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound HTTP ClientRequest to '${safeTarget}' was blocked. Tests must use deterministic mock transports.`
      );
      error.code = "ENETWORK_BLOCKED_TEST_MODE";
      throw error;
    }
    return new _originalClientRequest(...args);
  };
  Object.setPrototypeOf(http.ClientRequest, _originalClientRequest);
  http.ClientRequest.prototype = _originalClientRequest.prototype;

  // Synchronize builtin ESM exports so named imports (e.g. import { request } from 'node:http')
  // receive the isolated interceptor wrappers across all modules
  if (typeof syncBuiltinESMExports === "function") {
    syncBuiltinESMExports();
  }

  function extractHostAndPortFromConnectArgs(args) {
    let host = "";
    let port = null;
    if (typeof args[0] === "object" && args[0] !== null) {
      host = args[0].host || args[0].hostname || args[0].servername || "";
      port = args[0].port;
    } else if (typeof args[0] === "number" || typeof args[0] === "string") {
      if (typeof args[1] === "string" && !args[1].startsWith("/")) {
        host = args[1];
      } else if (typeof args[1] === "object" && args[1] !== null) {
        host = args[1].host || args[1].hostname || args[1].servername || "";
        port = args[1].port;
      } else if (typeof args[2] === "object" && args[2] !== null) {
        host = args[2].host || args[2].hostname || args[2].servername || "";
        port = args[2].port;
      }
    }
    return { host, port };
  }

  // Intercept raw TCP / TLS socket connections via net.Socket.prototype.connect
  const _originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function isolatedSocketConnect(...args) {
    const { host } = extractHostAndPortFromConnectArgs(args);

    if (host && !isAllowedLoopback(host)) {
      const safeHost = sanitizeForError(host);
      const err = new Error(
        `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound socket connection to '${safeHost}' was blocked.`
      );
      err.code = "ENETWORK_BLOCKED_TEST_MODE";
      process.nextTick(() => {
        this.destroy(err);
      });
      return this;
    }

    return _originalSocketConnect.apply(this, args);
  };

  const _originalNetConnect = net.connect;
  const _originalNetCreateConnection = net.createConnection;
  function isolatedNetConnect(...args) {
    const { host } = extractHostAndPortFromConnectArgs(args);
    if (host && !isAllowedLoopback(host)) {
      const safeHost = sanitizeForError(host);
      const err = new Error(
        `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound socket connection to '${safeHost}' was blocked.`
      );
      err.code = "ENETWORK_BLOCKED_TEST_MODE";
      const s = new net.Socket();
      process.nextTick(() => {
        s.destroy(err);
      });
      return s;
    }
    return _originalNetConnect.apply(this, args);
  }
  net.connect = isolatedNetConnect;
  net.createConnection = isolatedNetConnect;

  // Intercept TLS socket connections via tls.connect
  const _originalTlsConnect = tls.connect;
  tls.connect = function isolatedTlsConnect(...args) {
    const { host } = extractHostAndPortFromConnectArgs(args);
    if (host && !isAllowedLoopback(host)) {
      const safeHost = sanitizeForError(host);
      const err = new Error(
        `FAIL-CLOSED TEST NETWORK ISOLATION: Outbound TLS connection to '${safeHost}' was blocked.`
      );
      err.code = "ENETWORK_BLOCKED_TEST_MODE";
      const s = new tls.TLSSocket(new net.Socket());
      process.nextTick(() => {
        s.destroy(err);
      });
      return s;
    }
    return _originalTlsConnect.apply(this, args);
  };

  // CommonJS and default-import child process isolation
  const isolatedMethods = {
    spawnSync: isolatedSpawnSync,
    spawn: isolatedSpawn,
    execSync: isolatedExecSync,
    exec: isolatedExec,
    execFile: isolatedExecFile,
    execFileSync: isolatedExecFileSync,
    fork: isolatedFork,
  };

  Object.assign(childProcess, isolatedMethods);

  try {
    const require = createRequire(import.meta.url);
    for (const mod of ["node:child_process", "child_process"]) {
      try {
        const cjsCp = require(mod);
        Object.assign(cjsCp, isolatedMethods);
      } catch {}
    }
    for (const mod of ["node:http", "http"]) {
      try {
        const cjsHttp = require(mod);
        cjsHttp.request = http.request;
        cjsHttp.get = http.get;
        cjsHttp.ClientRequest = http.ClientRequest;
      } catch {}
    }
    for (const mod of ["node:https", "https"]) {
      try {
        const cjsHttps = require(mod);
        cjsHttps.request = https.request;
        cjsHttps.get = https.get;
      } catch {}
    }
    for (const mod of ["node:net", "net"]) {
      try {
        const cjsNet = require(mod);
        cjsNet.connect = net.connect;
        cjsNet.createConnection = net.createConnection;
        cjsNet.Socket.prototype.connect = net.Socket.prototype.connect;
      } catch {}
    }
    for (const mod of ["node:tls", "tls"]) {
      try {
        const cjsTls = require(mod);
        cjsTls.connect = tls.connect;
      } catch {}
    }
    if (typeof syncBuiltinESMExports === "function") {
      syncBuiltinESMExports();
    }
  } catch {}
}
