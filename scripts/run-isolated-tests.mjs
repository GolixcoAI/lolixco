#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import os from "node:os";

export const __projectRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Explicit allowlist of environment variables permitted into isolated test processes.
 * Workstation secrets, credentials, tokens, npm variables, NODE_OPTIONS, and NODE_PATH
 * are strictly excluded.
 */
export const ALLOWED_ENV_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_WORKSPACE",
]);

/**
 * Constructs an explicit, sanitized environment dictionary for test execution.
 * Completely strips all startup preload hooks (NODE_OPTIONS, NODE_PATH), credentials,
 * and workstation secrets.
 */
export function buildSanitizedEnvironment(sourceEnv = process.env, overrides = {}) {
  const sanitized = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") continue;
    // Strictly skip NODE_OPTIONS, NODE_PATH, and npm internals
    if (key === "NODE_OPTIONS" || key === "NODE_PATH" || key.startsWith("npm_")) {
      continue;
    }
    // Strictly skip any variable matching secret or credential patterns
    if (/KEY|SECRET|TOKEN|AUTH|PASS|CRED/i.test(key)) {
      continue;
    }
    // Include only explicitly allowed environment variables
    if (ALLOWED_ENV_VARS.has(key)) {
      sanitized[key] = value;
    }
  }

  // Enforce deterministic test isolation flags
  sanitized.NODE_ENV = "test";
  sanitized.LOLIXCO_TEST_MODE = "1";
  sanitized.LOLIXCO_TEST_ISOLATION = "1";

  // Apply explicit overrides
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) {
      delete sanitized[k];
    } else {
      sanitized[k] = String(v);
    }
  }

  return sanitized;
}

/**
 * Classifies the host IPv6 platform status into one of three explicit states:
 * - "VERIFIED_DISABLED": Affirmative evidence that IPv6 is disabled at kernel level.
 * - "VERIFIED_ENABLED": Affirmative evidence that IPv6 is active and enabled.
 * - "UNKNOWN": Missing, unreadable, malformed, or contradictory evidence.
 *
 * @param {string} [procDir="/proc"]
 * @returns {"VERIFIED_DISABLED" | "VERIFIED_ENABLED" | "UNKNOWN"}
 */
