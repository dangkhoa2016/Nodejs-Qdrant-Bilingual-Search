#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/kaggle/restore-canonical-qdrant-snapshot.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

grep -F 'QDRANT_SNAPSHOTS_PATH="${QDRANT_SNAPSHOTS_PATH:-$QDRANT_RUNTIME_ROOT/snapshots}"' "$SCRIPT" >/dev/null \
  || fail 'restore helper does not define an external snapshots path'
grep -F 'QDRANT_TEMP_PATH="${QDRANT_TEMP_PATH:-$QDRANT_RUNTIME_ROOT/tmp}"' "$SCRIPT" >/dev/null \
  || fail 'restore helper does not define an external temp path'
grep -F 'export QDRANT__STORAGE__SNAPSHOTS_PATH="$QDRANT_SNAPSHOTS_PATH"' "$SCRIPT" >/dev/null \
  || fail 'restore helper does not export Qdrant snapshots path'
grep -F 'export QDRANT__STORAGE__TEMP_PATH="$QDRANT_TEMP_PATH"' "$SCRIPT" >/dev/null \
  || fail 'restore helper does not export Qdrant temp path'

python3 - "$SCRIPT" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text(encoding='utf-8')
for forbidden in [
    'PROJECT_ROOT/snapshots',
    '$PROJECT_ROOT/snapshots',
    './snapshots',
]:
    if forbidden in text:
        raise SystemExit(f'FAIL: repository-local snapshot path remains in restore helper: {forbidden}')
if 'mkdir -p' not in text or '"$QDRANT_SNAPSHOTS_PATH"' not in text or '"$QDRANT_TEMP_PATH"' not in text:
    raise SystemExit('FAIL: restore helper does not create external snapshots/temp directories')
print('PASS: restore helper keeps Qdrant snapshots/temp runtime state outside source checkout')
PY

pass 'Qdrant runtime snapshot-path hygiene contract'
