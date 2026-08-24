#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

QDRANT_VERSION="${QDRANT_VERSION:-1.18.3}"
QDRANT_COLLECTION="${QDRANT_COLLECTION:-knowledge_entities_qwen3_4b_text_v21}"
QDRANT_STORAGE_PATH="${QDRANT_STORAGE_PATH:-/kaggle/working/qdrant-bilingual-search/qdrant-data}"
QDRANT_RUNTIME_ROOT="${QDRANT_RUNTIME_ROOT:-/kaggle/working/qdrant-bilingual-search/snapshot-restore-runtime}"
QDRANT_SNAPSHOTS_PATH="${QDRANT_SNAPSHOTS_PATH:-$QDRANT_RUNTIME_ROOT/snapshots}"
QDRANT_TEMP_PATH="${QDRANT_TEMP_PATH:-$QDRANT_RUNTIME_ROOT/tmp}"
QDRANT_BIN="${QDRANT_BIN:-$QDRANT_RUNTIME_ROOT/bin/qdrant}"
SNAPSHOT_NAME="${SNAPSHOT_NAME:-knowledge_entities_qwen3_4b_text_v21-20260827T013824Z.snapshot}"
SNAPSHOT_BYTES="${SNAPSHOT_BYTES:-283812352}"
SNAPSHOT_SHA256="${SNAPSHOT_SHA256:-71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f}"
QDRANT_URL="http://127.0.0.1:6333"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

for cmd in curl find sha256sum stat awk grep sed tar timeout python3; do
  have "$cmd" || die "required command missing: $cmd"
done