export function getPlatformIpv6Status(procDir = "/proc") {
  const disableIpv6Path = resolve(procDir, "sys/net/ipv6/conf/all/disable_ipv6");
  const inet6Path = resolve(procDir, "net/if_inet6");

  let sysctlValue = null;
  if (existsSync(disableIpv6Path)) {
    try {
      const content = readFileSync(disableIpv6Path, "utf-8").trim();
      if (content === "0" || content === "1") {
        sysctlValue = content;
      } else {
        // Malformed sysctl value (e.g. non-numeric, float, unexpected string)
        return "UNKNOWN";
      }
    } catch {
      // Unreadable sysctl
      return "UNKNOWN";
    }
  } else {
    // Sysctl file does not exist
    return "UNKNOWN";
  }

  const inet6Exists = existsSync(inet6Path);

  // Case 1: sysctl says "1" (disabled).
  // Must be consistent: inet6Path absent or empty.
  if (sysctlValue === "1") {
    if (!inet6Exists) {
      return "VERIFIED_DISABLED";
    }
    try {
      const inet6Content = readFileSync(inet6Path, "utf-8").trim();
      if (inet6Content === "") {
        return "VERIFIED_DISABLED";
      }
      // Contradiction: sysctl says disabled, but active inet6 interfaces exist
      return "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
  }

  // Case 2: sysctl says "0" (enabled).
  // Must be consistent: inet6Path exists and is readable.
  if (sysctlValue === "0") {
    if (!inet6Exists) {
      // Contradiction: sysctl says enabled, but /proc/net/if_inet6 is missing
      return "UNKNOWN";
    }
    try {
      readFileSync(inet6Path, "utf-8");
      return "VERIFIED_ENABLED";
    } catch {
      // Unreadable /proc/net/if_inet6
      return "UNKNOWN";
    }
  }

  return "UNKNOWN";
}

/**
 * Backward-compatible helper: returns true ONLY if IPv6 is affirmatively verified disabled.
 *
 * @param {string} [procDir="/proc"]
 * @returns {boolean}
 */
export function isPlatformIpv6Disabled(procDir = "/proc") {
  return getPlatformIpv6Status(procDir) === "VERIFIED_DISABLED";
}

/**
 * Validates operating system evidence of network isolation via Linux /proc filesystem.
 * Strictly fails closed if the platform is not Linux, if /proc evidence is missing,
 * unreadable, empty, malformed, or if any non-loopback network interfaces or routes exist.
 *
 * @param {string} [procDir="/proc"] - Custom proc directory for testing mock inputs
 * @returns {{ isolated: boolean, reason?: string, details?: any, ipv6Disabled?: boolean }}
 */
export function checkProcNetworkIsolation(procDir = "/proc") {
  // 1. Explicitly reject unsupported non-Linux platforms
  if (process.platform !== "linux" && procDir === "/proc") {
    return {
      isolated: false,
      reason: `unsupported_platform: kernel network isolation requires Linux (detected: ${process.platform})`,
    };
  }

  const devPath = resolve(procDir, "net/dev");
  const routePath = resolve(procDir, "net/route");
  const ipv6RoutePath = resolve(procDir, "net/ipv6_route");
  const ifInet6Path = resolve(procDir, "net/if_inet6");

  // 2. /proc/net/dev MUST exist and be readable
  if (!existsSync(devPath)) {
    return {
      isolated: false,
      reason: "missing_proc_net_dev: /proc/net/dev is absent or unreadable",
    };
  }

  let devContent;
  try {
    devContent = readFileSync(devPath, "utf-8");
  } catch (err) {
    return {
      isolated: false,
      reason: `unreadable_proc_net_dev: ${err.message}`,
    };
  }

  const rawDevLines = devContent.split("\n");
  if (rawDevLines.length < 3) {
    return {
      isolated: false,
      reason: "malformed_proc_net_dev: /proc/net/dev has insufficient lines for Linux format",
    };
  }

  // Header validation
  if (
    !/Inter-\|\s*Receive\s*\|\s*Transmit/.test(rawDevLines[0]) ||
    !/face\s*\|bytes\s+packets/.test(rawDevLines[1])
  ) {
    return {
      isolated: false,
      reason: "malformed_proc_net_dev: /proc/net/dev missing expected Linux kernel table headers",
    };
  }

  const dataLines = rawDevLines.slice(2).filter((l) => l.trim().length > 0);
  const interfaces = [];

  for (const line of dataLines) {
    if (!line.includes(":")) {
      return {
        isolated: false,
        reason: "malformed_proc_net_dev: line missing interface colon separator",
      };
    }
    const [ifacePart, countersPart] = line.split(":");
    const iface = ifacePart.trim();
    if (!iface || !/^[a-zA-Z0-9_.-]+$/.test(iface)) {
      return {
        isolated: false,
        reason: `malformed_proc_net_dev: invalid interface name '${iface}'`,
      };
    }
    const counters = countersPart.trim().split(/\s+/).filter(Boolean);
    // Linux /proc/net/dev has exactly 16 counters: 8 rx, 8 tx
    if (counters.length !== 16 || !counters.every((c) => /^\d+$/.test(c))) {
      return {
        isolated: false,
        reason: `malformed_proc_net_dev: interface '${iface}' does not have 16 valid numeric counters`,
      };
    }
    interfaces.push(iface);
  }

  if (interfaces.length === 0) {
    return {
      isolated: false,
      reason: "malformed_proc_net_dev: zero network interfaces parsed from /proc/net/dev",
    };
  }

  if (!interfaces.includes("lo")) {
    return {
      isolated: false,
      reason: "missing_loopback_interface: 'lo' interface is missing from /proc/net/dev",
    };
  }

  // In an isolated network namespace, ONLY 'lo' may exist
  const nonLoopback = interfaces.filter((iface) => iface !== "lo");
  if (nonLoopback.length > 0) {
    return {
      isolated: false,
      reason: `non_loopback_interfaces_detected: [${nonLoopback.join(", ")}]`,
      details: { interfaces, nonLoopback },
    };
  }

  // 3. /proc/net/route (IPv4) MUST exist and indicate zero external routes
  if (!existsSync(routePath)) {
    return {
      isolated: false,
      reason: "missing_proc_net_route: /proc/net/route is absent or unreadable",
    };
  }

  let routeContent;
  try {
    routeContent = readFileSync(routePath, "utf-8");
  } catch (err) {
    return {
      isolated: false,
      reason: `unreadable_proc_net_route: ${err.message}`,
    };
  }

  const routeLines = routeContent.trim().split("\n").filter(Boolean);
  if (routeLines.length === 0) {
    return {
      isolated: false,
      reason: "malformed_proc_net_route: /proc/net/route is empty",
    };
  }

  // Header must contain all 11 standard columns
  const expectedRouteHeaders = [
    "Iface", "Destination", "Gateway", "Flags", "RefCnt",
    "Use", "Metric", "Mask", "MTU", "Window", "IRTT"
  ];
  const headerCols = routeLines[0].trim().split(/\s+/);
  const headerMatches = expectedRouteHeaders.every((h, i) => headerCols[i] === h);
  if (!headerMatches) {
    return {
      isolated: false,
      reason: "malformed_proc_net_route: /proc/net/route missing standard Linux column headers",
    };
  }

  // In an isolated namespace, there must be 0 routing entries (only the 1 header line)
  if (routeLines.length > 1) {
    for (const rLine of routeLines.slice(1)) {
      const parts = rLine.trim().split(/\s+/);
      if (parts.length !== 11) {
        return {
          isolated: false,
          reason: "malformed_proc_net_route: route entry does not have 11 columns",
        };
      }
      const [rIface, rDest, rGateway] = parts;
      if (rIface !== "lo" || rDest !== "00000000" || rGateway !== "00000000") {
        return {
          isolated: false,
          reason: `ipv4_routes_detected: non-loopback route via '${rIface}' present in /proc/net/route`,
        };
      }
    }
  }

  // 4. IPv6 route and interface verification
  const ipv6Status = getPlatformIpv6Status(procDir);

  if (ipv6Status === "UNKNOWN") {
    return {
      isolated: false,
      reason:
        "ipv6_state_unknown: affirmative IPv6 status could not be verified from platform evidence (missing, unreadable, malformed, or contradictory /proc/sys/net/ipv6 or /proc/net/if_inet6)",
    };
  }

  if (ipv6Status === "VERIFIED_DISABLED") {
    return { isolated: true, ipv6Disabled: true };
  }

  // When IPv6 is enabled, /proc/net/ipv6_route MUST exist, be readable, and be non-empty
  if (!existsSync(ipv6RoutePath)) {
    return {
      isolated: false,
      reason: "missing_proc_net_ipv6_route: /proc/net/ipv6_route is absent on IPv6-enabled system",
    };
  }

  let v6Content;
  try {
    v6Content = readFileSync(ipv6RoutePath, "utf-8").trim();
  } catch (err) {
    return {
      isolated: false,
      reason: `unreadable_proc_net_ipv6_route: ${err.message}`,
    };
  }

  if (!v6Content) {
    return {
      isolated: false,
      reason: "empty_proc_net_ipv6_route_without_disabled_evidence: empty IPv6 route table without disabled IPv6 sysctl",
    };
  }

  const hex32 = /^[0-9a-fA-F]{32}$/;
  const hex8 = /^[0-9a-fA-F]{8}$/;
  const hex2 = /^[0-9a-fA-F]{2}$/;

  const v6Lines = v6Content.split("\n").filter(Boolean);
  for (const line of v6Lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 10) {
      return {
        isolated: false,
        reason: "malformed_proc_net_ipv6_route: each line must contain exactly 10 fields",
      };
    }
    const [dest, destLen, src, srcLen, nexthop, metric, refcnt, usecnt, flags, iface] = parts;
    if (
      !hex32.test(dest) || !hex2.test(destLen) ||
      !hex32.test(src) || !hex2.test(srcLen) ||
      !hex32.test(nexthop) || !hex8.test(metric) ||
      !hex8.test(refcnt) || !hex8.test(usecnt) ||
      !hex8.test(flags)
    ) {
      return {
        isolated: false,
        reason: "malformed_proc_net_ipv6_route: field failed hex structure validation",
      };
    }
    if (iface !== "lo" && iface !== "*") {
      return {
        isolated: false,
        reason: `ipv6_routes_detected: non-loopback IPv6 route via '${iface}' present in /proc/net/ipv6_route`,
      };
    }
  }

  // Also check /proc/net/if_inet6: only lo may be present
  if (existsSync(ifInet6Path)) {
    try {
      const inet6Content = readFileSync(ifInet6Path, "utf-8").trim();
      if (inet6Content) {
        for (const line of inet6Content.split("\n").filter(Boolean)) {
          const parts = line.trim().split(/\s+/);
          const devName = parts[parts.length - 1];
          if (devName && devName !== "lo") {
            return {
              isolated: false,
              reason: `non_loopback_ipv6_interfaces_detected: interface '${devName}' present in /proc/net/if_inet6`,
            };
          }
        }
      }
    } catch {
      return {
        isolated: false,
        reason: "unreadable_proc_net_if_inet6",
      };
    }
  }

  return { isolated: true, ipv6Disabled: false };
}

