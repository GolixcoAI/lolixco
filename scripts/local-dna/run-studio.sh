#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
if [[ ! -x node_modules/.bin/vite ]]; then
  printf '%s\n' 'Install the workspace dependencies with pnpm install first.' >&2
  exit 1
fi

studio_state="${LOLIXCO_DNA_STATE_PARENT:-$HOME}/.lolixco-edit-dna"
mkdir -p -- "$studio_state"
chmod 700 -- "$studio_state"
umask 077
exec 9>"$studio_state/studio-launch.lock"
if ! flock -n 9; then
  if [[ "${1:-}" != --restart ]]; then
    printf '%s\n' 'Studio is already running. Use pnpm studio:restart to reload backend settings.' >&2
    exit 1
  fi
  read -r previous_pid < "$studio_state/studio-launch.pid"
  if [[ ! "$previous_pid" =~ ^[0-9]+$ ]] || [[ "$(readlink -- "/proc/$previous_pid/cwd")" != "$PWD" ]]; then
    printf '%s\n' 'The running Studio launcher belongs to another workspace.' >&2
    exit 1
  fi
  kill -TERM "$previous_pid"
  if ! flock -w 15 9; then
    printf '%s\n' 'Studio has not finished stopping. Wait a moment and restart again.' >&2
    exit 1
  fi
fi
printf '%s\n' "$$" > "$studio_state/studio-launch.pid"

./scripts/local-dna/run-analyzer.sh 9>&- &
analyzer_pid=$!
frontend_pid=
cleanup() {
  if [[ -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
    wait "$frontend_pid" 2>/dev/null || true
  fi
  kill "$analyzer_pid" 2>/dev/null || true
  wait "$analyzer_pid" 2>/dev/null || true
  rm -f -- "$studio_state/studio-launch.pid"
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
  unset GEMINI_API_KEY YOUTUBE_API_KEY LOLIXCO_GEMINI_YOUTUBE LOLIXCO_GEMINI_MODEL
  exec 9>&-
  export LOLIXCO_LOCAL_DNA=1
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort
) &
frontend_pid=$!
wait -n "$frontend_pid" "$analyzer_pid"
