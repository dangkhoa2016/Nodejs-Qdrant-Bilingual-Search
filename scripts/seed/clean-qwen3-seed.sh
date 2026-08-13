#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DATASET="data/generated/entities.final.json"
RUN_DIR="reports/qwen3-clean-seed"
CONFIRM_DELETE=""
SEED_HTTP_BATCH_SIZE="64"
DELETE_WAIT_ATTEMPTS="${DELETE_WAIT_ATTEMPTS:-30}"
DELETE_WAIT_INTERVAL_SECONDS="${DELETE_WAIT_INTERVAL_SECONDS:-1}"
SEED_STOP_WAIT_ATTEMPTS="${SEED_STOP_WAIT_ATTEMPTS:-20}"
SEED_STOP_WAIT_INTERVAL_SECONDS="${SEED_STOP_WAIT_INTERVAL_SECONDS:-0.25}"

usage() {
  cat <<'USAGE'
Usage:
  npm run seed:clean:qwen3 -- \
    --confirm-delete knowledge_entities_qwen3_4b_v1 \
    [--dataset data/generated/entities.final.json] \
    [--run-dir reports/qwen3-clean-seed] \
    [--seed-http-batch-size 64]

Destructive clean-seed workflow:
  1. Load .env when present.
  2. Require exact --confirm-delete match with QDRANT_COLLECTION.
  3. Refuse to delete the protected E5 baseline collection.
  4. DELETE the Qdrant collection using the `api-key` header when configured.
  5. Poll until Qdrant confirms the collection is absent (HTTP 404).
  6. Purge Qwen seed progress/run data only; preserve entities.final.json and E5 evidence.
  7. Verify the remote embedding /model contract.
  8. Run seed:existing from an empty collection with Node HTTP batch 64 by default.

The canonical 20k dataset is never deleted.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm-delete) CONFIRM_DELETE="${2:?--confirm-delete requires collection name}"; shift 2 ;;
    --dataset) DATASET="${2:?--dataset requires a path}"; shift 2 ;;
    --run-dir) RUN_DIR="${2:?--run-dir requires a path}"; shift 2 ;;
    --seed-http-batch-size) SEED_HTTP_BATCH_SIZE="${2:?--seed-http-batch-size requires an integer}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

declare -A explicit_env=()
for name in \
  QDRANT_PROVIDER QDRANT_URL QDRANT_API_KEY QDRANT_COLLECTION \
  QDRANT_LOCAL_URL QDRANT_LOCAL_API_KEY QDRANT_MODAL_URL QDRANT_MODAL_API_KEY \
  QDRANT_BEAM_URL QDRANT_BEAM_API_KEY \
  EMBEDDING_URL EMBEDDING_MODEL EMBEDDING_DIMENSION EMBEDDING_VERSION EMBEDDING_TEXT_VERSION EMBEDDING_TRANSPORT \
  EMBEDDING_REQUEST_TIMEOUT_MS DATASET_VERSION \
  SEED_PROGRESS_PATH SEED_PROGRESS_EVENTS_PATH SEED_PROGRESS_EVERY_BATCHES; do
  if [[ -v "$name" ]]; then
    explicit_env["$name"]="${!name}"
  fi
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Explicit shell/CI values must win over stale .env values, especially a newly
# issued trycloudflare.com EMBEDDING_URL.
for name in "${!explicit_env[@]}"; do
  export "$name=${explicit_env[$name]}"
done

command -v curl >/dev/null || { echo 'ERROR: curl is required' >&2; exit 1; }
command -v jq >/dev/null || { echo 'ERROR: jq is required' >&2; exit 1; }
command -v npm >/dev/null || { echo 'ERROR: npm is required' >&2; exit 1; }
command -v ps >/dev/null || { echo 'ERROR: ps is required to stop any previous seed safely' >&2; exit 1; }
command -v readlink >/dev/null || { echo 'ERROR: readlink is required to verify Node seed process identity safely' >&2; exit 1; }

provider="${QDRANT_PROVIDER:-local}"
upper="$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')"
url_var="QDRANT_${upper}_URL"
key_var="QDRANT_${upper}_API_KEY"
provider_url="${!url_var:-}"
provider_key="${!key_var:-}"
qdrant_url="${provider_url:-${QDRANT_URL:-}}"
qdrant_api_key="${provider_key:-${QDRANT_API_KEY:-}}"
collection="${QDRANT_COLLECTION:-}"
embedding_url="${EMBEDDING_URL:-}"
embedding_model="${EMBEDDING_MODEL:-}"
embedding_dimension="${EMBEDDING_DIMENSION:-}"
embedding_transport="${EMBEDDING_TRANSPORT:-json}"
progress_path="${SEED_PROGRESS_PATH:-reports/seed-progress.json}"
events_path="${SEED_PROGRESS_EVENTS_PATH:-reports/seed-progress.jsonl}"

if [[ -z "$qdrant_url" && "$provider" == "local" ]]; then
  qdrant_url='http://127.0.0.1:6333'
fi
qdrant_url="${qdrant_url%/}"
embedding_url="${embedding_url%/}"

