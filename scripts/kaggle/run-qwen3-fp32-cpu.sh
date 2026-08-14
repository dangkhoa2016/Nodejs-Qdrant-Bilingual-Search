#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
RESOLVER="$SCRIPT_DIR/resolve-qwen3-fp32-input.mjs"

[[ -f "$PROJECT_ROOT/run.sh" || "${QWEN3_FP32_DRY_RUN:-0}" == "1" ]] || {
  echo "ERROR: project run.sh not found under $PROJECT_ROOT" >&2
  exit 64
}
[[ -r "$RESOLVER" ]] || { echo "ERROR: resolver missing or unreadable: $RESOLVER" >&2; exit 64; }

require_exact_or_unset() {
  local key="$1" expected="$2" actual
  actual="${!key:-}"
  if [[ -n "$actual" && "$actual" != "$expected" ]]; then
    echo "ERROR: $key=$actual conflicts with the Qwen3 CPU true-FP32 contract (expected $expected)." >&2
    exit 65
  fi
  printf -v "$key" '%s' "$expected"
  export "$key"
}

require_exact_or_unset EMBEDDING_MODEL 'Qwen/Qwen3-Embedding-4B'
require_exact_or_unset EMBEDDING_PROFILE 'qwen3'
require_exact_or_unset EMBEDDING_DIMENSION '2560'
require_exact_or_unset EMBEDDING_DEVICE 'cpu'
require_exact_or_unset EMBEDDING_DTYPE 'float32'
require_exact_or_unset EMBEDDING_TRANSPORT 'binary-f32'
require_exact_or_unset EMBEDDING_BATCH_SIZE '1'
require_exact_or_unset EMBEDDING_MAX_SEQ_LENGTH '512'

export EMBEDDING_REQUEST_TIMEOUT_MS="${EMBEDDING_REQUEST_TIMEOUT_MS:-120000}"
export DEMO_STARTUP_ATTEMPTS="${DEMO_STARTUP_ATTEMPTS:-900}"
export DEMO_STARTUP_INTERVAL_SECONDS="${DEMO_STARTUP_INTERVAL_SECONDS:-1}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export ENABLE_TRANSLATION="${ENABLE_TRANSLATION:-false}"

MODEL_PATH="$(node "$RESOLVER" --path-only)"
export EMBEDDING_MODEL_PATH="$MODEL_PATH"

print_contract() {
  cat <<EOF_CONTRACT
QWEN3_FP32_VARIATION=pytorch/fp32/1
EMBEDDING_MODEL=$EMBEDDING_MODEL
EMBEDDING_MODEL_PATH=$EMBEDDING_MODEL_PATH
EMBEDDING_PROFILE=$EMBEDDING_PROFILE
EMBEDDING_DIMENSION=$EMBEDDING_DIMENSION
EMBEDDING_DEVICE=$EMBEDDING_DEVICE
EMBEDDING_DTYPE=$EMBEDDING_DTYPE
EMBEDDING_BATCH_SIZE=$EMBEDDING_BATCH_SIZE
EMBEDDING_MAX_SEQ_LENGTH=$EMBEDDING_MAX_SEQ_LENGTH
  EMBEDDING_TRANSPORT=$EMBEDDING_TRANSPORT
  EMBEDDING_REQUEST_TIMEOUT_MS=$EMBEDDING_REQUEST_TIMEOUT_MS
  DEMO_STARTUP_ATTEMPTS=$DEMO_STARTUP_ATTEMPTS
  DEMO_STARTUP_INTERVAL_SECONDS=$DEMO_STARTUP_INTERVAL_SECONDS
  HF_HUB_OFFLINE=$HF_HUB_OFFLINE
  TRANSFORMERS_OFFLINE=$TRANSFORMERS_OFFLINE
EOF_CONTRACT
}

print_contract

if [[ "${QWEN3_FP32_DRY_RUN:-0}" == "1" ]]; then
  exit 0
fi

exec "$PROJECT_ROOT/run.sh" "$@"
