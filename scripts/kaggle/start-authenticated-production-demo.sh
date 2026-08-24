#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
NODE_BOOTSTRAP="$SCRIPT_DIR/ensure-node22.sh"
SPAWN_HELPER="$PROJECT_ROOT/scripts/colab/spawn-detached.py"
PUBLIC_RUNTIME_DIR="${DEMO_PUBLIC_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/production-demo-public}"
PUBLIC_LOG_DIR="${DEMO_PUBLIC_LOG_DIR:-$PROJECT_ROOT/logs/production-demo-public}"
BIN_DIR="$PUBLIC_RUNTIME_DIR/bin"
TOKEN_FILE="$PUBLIC_RUNTIME_DIR/demo-token"
GATEWAY_PID_FILE="$PUBLIC_RUNTIME_DIR/auth-gateway.pid"
TUNNEL_PID_FILE="$PUBLIC_RUNTIME_DIR/cloudflared.pid"
PUBLIC_URL_FILE="$PUBLIC_RUNTIME_DIR/public.url"
GATEWAY_LOG="$PUBLIC_LOG_DIR/auth-gateway.log"
TUNNEL_LOG="$PUBLIC_LOG_DIR/cloudflared.log"
mkdir -p "$PUBLIC_RUNTIME_DIR" "$PUBLIC_LOG_DIR" "$BIN_DIR"
chmod 700 "$PUBLIC_RUNTIME_DIR"
# shellcheck source=/dev/null
source "$NODE_BOOTSTRAP"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
stop_pid_file() {
  local file="$1" needle="$2" pid cmd
  [[ -s "$file" ]] || return 0
  pid="$(tr -d '[:space:]' < "$file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ "$cmd" == *"$needle"* ]] || fail "refusing to stop unrelated PID $pid"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}
curl -fsS --max-time 5 http://127.0.0.1:3000/ready >/dev/null || fail 'Node API is not ready at 127.0.0.1:3000'
stop_pid_file "$TUNNEL_PID_FILE" cloudflared
stop_pid_file "$GATEWAY_PID_FILE" production-demo-auth-gateway.mjs
rm -f "$PUBLIC_URL_FILE"
if [[ ! -s "$TOKEN_FILE" ]]; then
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24 > "$TOKEN_FILE"; else python3 - <<'PY' > "$TOKEN_FILE"
import secrets
print(secrets.token_hex(24))
PY
  fi
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"
[[ "${#TOKEN}" -ge 32 ]] || fail 'generated Bearer token is too short'
export DEMO_BEARER_TOKEN="$TOKEN" DEMO_GATEWAY_HOST=127.0.0.1 DEMO_GATEWAY_PORT=8090 DEMO_GATEWAY_UPSTREAM=http://127.0.0.1:3000
export DEMO_MAX_SEARCH_CONCURRENT="${DEMO_MAX_SEARCH_CONCURRENT:-1}" DEMO_RATE_LIMIT_PER_MINUTE="${DEMO_RATE_LIMIT_PER_MINUTE:-30}" DEMO_BODY_LIMIT_BYTES="${DEMO_BODY_LIMIT_BYTES:-32768}" DEMO_UPSTREAM_TIMEOUT_MS="${DEMO_UPSTREAM_TIMEOUT_MS:-180000}" DEMO_ALLOWED_ORIGIN="${DEMO_ALLOWED_ORIGIN:-*}"
GATEWAY_PID="$(python3 "$SPAWN_HELPER" --cwd "$PROJECT_ROOT" --log "$GATEWAY_LOG" -- node scripts/kaggle/production-demo-auth-gateway.mjs)"
printf '%s\n' "$GATEWAY_PID" > "$GATEWAY_PID_FILE"
for _ in $(seq 1 30); do
  kill -0 "$GATEWAY_PID" 2>/dev/null || { tail -100 "$GATEWAY_LOG" >&2 || true; fail 'auth gateway exited'; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8090/health || true)" == 401 ]] && break
  sleep 1
done
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8090/health)" == 401 ]] || fail 'gateway does not enforce 401'
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8090/health)" == 200 ]] || fail 'authorized gateway health failed'
CLOUDFLARED="$BIN_DIR/cloudflared"
if [[ ! -x "$CLOUDFLARED" ]]; then
  curl -fL --retry 3 --retry-delay 2 -o "$CLOUDFLARED.tmp" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$CLOUDFLARED.tmp" && mv "$CLOUDFLARED.tmp" "$CLOUDFLARED"
fi
"$CLOUDFLARED" --version > "$PUBLIC_RUNTIME_DIR/cloudflared-version.txt" 2>&1
CF_HOME="$PUBLIC_RUNTIME_DIR/cloudflared-home"; mkdir -p "$CF_HOME"
HOME="$CF_HOME" python3 "$SPAWN_HELPER" --cwd "$PROJECT_ROOT" --log "$TUNNEL_LOG" -- "$CLOUDFLARED" tunnel --no-autoupdate --url http://127.0.0.1:8090 > "$TUNNEL_PID_FILE"
TUNNEL_PID="$(cat "$TUNNEL_PID_FILE")"
PUBLIC_URL=''
for _ in $(seq 1 90); do
  kill -0 "$TUNNEL_PID" 2>/dev/null || { tail -150 "$TUNNEL_LOG" >&2 || true; fail 'cloudflared exited before URL creation'; }
  PUBLIC_URL="$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1 || true)"
  [[ -n "$PUBLIC_URL" ]] && break
  sleep 1
done
[[ -n "$PUBLIC_URL" ]] || fail 'Quick Tunnel URL not found'
printf '%s\n' "$PUBLIC_URL" > "$PUBLIC_URL_FILE"
for _ in $(seq 1 30); do
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL/health" || true)" == 401 ]] && break
  sleep 2
done
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL/health")" == 401 ]] || fail 'public unauthenticated request is not 401'
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $TOKEN" "$PUBLIC_URL/health")" == 200 ]] || fail 'public authenticated health failed'
printf 'AUTH_GATEWAY=PASS\nUNAUTHENTICATED_REQUEST=401\nPUBLIC_TUNNEL_TARGET=http://127.0.0.1:8090\nPUBLIC_TUNNEL=PASS\nPUBLIC_URL=%s\nTOKEN_FILE=%s\n' "$PUBLIC_URL" "$TOKEN_FILE"