/**
 * Performs empirical socket-level negative and positive network probes.
 * Verifies at the OS socket boundary that:
 * 1. Loopback communication on 127.0.0.1 is fully functional.
 * 2. External IPv4 egress (e.g. to RFC 5737 TEST-NET-2 198.51.100.1) is blocked strictly with ENETUNREACH.
 * 3. External IPv6 egress (e.g. to RFC 3849 2001:db8::1) is blocked strictly with ENETUNREACH (or verified disabled).
 *
 * Rejects timeouts, synchronous exceptions, ambiguous errors (EINVAL, EADDRNOTAVAIL, ECONNREFUSED),
 * and successful connections.
 *
 * @param {object} [options={}] - Optional injection seam for unit/regression tests
 * @returns {Promise<{ verified: boolean, reason?: string, details?: any, ipv6Disabled?: boolean }>}
 */
export async function verifyNetworkIsolationProbes(options = {}) {
  const {
    connectFn = net.connect,
    createServerFn = net.createServer,
    getIpv6StatusFn = null,
    isIpv6DisabledFn = null,
    timeoutMs = 500,
  } = options;

  // 1. Positive loopback test: verify we can bind and connect on 127.0.0.1
  const loopbackOk = await new Promise((resolve) => {
    let server;
    try {
      server = createServerFn();
      server.listen(0, "127.0.0.1", () => {
        try {
          const port = server.address().port;
          const client = connectFn(port, "127.0.0.1");
          client.on("connect", () => {
            client.destroy();
            server.close(() => resolve({ ok: true }));
          });
          client.on("error", (err) => {
            server.close(() => resolve({ ok: false, error: err.message, code: err.code }));
          });
        } catch (err) {
          server.close(() => resolve({ ok: false, error: err.message, code: err.code }));
        }
      });
      server.on("error", (err) => {
        resolve({ ok: false, error: err.message, code: err.code });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message, code: err.code || "ERR_LOOPBACK_SYNC" });
    }
  });

  if (!loopbackOk.ok) {
    return {
      verified: false,
      reason: `loopback_verification_failed: ${loopbackOk.error || "cannot establish loopback connection"} (code: ${loopbackOk.code || "unknown"})`,
    };
  }

  // 2. Negative external IPv4 egress probe to non-routable documentation address 198.51.100.1
  const ipv4Probe = await new Promise((resolve) => {
    let socket;
    const timer = setTimeout(() => {
      if (socket && typeof socket.destroy === "function") socket.destroy();
      resolve({ blocked: false, code: "ETIMEOUT" });
    }, timeoutMs);

    try {
      socket = connectFn(80, "198.51.100.1");
      socket.on("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ blocked: false, code: "CONNECTED" });
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        // Under true OS kernel network isolation with no route, kernel returns ENETUNREACH
        if (err.code === "ENETUNREACH") {
          resolve({ blocked: true, code: err.code });
        } else {
          // Reject ambiguous errors: EADDRNOTAVAIL, ECONNREFUSED, EINVAL, etc.
          resolve({ blocked: false, code: err.code || "ERR_SOCKET_REJECTED", message: err.message });
        }
      });
    } catch (err) {
      clearTimeout(timer);
      // Synchronous exceptions FAIL verification (do not count as successful isolation)
      resolve({ blocked: false, code: err.code || "ERR_SOCKET_SYNC", error: err.message });
    }
  });

  if (!ipv4Probe.blocked) {
    return {
      verified: false,
      reason: `negative_ipv4_probe_failed: outbound socket was not denied by kernel ENETUNREACH (result: ${ipv4Probe.code})`,
      details: ipv4Probe,
    };
  }

  // 3. Negative external IPv6 egress probe to documentation address 2001:db8::1
  let effectiveIpv6Status = "UNKNOWN";
  if (typeof getIpv6StatusFn === "function") {
    effectiveIpv6Status = getIpv6StatusFn();
  } else if (typeof isIpv6DisabledFn === "function") {
    effectiveIpv6Status = isIpv6DisabledFn() ? "VERIFIED_DISABLED" : "VERIFIED_ENABLED";
  } else {
    effectiveIpv6Status = getPlatformIpv6Status();
  }

  if (effectiveIpv6Status === "UNKNOWN") {
    return {
      verified: false,
      reason: "ipv6_state_unknown: unable to verify affirmative IPv6 platform status for probes",
    };
  }

  if (effectiveIpv6Status === "VERIFIED_DISABLED") {
    return { verified: true, ipv6Disabled: true };
  }

  const ipv6Probe = await new Promise((resolve) => {
    let socket;
    const timer = setTimeout(() => {
      if (socket && typeof socket.destroy === "function") socket.destroy();
      resolve({ blocked: false, code: "ETIMEOUT" });
    }, timeoutMs);

    try {
      socket = connectFn(80, "2001:db8::1");
      socket.on("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ blocked: false, code: "CONNECTED" });
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        // Under true OS kernel network isolation with no route, kernel returns ENETUNREACH
        if (err.code === "ENETUNREACH") {
          resolve({ blocked: true, code: err.code });
        } else {
          // Reject ambiguous errors: EINVAL, EADDRNOTAVAIL, etc.
          resolve({ blocked: false, code: err.code || "ERR_SOCKET_REJECTED", message: err.message });
        }
      });
    } catch (err) {
      clearTimeout(timer);
      // Synchronous exceptions FAIL verification
      resolve({ blocked: false, code: err.code || "ERR_SOCKET_SYNC", error: err.message });
    }
  });

  if (!ipv6Probe.blocked) {
    return {
      verified: false,
      reason: `negative_ipv6_probe_failed: outbound IPv6 socket was not denied by kernel ENETUNREACH (result: ${ipv6Probe.code})`,
      details: ipv6Probe,
    };
  }

  return { verified: true, ipv6Disabled: false };
}

