#!/bin/bash
# ==============================================================================
# Lolixco Trusted Security Test Launcher (v6)
# ==============================================================================
# This shell script establishes the trusted security-test execution boundary
# BEFORE any Node.js, npm, or unisolated subprocesses run.
#
# Trust Boundary & Threat Model:
# 1. Non-interactive Bash can execute inherited startup hooks via BASH_ENV or
#    ENV before internal script logic executes. Furthermore, an untrusted host
#    PATH can resolve attacker-controlled executables (bash, node, uname).
# 2. To eliminate inherited startup hooks and uncontrolled executable resolution,
#    the supported trusted execution contract requires:
#      /usr/bin/env -i PATH="/usr/local/bin:/usr/bin:/bin" HOME="$HOME" /bin/bash --noprofile --norc ./scripts/run-isolated-tests.sh "$@"
# 3. If invoked directly with BASH_ENV or ENV present, this launcher halts
#    immediately with non-zero exit code (fail-closed).
# 4. A fixed, trusted PATH policy is enforced immediately:
#      PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# 5. Core utilities are resolved strictly from the trusted PATH or absolute paths.
# 6. If not yet initialized under the clean allowlist, the launcher re-execs
#    itself with /usr/bin/env -i and --noprofile --norc.
# 7. It enforces operating system platform verification (Linux required).
# 8. It establishes an isolated Linux network namespace (unshare -rn) with
#    mandatory loopback interface configuration.
# 9. Inside the isolated namespace, Node.js executes the test suite.
# ==============================================================================

set -euo pipefail

# 1. Immediate startup hook detection: reject inherited BASH_ENV / ENV
if [ -n "${BASH_ENV:-}" ] || [ -n "${ENV:-}" ]; then
  echo "[LOLIXCO SECURITY FATAL] Inherited shell startup hook detected (BASH_ENV/ENV)." >&2
  echo "[LOLIXCO SECURITY FATAL] Test execution must be invoked via the trusted entry point without shell startup hooks." >&2
  exit 1
fi

# 2. Enforce fixed trusted PATH immediately - never inherit attacker-controlled PATH
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
unset BASH_ENV ENV CDPATH IFS NODE_OPTIONS NODE_PATH npm_config_token AWS_SECRET_ACCESS_KEY SECRET_API_KEY

# 3. Resolve core utilities from trusted PATH or absolute paths
UNAME_BIN="$(command -v uname || true)"
[ -x "$UNAME_BIN" ] || UNAME_BIN="/bin/uname"
[ -x "$UNAME_BIN" ] || UNAME_BIN="/usr/bin/uname"

ENV_BIN="$(command -v env || true)"
[ -x "$ENV_BIN" ] || ENV_BIN="/usr/bin/env"
[ -x "$ENV_BIN" ] || ENV_BIN="/bin/env"

UNSHARE_BIN="$(command -v unshare || true)"
[ -x "$UNSHARE_BIN" ] || UNSHARE_BIN="/usr/bin/unshare"
[ -x "$UNSHARE_BIN" ] || UNSHARE_BIN="/bin/unshare"

IP_BIN="$(command -v ip || true)"
[ -x "$IP_BIN" ] || IP_BIN="/sbin/ip"
[ -x "$IP_BIN" ] || IP_BIN="/usr/sbin/ip"
[ -x "$IP_BIN" ] || IP_BIN="/bin/ip"

NODE_BIN="$(command -v node || true)"
[ -x "$NODE_BIN" ] || NODE_BIN="/usr/local/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="/usr/bin/node"

BASH_BIN="/bin/bash"
[ -x "$BASH_BIN" ] || BASH_BIN="/usr/bin/bash"

# 4. Operating system platform check: Linux required
CURRENT_OS="$("$UNAME_BIN" -s)"
if [ "$CURRENT_OS" != "Linux" ]; then
  echo "[LOLIXCO SECURITY FATAL] Kernel network isolation requires Linux (detected: $CURRENT_OS)." >&2
  echo "[LOLIXCO SECURITY FATAL] Unisolated test execution is strictly prohibited." >&2
  exit 1
fi

