# Lolixco Stage 1 — Network Isolation Test Runner (v6)

## 1. Overview and Architecture

Lolixco Stage 1 enforces multi-layered, fail-closed test isolation to ensure that test execution cannot perform outbound network connections, inspect or exfiltrate workstation secrets, or modify production catalogs and private audit databases.

The isolation model operates at three independent boundaries:
1. **Initial Trusted Launch Boundary (`scripts/run-isolated-tests.sh`):** Establishes the clean execution boundary *before* any Node.js, npm, or unisolated subprocess runs. It enforces Linux OS requirements, validates that shell startup hooks (`BASH_ENV`, `ENV`) are absent, enforces a fixed trusted `PATH`, and strips inherited workstation variables via `env -i`.
2. **Operating System / Kernel Network Namespace Boundary:** Network egress is denied at the Linux kernel boundary (`unshare -rn` or Docker `--network none`). The network namespace possesses only the loopback interface `lo` with zero routing table entries.
3. **Process and Application Layer Boundary:** In-process interceptors (`tests/register-ts.mjs`, `tests/isolated-child-process.mjs`, and `scripts/youtube-api.mjs`) sanitize process environment variables, strip credentials (`YOUTUBE_DATA_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `NODE_OPTIONS`, `NODE_PATH`), and intercept runtime networking (`fetch`, `http.request`, `https.request`, `net.connect`, `tls.connect`).

---

## 2. Threat Model: Pre-Startup Execution and Preload Elimination

### Problem Statement
1. In Bash, non-interactive shell invocations execute startup code referenced by `BASH_ENV` or `ENV` *before* internal script logic or sanitation lines execute.
2. If executables are resolved through an inherited workstation `PATH`, an attacker could shadow core utilities (`bash`, `node`, `uname`, `ip`, `unshare`) with malicious binaries.
3. In Node.js, `NODE_OPTIONS` and `NODE_PATH` environment variables are evaluated by the Node runtime C++ initialization layer *before* any userland JavaScript, package script, or module executes.
4. An internal JavaScript runner or script cannot retrospectively undo or prevent earlier execution once Node or Bash has already started.

### The Trusted Launch Contract
The supported, trusted security-test entry point is:

```bash
/usr/bin/env -i PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" HOME="$HOME" /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh
```

### Security Boundary and Assumptions
- **Pre-execution Boundary & Startup Invariant:** When Bash starts non-interactively with `BASH_ENV` or `ENV` in the ambient environment, Bash evaluates the referenced script *before* line 1 of any shell script executes. Although `scripts/run-isolated-tests.sh` checks for `BASH_ENV` and terminates immediately with exit code 1 to prevent test execution, direct invocation on an already-compromised host cannot retrospectively undo commands executed during that pre-script startup phase. Therefore, the trusted startup contract requires a trusted parent (such as a controlled CI job or container entry point) that executes `/usr/bin/env -i ... /bin/bash --noprofile --norc` to purge all startup variables *before* Bash is spawned.
- **Fail-Closed Startup Detection:** If `scripts/run-isolated-tests.sh` is invoked directly with `BASH_ENV` or `ENV` set in the environment, it aborts immediately with exit code 1, preventing test execution.
- **Fixed Trusted PATH Policy:** The launcher sets `PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"` immediately and resolves all core utilities (`uname`, `env`, `unshare`, `ip`, `node`) strictly from trusted absolute paths or this fixed policy.
- **CI Workflow Alignment:** In GitHub Actions CI, both the isolation preflight (`--check-isolation`) and the test suite invocation directly execute this sanitized entry command (`/usr/bin/env -i ... /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh`) to guarantee that preloads and ambient host variables cannot infect either verification step.
- **Distinction from Host `npm test`:** Invoking `npm test` or `pnpm test` on a dirty host machine starts the host's Node/npm binary *before* the script is reached. In audited environments and CI, the trusted entry point must be invoked outside the dirty environment.

---

## 3. Supported Test Environments

### Primary Supported Environment: Linux Host or GitHub Actions Runner
- **OS:** Linux (Ubuntu 22.04 LTS / Ubuntu 24.04 LTS or compatible Debian-based distribution, kernel >= 3.8).
- **Permissions:** Unprivileged user namespaces (`kernel.unprivileged_userns_clone=1` / Ubuntu standard). On Ubuntu 24.04, `kernel.apparmor_restrict_unprivileged_userns=0` is configured in CI if restricted.
- **Tools:** `unshare` (from `util-linux`) and `ip` (from `iproute2`).

### Container Environment (Alternative / CI):
- **Runtime:** Docker or Podman.
- **Flags:** `--network none --read-only=false`.
- **User:** Non-root user with no access to workstation secrets or Docker socket.

---

## 4. Preparation vs. Isolated Execution Workflow

Dependency installation and test execution are strictly separated:

```bash
# Phase 1: Preparation (External network permitted)
pnpm install --frozen-lockfile
pip install -r server/recsys/requirements.txt "jsonschema[format-nongpl]"

# Phase 2: Test Execution (External network DENIED at kernel boundary)
/usr/bin/env -i PATH="/usr/local/bin:/usr/bin:/bin" HOME="$HOME" /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh
```

---

## 5. Strict Kernel Evidence Verification & 3-State IPv6 Detection

`scripts/run-isolated-tests.mjs` inspects Linux kernel networking tables and rejects missing, empty, or malformed evidence:
1. **/proc/net/dev:**
   - Validates 2-line header structure.
   - Enforces exactly 16 numeric counter columns per interface.
   - Verifies that only the `lo` loopback interface exists. Any non-loopback device causes immediate abort.
2. **/proc/net/route:**
   - Validates all 11 column names (`Iface`, `Destination`, `Gateway`, `Flags`, `RefCnt`, `Use`, `Metric`, `Mask`, `MTU`, `Window`, `IRTT`).
   - Verifies 0 non-header route lines exist.
3. **/proc/net/ipv6_route & 3-State Platform IPv6 Classification:**
   - The platform IPv6 state is strictly classified as one of three states:
     - `VERIFIED_DISABLED`: `/proc/sys/net/ipv6/conf/all/disable_ipv6` contains strictly `"1"` AND `/proc/net/if_inet6` is absent or empty.
     - `VERIFIED_ENABLED`: sysctl contains strictly `"0"` AND `/proc/net/if_inet6` is readable.
     - `UNKNOWN`: Missing sysctl, malformed sysctl values, missing `/proc/net/if_inet6` when sysctl reports 0, or contradictory evidence.
   - **Rule:** If IPv6 state is `UNKNOWN`, verification fails closed immediately.
   - When `VERIFIED_ENABLED`, `/proc/net/ipv6_route` must exist, have valid 10-column hex structure, and contain only `lo` or `*` devices.

---

## 6. Empirical Network Probes

The runner executes active socket probes:
1. **Loopback Probe:** Successfully binds a server on `127.0.0.1` and establishes a client TCP connection.
2. **Outbound Probes:**
   - Attempts IPv4 TCP connection to `198.51.100.1:443`.
   - Attempts IPv6 TCP connection to `[2001:db8::1]:443` (when IPv6 is `VERIFIED_ENABLED`).
   - Only genuine kernel route denial (`ENETUNREACH`) is accepted as proof of network isolation.
   - Synchronous exceptions (`ERR_SOCKET_SYNC`), unexpected errors (`ECONNREFUSED`, `EHOSTUNREACH`), ambiguous codes (`EINVAL`, `EADDRNOTAVAIL`), timeouts (`ETIMEOUT`), and successful connections (`CONNECTED`) all fail verification immediately.

---

## 7. Protected-Audit Fixture Seams (Zero Canonical Metadata Operations)

To prevent regression tests from touching canonical workstation audit databases (`content/audit/*`) or metadata:
- Production paths (`src/data/edits.ts`, `content/audit/youtube-intake-audit.json`) are immutable absolute lexical strings.
- Path protection helpers in `scripts/youtube-importer.mjs` evaluate injected test-only protected roots (`setProtectedRootsForTest()`) and lexical path checks before resolving filesystem symlinks.
- Canonical private audit paths are never subjected to `realpathSync`, `statSync`, or `lstatSync` during fixture evaluations (monitored and verified via filesystem spy in regression tests).
- Canonical production paths remain permanently protected and cannot be weakened by test seams.

---

## 8. Supported GitHub Actions CI Configuration

In `.github/workflows/frontend-ci.yml`, the runner is pinned to `ubuntu-24.04`:

```yaml
runs-on: ubuntu-24.04
steps:
  - name: Verify kernel unprivileged namespace capability
    run: |
      if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
        sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      fi
      unshare -rn true || { echo "[CI ERROR] Kernel namespace creation failed." >&2; exit 1; }

  - name: Verify kernel network namespace isolation pre-flight
    run: ./scripts/run-isolated-tests.sh --check-isolation

  - name: Run unit and regression tests (network isolated)
    run: pnpm test
```

---

## 9. Known Limitations

- **Native Windows / macOS:** Neither OS natively provides Linux network namespaces without a virtualization layer. On Windows or macOS, developers must execute tests inside Docker (`docker run --network none ...`) or inside WSL2 with unprivileged user namespaces enabled.