/**
 * Synchronously checks whether the current process is running inside a verified
 * isolated network namespace via /proc evidence.
 */
export function isKernelNetworkIsolated() {
  const procCheck = checkProcNetworkIsolation();
  return procCheck.isolated;
}

/**
 * Main runner entry point.
 */
async function main() {
  const rawArgs = process.argv.slice(2);

  // Validate arguments: reject dangerous characters or injection attempts
  for (const arg of rawArgs) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      console.error("[LOLIXCO SECURITY FATAL] Invalid argument containing null byte detected.");
      process.exit(1);
    }
  }

  // Support pre-flight check flags
  if (rawArgs.includes("--check-isolation")) {
    const procCheck = checkProcNetworkIsolation();
    if (!procCheck.isolated) {
      console.error(`[LOLIXCO SECURITY FATAL] Isolation check failed: ${procCheck.reason}`);
      process.exit(1);
    }
    const probeCheck = await verifyNetworkIsolationProbes();
    if (!probeCheck.verified) {
      console.error(`[LOLIXCO SECURITY FATAL] Isolation probe failed: ${probeCheck.reason}`);
      process.exit(1);
    }
    console.log("[LOLIXCO ISOLATION PREFLIGHT] Kernel network namespace isolation verified successfully.");
    process.exit(0);
  }

  if (rawArgs.includes("--version")) {
    console.log("Lolixco Network-Isolated Test Runner v6");
    process.exit(0);
  }

  if (rawArgs.includes("--print-args")) {
    // Diagnostic argument printing requires verified isolation boundary
    const procCheck = checkProcNetworkIsolation();
    if (!procCheck.isolated) {
      console.error(`[LOLIXCO SECURITY FATAL] Isolation check failed: ${procCheck.reason}`);
      process.exit(1);
    }
    console.log("RECEIVED_RAW_ARGS:" + JSON.stringify(rawArgs));
    process.exit(0);
  }

  // Check if we are already inside a verified isolated network boundary
  const procCheck = checkProcNetworkIsolation();

  if (procCheck.isolated) {
    // Perform live empirical network verification probes
    const probeCheck = await verifyNetworkIsolationProbes();
    if (!probeCheck.verified) {
      console.error(
        `[LOLIXCO SECURITY FATAL] Empirical network isolation probe failed: ${probeCheck.reason}`
      );
      process.exit(1);
    }

    // Inside verified kernel boundary: construct sanitized environment
    const testEnv = buildSanitizedEnvironment(process.env, {
      LOLIXCO_KERNEL_ISOLATED: "1",
    });

    const testFiles = rawArgs.length > 0 ? rawArgs : ["tests/*.test.mjs"];
    const nodeArgs = ["--import", "./tests/register-ts.mjs", "--test", ...testFiles];

    // Spawn test suite using process.execPath with explicit sanitized environment and positional args
    const child = spawnSync(process.execPath, nodeArgs, {
      cwd: __projectRoot,
      stdio: "inherit",
      env: testEnv,
    });

    process.exit(child.status ?? (child.signal ? 1 : 0));
  }

  // If NOT inside verified isolation: FAIL CLOSED!
  // Do NOT claim Node can sanitize preloads that already executed.
  console.error(
    `[LOLIXCO SECURITY FATAL] Operating system network isolation is not active: ${procCheck.reason}`
  );
  console.error(
    "[LOLIXCO SECURITY FATAL] Security tests must be launched via the trusted shell launcher (./scripts/run-isolated-tests.sh) or within a verified network-isolated container."
  );
  console.error(
    "Unisolated test execution is strictly prohibited. Tests require verified OS network namespace or container isolation."
  );
  process.exit(1);
}

// Only run main if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