[[ -n "$collection" ]] || { echo 'ERROR: QDRANT_COLLECTION must be explicitly set for destructive clean seed.' >&2; exit 1; }
[[ "$collection" != 'knowledge_entities_e5_real_v1' ]] || { echo 'ERROR: refusing to delete protected E5 baseline collection knowledge_entities_e5_real_v1.' >&2; exit 1; }
[[ -n "$CONFIRM_DELETE" ]] || { echo "ERROR: destructive clean seed requires --confirm-delete $collection" >&2; exit 1; }
[[ "$CONFIRM_DELETE" == "$collection" ]] || { echo "ERROR: --confirm-delete must exactly match QDRANT_COLLECTION ($collection)." >&2; exit 1; }
[[ -n "$qdrant_url" ]] || { echo "ERROR: Qdrant URL is required for provider '$provider'." >&2; exit 1; }
if [[ -z "$qdrant_api_key" ]]; then
  echo "ERROR: Qdrant API key is required for destructive clean seed (provider '$provider')." >&2
  exit 1
fi
[[ -n "$embedding_url" ]] || { echo 'ERROR: EMBEDDING_URL is required.' >&2; exit 1; }
[[ -n "$embedding_model" ]] || { echo 'ERROR: EMBEDDING_MODEL is required.' >&2; exit 1; }
[[ -n "$embedding_dimension" && "$embedding_dimension" =~ ^[0-9]+$ ]] || { echo 'ERROR: EMBEDDING_DIMENSION must be a positive integer.' >&2; exit 1; }
[[ "$embedding_transport" == 'json' || "$embedding_transport" == 'binary-f32' ]] || { echo 'ERROR: EMBEDDING_TRANSPORT must be json or binary-f32.' >&2; exit 1; }
[[ "$SEED_HTTP_BATCH_SIZE" =~ ^[0-9]+$ && "$SEED_HTTP_BATCH_SIZE" -ge 1 && "$SEED_HTTP_BATCH_SIZE" -le 256 ]] || { echo 'ERROR: --seed-http-batch-size must be between 1 and 256.' >&2; exit 1; }
[[ -f "$DATASET" ]] || { echo "ERROR: canonical dataset not found: $DATASET" >&2; exit 1; }

curl_args=(-sS)
if [[ -n "$qdrant_api_key" ]]; then
  curl_args+=(-H "api-key: $qdrant_api_key")
fi

http_request() {
  local method="$1"
  local url="$2"
  local output="$3"
  curl "${curl_args[@]}" -X "$method" -o "$output" -w '%{http_code}' "$url"
}

is_node_seed_process() {
  local pid="$1"
  local comm="$2"
  local args="$3"
  local exe exe_base

  # The project-specific argv pattern is the primary safety boundary.
  [[ "$args" =~ scripts/seed/(existing|seed|public)\.mjs ]] || return 1

  # Historical Node versions expose a Node-family comm value directly.
  if [[ "$comm" == node || "$comm" == nodejs || "$comm" == node-* ]]; then
    return 0
  fi

  # Node 24 can expose the main thread as `MainThread`; never trust that
  # generic comm value by itself. Verify the real executable through procfs.
  exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
  exe="${exe% (deleted)}"
  exe_base="${exe##*/}"

  [[ "$exe_base" == node || "$exe_base" == nodejs || "$exe_base" == node-* ]]
}

stop_active_seed_processes() {
  local pid comm args
  local -a pids=()
  while read -r pid comm args; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    is_node_seed_process "$pid" "$comm" "$args" || continue
    pids+=("$pid")
  done < <(ps -eo pid=,comm=,args=)

  for pid in "${pids[@]}"; do
    [[ "$pid" -gt 1 ]] || continue
    [[ "$pid" != "$$" ]] || continue
    if ! kill -0 "$pid" 2>/dev/null; then
      continue
    fi
    echo "Stopping previous seed PID $pid before destructive clean..."
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 "$SEED_STOP_WAIT_ATTEMPTS"); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep "$SEED_STOP_WAIT_INTERVAL_SECONDS"
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "Previous seed PID $pid did not exit after SIGTERM; sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
      sleep "$SEED_STOP_WAIT_INTERVAL_SECONDS"
    fi
    if kill -0 "$pid" 2>/dev/null; then
      echo "ERROR: previous seed PID $pid is still alive; refusing to delete Qdrant collection." >&2
      exit 1
    fi
  done
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT

stop_active_seed_processes

collection_url="$qdrant_url/collections/$collection"
response_file="$tmp_dir/qdrant-response.json"

printf '== Clean Qwen seed ==\n'
printf 'collection=%s\n' "$collection"
printf 'dataset=%s\n' "$DATASET"
printf 'qdrant_provider=%s\n' "$provider"
printf 'seed_http_batch_size=%s\n' "$SEED_HTTP_BATCH_SIZE"
printf 'embedding_transport=%s\n' "$embedding_transport"

