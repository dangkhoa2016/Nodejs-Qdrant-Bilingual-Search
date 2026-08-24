#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"

# Reuse the production-demo ownership model: only processes whose PID/signature
# files prove project ownership are stopped. External/reused services are left
# untouched by demo_stop and must continue to block snapshot restore.
# shellcheck source=/dev/null
source "$PROJECT_ROOT/scripts/demo/lifecycle.sh"

demo_stop

if curl -fsS --max-time 2 "$QDRANT_URL/" >/dev/null 2>&1; then
  printf 'ERROR: port 6333 is still serving after owned-process cleanup; refusing snapshot restore\n' >&2
  exit 1
fi

echo 'QDRANT_PORT_6333=CLEAN'
echo 'QDRANT_PRE_RESTORE_OWNED_CLEANUP=PASS'
