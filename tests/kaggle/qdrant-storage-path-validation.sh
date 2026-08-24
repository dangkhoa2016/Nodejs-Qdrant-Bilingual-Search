#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/kaggle/restore-canonical-qdrant-snapshot.sh"

sudo mkdir -p /kaggle/working
fresh="/kaggle/working/qdrant-path-regression-$$/qdrant-data"
rm -rf "$(dirname "$fresh")"

if QDRANT_PATH_VALIDATION_ONLY=1 QDRANT_STORAGE_PATH="$fresh" bash "$SCRIPT" >/tmp/qdrant-path-valid.out 2>/tmp/qdrant-path-valid.err; then
  echo "PASS fresh missing-parent path accepted"
else
  cat /tmp/qdrant-path-valid.out /tmp/qdrant-path-valid.err >&2 || true
  echo "FAIL fresh missing-parent path was rejected" >&2
  exit 1
fi

if QDRANT_PATH_VALIDATION_ONLY=1 QDRANT_STORAGE_PATH="/tmp/qdrant-escape-$$/qdrant-data" bash "$SCRIPT" >/tmp/qdrant-path-invalid.out 2>/tmp/qdrant-path-invalid.err; then
  echo "FAIL outside path was accepted" >&2
  exit 1
else
  grep -F "QDRANT_STORAGE_PATH must be under /kaggle/working" /tmp/qdrant-path-invalid.err >/dev/null
  echo "PASS outside path rejected"
fi
