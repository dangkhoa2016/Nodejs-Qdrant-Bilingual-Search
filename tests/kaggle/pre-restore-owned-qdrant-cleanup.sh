#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="$ROOT/scripts/kaggle/prepare-canonical-qdrant-restore.sh"
RESTORE="$ROOT/scripts/kaggle/restore-canonical-qdrant-snapshot.sh"
RUNTIME="$ROOT/.runtime/production-demo"
LOG_DIR="$ROOT/logs/production-demo"
PORT=6333
SERVER_LOG="$(mktemp)"
EXTERNAL_LOG="$(mktemp)"
owned_pid=""
external_pid=""

cleanup() {
  if [[ -n "$owned_pid" ]]; then kill "$owned_pid" 2>/dev/null || true; fi
  if [[ -n "$external_pid" ]]; then kill "$external_pid" 2>/dev/null || true; fi
  rm -f "$SERVER_LOG" "$EXTERNAL_LOG"
  rm -rf "$RUNTIME" "$LOG_DIR"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }
wait_http() {
  local ok=0
  for _ in $(seq 1 50); do
    if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.1
  done
  [[ "$ok" == "1" ]]
}

[[ -f "$HELPER" ]] || fail "pre-restore helper missing: $HELPER"
[[ -f "$RESTORE" ]] || fail "snapshot restore helper missing: $RESTORE"

helper_line="$(grep -nF 'bash "$SCRIPT_DIR/prepare-canonical-qdrant-restore.sh"' "$RESTORE" | head -1 | cut -d: -f1 || true)"
guard_line="$(grep -nF 'if curl -fsS --max-time 2 "$QDRANT_URL/"' "$RESTORE" | head -1 | cut -d: -f1 || true)"
[[ "$helper_line" =~ ^[0-9]+$ ]] || fail 'snapshot restore does not invoke pre-restore owned cleanup'
[[ "$guard_line" =~ ^[0-9]+$ ]] || fail 'snapshot restore lost its fail-closed port guard'
(( helper_line < guard_line )) || fail 'pre-restore owned cleanup must run before the port 6333 guard'
pass 'snapshot restore invokes owned cleanup before fail-closed port guard'

rm -rf "$RUNTIME" "$LOG_DIR"
mkdir -p "$RUNTIME" "$LOG_DIR"
python3 -m http.server "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
owned_pid=$!
wait_http || fail 'owned fake Qdrant did not become ready'
printf '%s\n' "$owned_pid" > "$RUNTIME/qdrant.pid"
printf '%s\n' 'http.server 6333' > "$RUNTIME/qdrant.sig"

DEMO_PUBLIC=0 bash "$HELPER"
if kill -0 "$owned_pid" 2>/dev/null; then fail 'project-owned service survived pre-restore cleanup'; fi
owned_pid=""
if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then fail 'port 6333 is still serving after owned cleanup'; fi
pass 'project-owned listener is stopped before restore'

rm -rf "$RUNTIME" "$LOG_DIR"
python3 -m http.server "$PORT" --bind 127.0.0.1 >"$EXTERNAL_LOG" 2>&1 &
external_pid=$!
wait_http || fail 'external fake Qdrant did not become ready'

set +e
DEMO_PUBLIC=0 bash "$HELPER" >/tmp/pre-restore-external.out 2>/tmp/pre-restore-external.err
rc=$?
set -e
[[ "$rc" -ne 0 ]] || fail 'pre-restore helper accepted an external listener on port 6333'
kill -0 "$external_pid" 2>/dev/null || fail 'pre-restore helper killed an external listener'
curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || fail 'external listener disappeared unexpectedly'
grep -F 'port 6333 is still serving after owned-process cleanup' /tmp/pre-restore-external.err >/dev/null \
  || fail 'external-listener failure was not explicit/fail-closed'
pass 'external listener remains untouched and blocks restore'

rm -f /tmp/pre-restore-external.out /tmp/pre-restore-external.err