status_code="$(http_request GET "$collection_url" "$response_file")"
case "$status_code" in
  200)
    points="$(jq -r '.result.points_count // 0' "$response_file")"
    echo "Existing collection found: points=$points"
    echo "Deleting Qdrant collection with authenticated request..."
    delete_code="$(http_request DELETE "$collection_url" "$response_file")"
    case "$delete_code" in
      200|202) ;;
      *) echo "ERROR: Qdrant collection delete failed with HTTP $delete_code" >&2; cat "$response_file" >&2 || true; exit 1 ;;
    esac
    ;;
  404)
    echo "Collection already absent; continuing with clean local state."
    ;;
  *)
    echo "ERROR: Qdrant collection pre-delete check failed with HTTP $status_code" >&2
    cat "$response_file" >&2 || true
    exit 1
    ;;
esac

absent=0
for _ in $(seq 1 "$DELETE_WAIT_ATTEMPTS"); do
  check_code="$(http_request GET "$collection_url" "$response_file")"
  if [[ "$check_code" == '404' ]]; then
    absent=1
    break
  fi
  if [[ "$check_code" != '200' ]]; then
    echo "ERROR: Qdrant collection absence check failed with HTTP $check_code" >&2
    cat "$response_file" >&2 || true
    exit 1
  fi
  sleep "$DELETE_WAIT_INTERVAL_SECONDS"
done
[[ "$absent" == '1' ]] || { echo "ERROR: collection still exists after delete wait window: $collection" >&2; exit 1; }
echo "Qdrant collection confirmed absent: $collection"

# Purge only Qwen seed runtime/evidence. Preserve the canonical dataset and E5 baseline evidence.
rm -rf -- "$RUN_DIR" reports/qwen3-clean-seed reports/qwen3-node-evidence qwen3-node-evidence
rm -f -- "$progress_path" "$events_path"
rm -f -- \
  seed-qwen3-4b-20k.log qdrant-seed-status.log verify-qwen3-4b.log benchmark-qwen3-4b.log api-qwen3-4b.log \
  qdrant-collection-qwen3.json embedding-stats-before-benchmark.json embedding-stats-after-benchmark.json \
  smoke-vi-tokyo.json smoke-vi-thailand.json smoke-vi-saigon.json \
  api-health.json api-ready.json api-info.json api-stats.json \
  qwen3-node-evidence.zip qwen3-node-evidence.zip.sha256
mkdir -p "$RUN_DIR"

echo "Purged old Qwen seed progress/run data."
echo "Preserved canonical dataset: $DATASET"
echo "Preserved E5 baseline collection/evidence."

echo "Verifying embedding service contract..."
model_json="$tmp_dir/model.json"
curl -fsS -o "$model_json" "$embedding_url/model"
actual_model="$(jq -r '.model // empty' "$model_json")"
actual_dimension="$(jq -r '.dimension // empty' "$model_json")"
actual_semantic="$(jq -r '.semantic // false' "$model_json")"
actual_binary_transport="$(jq -r '.transports.float32_binary // false' "$model_json")"
[[ "$actual_model" == "$embedding_model" ]] || { echo "ERROR: embedding model mismatch: expected $embedding_model, got ${actual_model:-unknown}" >&2; exit 1; }
[[ "$actual_dimension" == "$embedding_dimension" ]] || { echo "ERROR: embedding dimension mismatch: expected $embedding_dimension, got ${actual_dimension:-unknown}" >&2; exit 1; }
[[ "$actual_semantic" == 'true' ]] || { echo 'ERROR: embedding backend is not verified semantic runtime.' >&2; exit 1; }
if [[ "$embedding_transport" == 'binary-f32' && "$actual_binary_transport" != 'true' ]]; then
  echo 'ERROR: binary-f32 transport requires /model transports.float32_binary=true.' >&2
  exit 1
fi

echo "Embedding service verified: model=$actual_model dimension=$actual_dimension semantic=true transport=$embedding_transport"

export SEED_BATCH_SIZE="$SEED_HTTP_BATCH_SIZE"
export SEED_PROGRESS_PATH="$progress_path"
export SEED_PROGRESS_EVENTS_PATH="$events_path"
seed_log="$RUN_DIR/seed.log"
metadata_file="$RUN_DIR/clean-seed-metadata.txt"
{
  echo "started_at=$(date -Is)"
  echo "collection=$collection"
  echo "dataset=$DATASET"
  echo "embedding_model=$embedding_model"
  echo "embedding_dimension=$embedding_dimension"
  echo "embedding_transport=$embedding_transport"
  echo "seed_http_batch_size=$SEED_BATCH_SIZE"
  echo "progress_path=$progress_path"
  echo "events_path=$events_path"
} > "$metadata_file"

echo "Starting fresh seed from 0 points."
echo "Seed log: $seed_log"
set +e
npm run seed:existing -- "$DATASET" 2>&1 | tee "$seed_log"
seed_status="${PIPESTATUS[0]}"
set -e
if [[ "$seed_status" -ne 0 ]]; then
  echo "ERROR: fresh seed failed with exit code $seed_status" >&2
  exit "$seed_status"
fi

echo "Fresh seed completed."