# 5. Self-sanitization re-exec: ensure execution runs under a pristine allowlisted environment
if [ "${LOLIXCO_TRUSTED_LAUNCHER_INIT:-}" != "1" ]; then
  ALLOWED_HOME="${HOME:-/tmp}"
  ALLOWED_USER="${USER:-nobody}"
  ALLOWED_LOGNAME="${LOGNAME:-nobody}"
  ALLOWED_SHELL="${SHELL:-$BASH_BIN}"
  ALLOWED_LANG="${LANG:-en_US.UTF-8}"
  ALLOWED_LC_ALL="${LC_ALL:-C.UTF-8}"
  ALLOWED_TERM="${TERM:-dumb}"
  ALLOWED_TMPDIR="${TMPDIR:-/tmp}"
  ALLOWED_CI="${CI:-}"
  ALLOWED_GITHUB_ACTIONS="${GITHUB_ACTIONS:-}"
  ALLOWED_GITHUB_WORKSPACE="${GITHUB_WORKSPACE:-}"

  exec "$ENV_BIN" -i \
    PATH="$PATH" \
    HOME="$ALLOWED_HOME" \
    USER="$ALLOWED_USER" \
    LOGNAME="$ALLOWED_LOGNAME" \
    SHELL="$ALLOWED_SHELL" \
    LANG="$ALLOWED_LANG" \
    LC_ALL="$ALLOWED_LC_ALL" \
    TERM="$ALLOWED_TERM" \
    TMPDIR="$ALLOWED_TMPDIR" \
    CI="$ALLOWED_CI" \
    GITHUB_ACTIONS="$ALLOWED_GITHUB_ACTIONS" \
    GITHUB_WORKSPACE="$ALLOWED_GITHUB_WORKSPACE" \
    LOLIXCO_TRUSTED_LAUNCHER_INIT="1" \
    "$BASH_BIN" --noprofile --norc "$0" "$@"
fi

# Find repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Function: preliminary check if already inside a network namespace
is_already_isolated() {
  if [ -r "/proc/net/dev" ] && [ -r "/proc/net/route" ]; then
    local non_lo_devs
    non_lo_devs=$(awk -F: '/:/{gsub(/^[ \t]+/, "", $1); if ($1 != "lo") print $1}' /proc/net/dev 2>/dev/null || true)
    local route_count
    route_count=$(grep -vc '^[[:space:]]*$' /proc/net/route 2>/dev/null || true)
    if [ -z "$non_lo_devs" ] && [ "$route_count" -le 1 ]; then
      return 0
    fi
  fi
  return 1
}

# 6. Execution path inside isolated namespace
if is_already_isolated; then
  # Bring loopback up if needed
  if ! "$IP_BIN" link set lo up 2>/dev/null; then
    # Verify if loopback is already up
    if ! "$IP_BIN" link show lo 2>/dev/null | grep -q "UP"; then
      echo "[LOLIXCO SECURITY FATAL] Loopback interface failed to initialize in network namespace." >&2
      exit 1
    fi
  fi

  exec "$ENV_BIN" -i \
    PATH="$PATH" \
    HOME="${HOME:-/tmp}" \
    USER="${USER:-nobody}" \
    LOGNAME="${LOGNAME:-nobody}" \
    SHELL="${SHELL:-$BASH_BIN}" \
    LANG="${LANG:-en_US.UTF-8}" \
    LC_ALL="${LC_ALL:-C.UTF-8}" \
    TERM="${TERM:-dumb}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    CI="${CI:-}" \
    GITHUB_ACTIONS="${GITHUB_ACTIONS:-}" \
    GITHUB_WORKSPACE="${GITHUB_WORKSPACE:-}" \
    NODE_ENV="test" \
    LOLIXCO_TEST_MODE="1" \
    LOLIXCO_TEST_ISOLATION="1" \
    LOLIXCO_KERNEL_ISOLATED="1" \
    "$NODE_BIN" "$REPO_ROOT/scripts/run-isolated-tests.mjs" "$@"
fi

# 7. Not yet isolated: verify unshare and ip capabilities
if [ ! -x "$UNSHARE_BIN" ]; then
  echo "[LOLIXCO SECURITY FATAL] Linux 'unshare' utility is not installed. Kernel network isolation cannot be established." >&2
  exit 1
fi

if [ ! -x "$IP_BIN" ]; then
  echo "[LOLIXCO SECURITY FATAL] Linux 'ip' utility is not installed. Loopback cannot be configured." >&2
  exit 1
fi

# 8. Launch unshare with isolated network and user namespace (-rn),
# configure loopback, and invoke this script inside the namespace
echo "[LOLIXCO LAUNCHER] Establishing new isolated kernel network namespace via unshare..." >&2
LOOPBACK_CMD="$IP_BIN link set lo up || { echo '[LOLIXCO SECURITY FATAL] Failed to configure loopback in isolated network namespace' >&2; exit 1; }; exec \"\$@\""

exec "$ENV_BIN" -i \
  PATH="$PATH" \
  HOME="${HOME:-/tmp}" \
  USER="${USER:-nobody}" \
  LOGNAME="${LOGNAME:-nobody}" \
  SHELL="${SHELL:-$BASH_BIN}" \
  LANG="${LANG:-en_US.UTF-8}" \
  LC_ALL="${LC_ALL:-C.UTF-8}" \
  TERM="${TERM:-dumb}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  CI="${CI:-}" \
  GITHUB_ACTIONS="${GITHUB_ACTIONS:-}" \
  GITHUB_WORKSPACE="${GITHUB_WORKSPACE:-}" \
  LOLIXCO_TRUSTED_LAUNCHER_INIT="1" \
  "$UNSHARE_BIN" -rn sh -c "$LOOPBACK_CMD" -- "$BASH_BIN" --noprofile --norc "$0" "$@"
