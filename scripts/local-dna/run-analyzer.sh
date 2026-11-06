#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
analyzer_python="${LOLIXCO_DNA_PYTHON:-}"
if [[ -z "$analyzer_python" ]]; then
  if [[ -x "$HOME/.venvs/lolixco-antigravity/bin/python" ]]; then
    analyzer_python="$HOME/.venvs/lolixco-antigravity/bin/python"
  else
    analyzer_python=python3
  fi
fi
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  printf '%s\n' 'FFmpeg and ffprobe are required for local media analysis.' >&2
  exit 1
fi
if ! "$analyzer_python" -c 'import cv2, fastapi, librosa, numpy, uvicorn'; then
  printf '%s\n' 'Use LOLIXCO_DNA_PYTHON to point to a Python environment with the Edit DNA dependencies.' >&2
  exit 1
fi
export PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 NUMBA_NUM_THREADS=2
exec "$analyzer_python" "$script_dir/serve.py"