canonical_storage_path="$(python3 - "$QDRANT_STORAGE_PATH" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).resolve(strict=False))
PY
)"
case "$canonical_storage_path" in
  /kaggle/working/*) ;;
  *) die "QDRANT_STORAGE_PATH must be under /kaggle/working" ;;
esac

if [[ "${QDRANT_PATH_VALIDATION_ONLY:-0}" == "1" ]]; then
  echo "QDRANT_STORAGE_PATH_CANONICAL=$canonical_storage_path"
  echo "QDRANT_STORAGE_PATH_VALIDATION=PASS"
  exit 0
fi

bash "$SCRIPT_DIR/prepare-canonical-qdrant-restore.sh"

if curl -fsS --max-time 2 "$QDRANT_URL/" >/dev/null 2>&1; then
  die "port 6333 is already serving; stop the existing Qdrant before snapshot restore"
fi

mapfile -t snapshots < <(
  find /kaggle/input -type f -name "$SNAPSHOT_NAME" -print 2>/dev/null | LC_ALL=C sort
)
[[ "${#snapshots[@]}" -eq 1 ]] || {
  printf 'Found %d matching snapshots:\n' "${#snapshots[@]}" >&2
  printf '%s\n' "${snapshots[@]:-}" >&2
  die "expected exactly one canonical snapshot under /kaggle/input"
}
SNAPSHOT="${snapshots[0]}"

actual_bytes="$(stat -c '%s' "$SNAPSHOT")"
[[ "$actual_bytes" == "$SNAPSHOT_BYTES" ]] \
  || die "snapshot byte size mismatch: $actual_bytes != $SNAPSHOT_BYTES"

actual_sha="$(sha256sum "$SNAPSHOT" | awk '{print $1}')"
[[ "$actual_sha" == "$SNAPSHOT_SHA256" ]] \
  || die "snapshot SHA-256 mismatch: $actual_sha != $SNAPSHOT_SHA256"

sidecar="${SNAPSHOT}.sha256"
[[ -f "$sidecar" ]] || die "snapshot sidecar missing: $sidecar"
sidecar_sha="$(awk 'NF{print $1; exit}' "$sidecar")"
[[ "$sidecar_sha" == "$SNAPSHOT_SHA256" ]] || die "snapshot sidecar SHA-256 mismatch"

mkdir -p "$QDRANT_RUNTIME_ROOT/bin"
if [[ ! -x "$QDRANT_BIN" ]] || ! "$QDRANT_BIN" --version 2>&1 | grep -Eq "qdrant[[:space:]]+v?${QDRANT_VERSION}"; then
  archive="$QDRANT_RUNTIME_ROOT/qdrant.tar.gz"
  extract="$QDRANT_RUNTIME_ROOT/extract"
  rm -rf "$extract"
  mkdir -p "$extract"
  curl -fL --retry 3 --retry-delay 2 \
    -o "$archive" \
    "https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-musl.tar.gz"
  tar -xzf "$archive" -C "$extract" qdrant
  install -m 0755 "$extract/qdrant" "$QDRANT_BIN"
  rm -rf "$archive" "$extract"
fi
"$QDRANT_BIN" --version 2>&1 | grep -Eq "qdrant[[:space:]]+v?${QDRANT_VERSION}" \
  || die "Qdrant binary is not v${QDRANT_VERSION}"

rm -rf "$QDRANT_STORAGE_PATH"
mkdir -p \
  "$QDRANT_STORAGE_PATH" \
  "$QDRANT_RUNTIME_ROOT/logs" \
  "$QDRANT_SNAPSHOTS_PATH" \
  "$QDRANT_TEMP_PATH"

export QDRANT__STORAGE__STORAGE_PATH="$QDRANT_STORAGE_PATH"
export QDRANT__STORAGE__SNAPSHOTS_PATH="$QDRANT_SNAPSHOTS_PATH"
export QDRANT__STORAGE__TEMP_PATH="$QDRANT_TEMP_PATH"
export QDRANT__SERVICE__HOST="127.0.0.1"
export QDRANT__SERVICE__HTTP_PORT="6333"
LOG="$QDRANT_RUNTIME_ROOT/logs/restore-qdrant.log"

"$QDRANT_BIN" >"$LOG" 2>&1 &
pid=$!

cleanup() {
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || return 0
      sleep 1
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 120); do
  if curl -fsS --max-time 3 "$QDRANT_URL/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
[[ "$ready" == "1" ]] || {
  tail -120 "$LOG" >&2 || true
  die "temporary Qdrant did not become ready"
}

root_json="$QDRANT_RUNTIME_ROOT/qdrant-root.json"
curl -fsS "$QDRANT_URL/" > "$root_json"
python3 - "$root_json" "$QDRANT_VERSION" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
actual=d.get("version")
expected=sys.argv[2]
if actual != expected:
    raise SystemExit(f"Qdrant version mismatch: {actual} != {expected}")
print("QDRANT_VERSION=PASS")
PY

response="$QDRANT_RUNTIME_ROOT/snapshot-upload-response.json"
curl -fSs --connect-timeout 10 --max-time 1800 -X POST \
  "$QDRANT_URL/collections/${QDRANT_COLLECTION}/snapshots/upload?wait=true&priority=snapshot" \
  -F "snapshot=@${SNAPSHOT}" > "$response"

collection="$QDRANT_RUNTIME_ROOT/collection-restored.json"
verified=0
for _ in $(seq 1 300); do
  if curl -fsS --max-time 5 \
      "$QDRANT_URL/collections/${QDRANT_COLLECTION}" > "$collection" 2>/dev/null; then
    if python3 - "$collection" <<'PY' >/dev/null 2>&1
import json, sys
r=(json.load(open(sys.argv[1])).get("result") or {})
v=(((r.get("config") or {}).get("params") or {}).get("vectors") or {})
assert r.get("status") == "green"
assert r.get("points_count") == 20000
assert r.get("indexed_vectors_count") == 20000
assert v.get("size") == 2560
assert v.get("distance") == "Cosine"
PY
    then
      verified=1
      break
    fi
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done

[[ "$verified" == "1" ]] || {
  [[ -s "$collection" ]] && cat "$collection" >&2 || true
  tail -120 "$LOG" >&2 || true
  die "restored collection did not reach canonical 20K invariants"
}

python3 - "$collection" <<'PY'
import json, sys
r=(json.load(open(sys.argv[1])).get("result") or {})
v=(((r.get("config") or {}).get("params") or {}).get("vectors") or {})
print("QDRANT_COLLECTION="+str(r.get("status")))
print("QDRANT_POINTS="+str(r.get("points_count")))
print("QDRANT_INDEXED_VECTORS="+str(r.get("indexed_vectors_count")))
print("QDRANT_VECTOR_SIZE="+str(v.get("size")))
print("QDRANT_DISTANCE="+str(v.get("distance")))
PY

echo "SNAPSHOT_PATH=$SNAPSHOT"
echo "SNAPSHOT_BYTES=$actual_bytes"
echo "SNAPSHOT_SHA256=$actual_sha"
echo "RESEED_PERFORMED=NO"
echo "QDRANT_SNAPSHOT_RESTORE=PASS"

cleanup
trap - EXIT

if curl -fsS --max-time 2 "$QDRANT_URL/" >/dev/null 2>&1; then
  die "temporary restore Qdrant is still serving after shutdown"
fi
