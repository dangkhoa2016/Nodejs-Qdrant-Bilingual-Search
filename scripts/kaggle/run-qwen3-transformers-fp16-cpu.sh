#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
RESOLVER="$SCRIPT_DIR/resolve-qwen3-transformers-input.mjs"
NODE_BOOTSTRAP="$SCRIPT_DIR/ensure-node22.sh"

# run.sh and the resolver both execute JavaScript, so establish the repository
# Node >=22 contract before either of them can run.
# shellcheck source=/dev/null
source "$NODE_BOOTSTRAP"

require_exact_or_unset() {
  local key="$1" expected="$2" current="${!1-}"
  if [[ -n "$current" && "$current" != "$expected" ]]; then
    printf 'ERROR: %s=%q but this Kaggle profile requires %q\n' "$key" "$current" "$expected" >&2
    exit 64
  fi
  printf -v "$key" '%s' "$expected"
  export "$key"
}

require_exact_or_unset HOST '127.0.0.1'
require_exact_or_unset EMBEDDING_MODEL 'Qwen/Qwen3-Embedding-4B'
require_exact_or_unset EMBEDDING_PROFILE 'qwen3'
require_exact_or_unset EMBEDDING_DIMENSION '2560'
require_exact_or_unset EMBEDDING_DEVICE 'cpu'
require_exact_or_unset EMBEDDING_DTYPE 'float16'
require_exact_or_unset EMBEDDING_BATCH_SIZE '1'
require_exact_or_unset EMBEDDING_MAX_SEQ_LENGTH '512'
require_exact_or_unset EMBEDDING_TRANSPORT 'binary-f32'
require_exact_or_unset MAX_CONCURRENT_INFERENCE '1'
require_exact_or_unset UVICORN_WORKERS '1'
require_exact_or_unset WARMUP_ON_STARTUP 'true'

export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export ENABLE_TRANSLATION="${ENABLE_TRANSLATION:-false}"
export KAGGLE_INPUT_ROOT="${KAGGLE_INPUT_ROOT:-/kaggle/input}"

MODEL_PATH="$(node "$RESOLVER" --path-only)"
export EMBEDDING_MODEL_PATH="$MODEL_PATH"

print_contract() {
  cat <<EOF_CONTRACT
QWEN3_TRANSFORMERS_VARIATION=transformers/default
HOST=$HOST
EMBEDDING_MODEL=$EMBEDDING_MODEL
EMBEDDING_MODEL_PATH=$EMBEDDING_MODEL_PATH
EMBEDDING_PROFILE=$EMBEDDING_PROFILE
EMBEDDING_DIMENSION=$EMBEDDING_DIMENSION
EMBEDDING_DEVICE=$EMBEDDING_DEVICE
EMBEDDING_DTYPE=$EMBEDDING_DTYPE
EMBEDDING_BATCH_SIZE=$EMBEDDING_BATCH_SIZE
EMBEDDING_MAX_SEQ_LENGTH=$EMBEDDING_MAX_SEQ_LENGTH
EMBEDDING_TRANSPORT=$EMBEDDING_TRANSPORT
MAX_CONCURRENT_INFERENCE=$MAX_CONCURRENT_INFERENCE
UVICORN_WORKERS=$UVICORN_WORKERS
WARMUP_ON_STARTUP=$WARMUP_ON_STARTUP
HF_HUB_OFFLINE=$HF_HUB_OFFLINE
TRANSFORMERS_OFFLINE=$TRANSFORMERS_OFFLINE
EOF_CONTRACT
}

print_contract

if [[ "${QWEN3_TRANSFORMERS_DRY_RUN:-0}" == "1" ]]; then
  exit 0
fi

exec "$PROJECT_ROOT/run.sh" "$@"
