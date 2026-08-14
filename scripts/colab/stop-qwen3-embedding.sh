#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-$ROOT_DIR/.runtime/colab-qwen3}"
PORT="${EMBEDDING_PORT:-8001}"
STOP_FALLBACK_SCAN="${STOP_FALLBACK_SCAN:-1}"
STOP_WAIT_ATTEMPTS="${STOP_WAIT_ATTEMPTS:-20}"
STOP_WAIT_INTERVAL_SECONDS="${STOP_WAIT_INTERVAL_SECONDS:-0.25}"

stop_pid() {
  local label="$1"
  local pid="$2"
  if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ || "$pid" -le 1 ]]; then
    return 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  echo "Stopping $label PID $pid"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 "$STOP_WAIT_ATTEMPTS"); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep "$STOP_WAIT_INTERVAL_SECONDS"
  done
  echo "$label PID $pid did not exit after SIGTERM; sending SIGKILL"
  kill -KILL "$pid" 2>/dev/null || true
}

stop_pid_file() {
  local label="$1"
  local file="$2"
  local pid=""
  if [[ -f "$file" ]]; then
    pid="$(tr -d '[:space:]' < "$file" 2>/dev/null || true)"
  fi
  stop_pid "$label" "$pid"
}

stop_pid_file "embedding service" "$RUNTIME_DIR/embedding.pid"
stop_pid_file "Cloudflare tunnel" "$RUNTIME_DIR/cloudflared.pid"

if [[ "$STOP_FALLBACK_SCAN" == "1" ]] && command -v pgrep >/dev/null 2>&1; then
  while read -r pid; do
    [[ -n "$pid" ]] && stop_pid "orphan embedding service" "$pid"
  done < <(pgrep -f "uvicorn app:app --host 0\.0\.0\.0 --port ${PORT}([[:space:]]|$)" || true)

  while read -r pid; do
    [[ -n "$pid" ]] && stop_pid "orphan Cloudflare tunnel" "$pid"
  done < <(pgrep -f "cloudflared tunnel .*--url http://127\.0\.0\.1:${PORT}([[:space:]]|$)" || true)
fi

if [[ -d "$RUNTIME_DIR" ]]; then
  echo "Purging Colab runtime state: $RUNTIME_DIR"
  rm -rf -- "$RUNTIME_DIR"
fi

hf_cache="${HF_HOME:-${HOME:-/root}/.cache/huggingface}"
echo "Hugging Face model cache preserved: $hf_cache"
echo "Qwen embedding service and Cloudflare tunnel are stopped; Colab runtime data is clean."
