#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EMBED_DIR="$ROOT_DIR/embedding-service"
RUNTIME_DIR="${RUNTIME_DIR:-$ROOT_DIR/.runtime/colab-qwen3}"
SPAWN_HELPER="$ROOT_DIR/scripts/colab/spawn-detached.py"
PORT="${EMBEDDING_PORT:-8001}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"
START_TUNNEL="${START_TUNNEL:-1}"
STARTUP_ATTEMPTS="${EMBEDDING_STARTUP_ATTEMPTS:-600}"
TUNNEL_STARTUP_ATTEMPTS="${TUNNEL_STARTUP_ATTEMPTS:-60}"
TUNNEL_STARTUP_INTERVAL_SECONDS="${TUNNEL_STARTUP_INTERVAL_SECONDS:-1}"

mkdir -p "$RUNTIME_DIR"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "ERROR: NVIDIA GPU is required. Enable a T4 GPU runtime in Colab." >&2
  exit 1
fi

if ! nvidia-smi >/dev/null 2>&1; then
  echo "ERROR: nvidia-smi cannot access the GPU." >&2
  exit 1
fi

echo "== GPU =="
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

if [[ "$INSTALL_DEPS" == "1" ]]; then
  python -m pip install -q -r "$EMBED_DIR/requirements.txt"
fi

export EMBEDDING_MODEL="${EMBEDDING_MODEL:-Qwen/Qwen3-Embedding-4B}"
export EMBEDDING_PROFILE="${EMBEDDING_PROFILE:-qwen3}"
export EMBEDDING_DIMENSION="${EMBEDDING_DIMENSION:-2560}"
export EMBEDDING_DEVICE="${EMBEDDING_DEVICE:-cuda}"
export EMBEDDING_DTYPE="${EMBEDDING_DTYPE:-float16}"
export EMBEDDING_BATCH_SIZE="${EMBEDDING_BATCH_SIZE:-8}"
export EMBEDDING_MAX_SEQ_LENGTH="${EMBEDDING_MAX_SEQ_LENGTH:-512}"
export ENABLE_TRANSLATION="${ENABLE_TRANSLATION:-false}"

EMBED_LOG="$RUNTIME_DIR/embedding.log"
EMBED_PID_FILE="$RUNTIME_DIR/embedding.pid"

if [[ -f "$EMBED_PID_FILE" ]]; then
  old_pid="$(cat "$EMBED_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "Stopping previous embedding service PID $old_pid"
    kill "$old_pid" || true
    sleep 1
  fi
fi

if [[ ! -x "$SPAWN_HELPER" ]]; then
  echo "ERROR: detached process helper is missing or not executable: $SPAWN_HELPER" >&2
  exit 1
fi

: > "$EMBED_LOG"
embed_pid="$(python3 "$SPAWN_HELPER" \
  --cwd "$EMBED_DIR" \
  --log "$EMBED_LOG" \
  -- python -m uvicorn app:app --host 0.0.0.0 --port "$PORT")"
echo "$embed_pid" > "$EMBED_PID_FILE"

echo "Embedding service PID: $embed_pid"
echo "Embedding log: $EMBED_LOG"

ready=0
for _ in $(seq 1 "$STARTUP_ATTEMPTS"); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$embed_pid" 2>/dev/null; then
    echo "ERROR: embedding service exited during startup." >&2
    tail -100 "$EMBED_LOG" >&2 || true
    exit 1
  fi
  sleep 2
done

if [[ "$ready" != "1" ]]; then
  echo "ERROR: embedding service did not become ready." >&2
  tail -100 "$EMBED_LOG" >&2 || true
  exit 1
fi

echo "== /model =="
curl -fsS "http://127.0.0.1:${PORT}/model"
echo

if [[ "$START_TUNNEL" != "1" ]]; then
  echo "Embedding service is ready at http://127.0.0.1:${PORT}"
  exit 0
fi

if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED_BIN="$(command -v cloudflared)"
elif [[ -x "$RUNTIME_DIR/cloudflared" ]]; then
  CLOUDFLARED_BIN="$RUNTIME_DIR/cloudflared"
else
  echo "Installing cloudflared quick-tunnel client..."
  curl -fL --retry 3 \
    -o "$RUNTIME_DIR/cloudflared" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$RUNTIME_DIR/cloudflared"
  CLOUDFLARED_BIN="$RUNTIME_DIR/cloudflared"
fi

TUNNEL_LOG="$RUNTIME_DIR/cloudflared.log"
TUNNEL_PID_FILE="$RUNTIME_DIR/cloudflared.pid"
TUNNEL_URL_FILE="$RUNTIME_DIR/cloudflared.url"

if [[ -f "$TUNNEL_PID_FILE" ]]; then
  old_tunnel_pid="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_tunnel_pid" ]] && kill -0 "$old_tunnel_pid" 2>/dev/null; then
    echo "Stopping previous Cloudflare tunnel PID $old_tunnel_pid"
    kill "$old_tunnel_pid" || true
    sleep 1
  fi
fi

rm -f "$TUNNEL_URL_FILE"
: > "$TUNNEL_LOG"

echo "Starting Cloudflare Quick Tunnel for development/benchmark use only."
tunnel_pid="$(python3 "$SPAWN_HELPER" \
  --log "$TUNNEL_LOG" \
  -- "$CLOUDFLARED_BIN" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}")"
echo "$tunnel_pid" > "$TUNNEL_PID_FILE"

echo "Cloudflare tunnel PID: $tunnel_pid"
echo "Cloudflare log: $TUNNEL_LOG"

tunnel_url=""
for _ in $(seq 1 "$TUNNEL_STARTUP_ATTEMPTS"); do
  tunnel_url="$(grep -Eo 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n1 || true)"
  if [[ -n "$tunnel_url" ]]; then
    break
  fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "ERROR: Cloudflare tunnel exited before publishing a URL." >&2
    tail -100 "$TUNNEL_LOG" >&2 || true
    exit 1
  fi
  sleep "$TUNNEL_STARTUP_INTERVAL_SECONDS"
done

if [[ -z "$tunnel_url" ]]; then
  echo "ERROR: Cloudflare tunnel did not publish a trycloudflare.com URL." >&2
  tail -100 "$TUNNEL_LOG" >&2 || true
  kill "$tunnel_pid" 2>/dev/null || true
  exit 1
fi

printf '%s\n' "$tunnel_url" > "$TUNNEL_URL_FILE"

echo "== Cloudflare Quick Tunnel =="
echo "Embedding URL: $tunnel_url"
echo "Saved URL: $TUNNEL_URL_FILE"
echo "The embedding service and tunnel are running in the background."
echo "This cell can now return; keep the Colab runtime alive while Node.js uses the endpoint."
echo "Track embedding work: curl -fsS http://127.0.0.1:${PORT}/stats | jq ."
echo "Follow embedding log: tail -f $EMBED_LOG"
