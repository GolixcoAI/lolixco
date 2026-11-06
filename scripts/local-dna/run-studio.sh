#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
if [[ ! -x node_modules/.bin/vite ]]; then
  printf '%s\n' 'Install the workspace dependencies with pnpm install first.' >&2
  exit 1
fi

./scripts/local-dna/run-analyzer.sh &
analyzer_pid=$!
(
  unset GEMINI_API_KEY LOLIXCO_GEMINI_YOUTUBE LOLIXCO_GEMINI_MODEL
  export LOLIXCO_LOCAL_DNA=1
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort
) &
frontend_pid=$!

cleanup() {
  kill "$frontend_pid" "$analyzer_pid" 2>/dev/null || true
  wait "$frontend_pid" "$analyzer_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait -n "$frontend_pid" "$analyzer_pid"
