#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 RUN_ROOT [REVIEW_DIR]" >&2
  echo "RUN_ROOT   directory holding node/, qdrant/, embedding/, memory/, tests/, result.json, SUMMARY.md" >&2
  echo "REVIEW_DIR target review directory (default: \$RUN_ROOT/review)" >&2
  exit 64
fi

RUN_ROOT="$(realpath "$1")"
REVIEW_DIR="$(realpath -m "${2:-$RUN_ROOT/review}")"
[[ -d "$RUN_ROOT" ]] || { echo "ERROR: RUN_ROOT not found: $RUN_ROOT" >&2; exit 66; }

mkdir -p "$REVIEW_DIR/node/sentinels"

copy_group() {
  local label="$1" src="$2" dst="$3"
  if [[ -d "$src" ]] && [[ -n "$(find "$src" -maxdepth 1 -type f -print -quit 2>/dev/null || true)" ]]; then
    mkdir -p "$dst"
    for entry in "$src"/*; do
      if [[ -f "$entry" ]]; then cp -f "$entry" "$dst/"; fi
    done
  else
    printf 'WARN: no %s files to assemble from %s\n' "$label" "$src" >&2
  fi
}
copy_group "node" "$RUN_ROOT/node" "$REVIEW_DIR/node"
if [[ -d "$RUN_ROOT/node/sentinels" ]]; then
  mkdir -p "$REVIEW_DIR/node/sentinels"
  for entry in "$RUN_ROOT/node/sentinels"/*; do
    if [[ -f "$entry" ]]; then cp -f "$entry" "$REVIEW_DIR/node/sentinels/"; fi
  done
fi
copy_group "qdrant" "$RUN_ROOT/qdrant" "$REVIEW_DIR/qdrant"
copy_group "embedding" "$RUN_ROOT/embedding" "$REVIEW_DIR/embedding"
copy_group "memory" "$RUN_ROOT/memory" "$REVIEW_DIR/memory"
copy_group "tests" "$RUN_ROOT/tests" "$REVIEW_DIR/tests"

for item in result.json SUMMARY.md; do
  if [[ -f "$RUN_ROOT/$item" ]]; then
    cp -f "$RUN_ROOT/$item" "$REVIEW_DIR/$item"
  else
    printf 'WARN: %s not found under RUN_ROOT; continuing without it\n' "$RUN_ROOT/$item" >&2
  fi
done

for f in thailand_en thailand_vi tokyo_vi beijing_vi; do
  if [[ ! -s "$REVIEW_DIR/node/sentinels/${f}.json" ]]; then
    echo "ERROR: required sentinel response missing or empty: node/sentinels/${f}.json" >&2
    exit 66
  fi
done

[[ -s "$REVIEW_DIR/node/api-sentinel-summary.json" ]] || {
  echo "ERROR: api-sentinel-summary.json missing or empty in review tree" >&2
  exit 66
}

node - "$REVIEW_DIR" <<'NODE' || { echo "ERROR: api-sentinel-summary.json references a response missing from the review tree" >&2; exit 66; }
const fs = require('fs')
const path = require('path')
const reviewDir = process.argv[2]
const summaryPath = path.join(reviewDir, 'node', 'api-sentinel-summary.json')
let summary
try {
  summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
} catch (error) {
  console.error(`ERROR: invalid api-sentinel-summary.json: ${error.message}`)
  process.exit(1)
}
const refs = []
if (summary && Array.isArray(summary.sentinels)) {
  for (const item of summary.sentinels) {
    if (item && typeof item.response === 'string') refs.push([item.id ?? '<sentinel>', item.response])
  }
}
if (summary && summary.responseFiles && typeof summary.responseFiles === 'object') {
  for (const [id, response] of Object.entries(summary.responseFiles)) {
    if (typeof response === 'string') refs.push([id, response])
  }
}
const missing = []
for (const [id, response] of refs) {
  const resolved = path.resolve(reviewDir, response)
  if (resolved !== reviewDir && !resolved.startsWith(`${reviewDir}${path.sep}`)) {
    missing.push(`${id}=${response} (outside review tree)`)
    continue
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).size === 0) {
    missing.push(`${id}=${response}`)
  }
}
if (missing.length) {
  console.error(`ERROR: summary references missing/empty responses: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`REFERENCE_CHECK_OK=${refs.length}`)
NODE

echo "REVIEW_DIR=$REVIEW_DIR"

echo "ASSEMBLED_REVIEW_EVIDENCE=OK"