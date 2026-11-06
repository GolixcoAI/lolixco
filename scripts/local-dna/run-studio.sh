#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
if [[ ! -x node_modules/.bin/vite ]]; then
  printf '%s\n' 'Install the workspace dependencies with pnpm install first.' >&2
  exit 1
fi

./scripts/local-dna/run-analyzer.sh &
analyzer_pid=$!
frontend_pid=
cleanup() {
  if [[ -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
    wait "$frontend_pid" 2>/dev/null || true
  fi
  kill "$analyzer_pid" 2>/dev/null || true
  wait "$analyzer_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

analyzer_ready=false
for (( attempt=0; attempt<100; attempt++ )); do
  if ! kill -0 "$analyzer_pid" 2>/dev/null; then break; fi
  if (exec 3<>/dev/tcp/127.0.0.1/5055) 2>/dev/null; then
    analyzer_ready=true
    break
  fi
  sleep .1
done
if [[ "$analyzer_ready" != true ]]; then
  printf '%s\n' 'The local analyzer did not start on 127.0.0.1:5055.' >&2
  exit 1
fi

(
  unset GEMINI_API_KEY LOLIXCO_GEMINI_YOUTUBE LOLIXCO_GEMINI_MODEL
  export LOLIXCO_LOCAL_DNA=1
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort
) &
frontend_pid=$!
wait -n "$frontend_pid" "$analyzer_pid"
