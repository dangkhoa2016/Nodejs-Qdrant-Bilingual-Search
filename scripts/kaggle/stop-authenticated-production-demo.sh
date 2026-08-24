#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PUBLIC_RUNTIME_DIR="${DEMO_PUBLIC_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/production-demo-public}"
stop_owned() {
  local name="$1" needle="$2" file="$PUBLIC_RUNTIME_DIR/$name.pid" pid cmd
  [[ -s "$file" ]] || { echo "$name=already-stopped"; return 0; }
  pid="$(tr -d '[:space:]' < "$file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ "$cmd" == *"$needle"* ]] || { echo "ERROR: refusing to stop unrelated PID $pid" >&2; exit 1; }
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
  echo "$name=stopped"
}
stop_owned cloudflared cloudflared
stop_owned auth-gateway production-demo-auth-gateway.mjs
rm -f "$PUBLIC_RUNTIME_DIR/public.url"
