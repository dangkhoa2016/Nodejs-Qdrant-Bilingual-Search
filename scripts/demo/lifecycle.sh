#!/usr/bin/env bash

DEMO_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
load_demo_dotenv() {
  [[ "${DEMO_LOAD_DOTENV:-1}" == "1" && -f "$DEMO_ROOT_DIR/.env" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    if [[ -z "${!key+x}" ]]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  done < <(node - "$DEMO_ROOT_DIR/.env" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const allowed = new Set([
  'PORT','QDRANT_LOCAL_URL','QDRANT_URL','QDRANT_LOCAL_API_KEY','QDRANT_API_KEY',
  'QDRANT_COLLECTION','QDRANT_STORAGE_PATH','EMBEDDING_URL','EMBEDDING_MODEL',
  'EMBEDDING_MODEL_PATH',
  'EMBEDDING_DIMENSION','EMBEDDING_TRANSPORT','EMBEDDING_TEXT_VERSION',
  'EMBEDDING_REQUEST_TIMEOUT_MS','EMBEDDING_PROFILE','EMBEDDING_DEVICE','EMBEDDING_DTYPE',
  'EMBEDDING_BATCH_SIZE','EMBEDDING_MAX_SEQ_LENGTH','SEARCH_DEFAULT_SCORE_THRESHOLD',
  'SEARCH_CONSISTENCY_VERIFICATION_ENABLED','SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER',
  'SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED','DEMO_PUBLIC','DEMO_INSTALL_DEPS',
  'DEMO_DOWNLOAD_QDRANT','QDRANT_VERSION','EXPECTED_POINTS'
])
for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match || !allowed.has(match[1])) continue
  let value = match[2].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  process.stdout.write(`${match[1]}=${value}\n`)
}
NODE
  )
}
load_demo_dotenv
DEMO_RUNTIME_DIR="${DEMO_RUNTIME_DIR:-$DEMO_ROOT_DIR/.runtime/production-demo}"
DEMO_LOG_DIR="${DEMO_LOG_DIR:-$DEMO_ROOT_DIR/logs/production-demo}"
DEMO_BIN_DIR="${DEMO_BIN_DIR:-$DEMO_RUNTIME_DIR/bin}"
DEMO_PUBLIC="${DEMO_PUBLIC:-1}"
DEMO_INSTALL_DEPS="${DEMO_INSTALL_DEPS:-1}"
DEMO_DOWNLOAD_QDRANT="${DEMO_DOWNLOAD_QDRANT:-1}"
DEMO_STARTUP_ATTEMPTS="${DEMO_STARTUP_ATTEMPTS:-120}"
DEMO_STARTUP_INTERVAL_SECONDS="${DEMO_STARTUP_INTERVAL_SECONDS:-1}"
DEMO_TUNNEL_ATTEMPTS="${DEMO_TUNNEL_ATTEMPTS:-30}"
DEMO_STOP_ATTEMPTS="${DEMO_STOP_ATTEMPTS:-20}"
DEMO_STOP_INTERVAL_SECONDS="${DEMO_STOP_INTERVAL_SECONDS:-0.25}"
EXPECTED_POINTS="${EXPECTED_POINTS:-20000}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
EMBEDDING_PORT="${EMBEDDING_PORT:-8001}"
API_PORT="${PORT:-3000}"
QDRANT_URL="${QDRANT_LOCAL_URL:-${QDRANT_URL:-http://127.0.0.1:${QDRANT_PORT}}}"
QDRANT_API_KEY="${QDRANT_LOCAL_API_KEY:-${QDRANT_API_KEY:-}}"
EMBEDDING_URL="${EMBEDDING_URL:-http://127.0.0.1:${EMBEDDING_PORT}}"
API_URL="${API_URL:-http://127.0.0.1:${API_PORT}}"
SPAWN_HELPER="$DEMO_ROOT_DIR/scripts/colab/spawn-detached.py"
EMBEDDING_RUNTIME_CONTRACT="embedding-runtime-dtype-verified-v1"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="$API_PORT"
export QDRANT_PROVIDER="local"
export QDRANT_URL
export QDRANT_LOCAL_URL="$QDRANT_URL"
export QDRANT_API_KEY
export QDRANT_LOCAL_API_KEY="$QDRANT_API_KEY"
export QDRANT_COLLECTION="${QDRANT_COLLECTION:-knowledge_entities_qwen3_4b_text_v21}"
export EMBEDDING_URL
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-Qwen/Qwen3-Embedding-4B}"
export EMBEDDING_MODEL_PATH="${EMBEDDING_MODEL_PATH:-}"
export EMBEDDING_DIMENSION="${EMBEDDING_DIMENSION:-2560}"
export EMBEDDING_TRANSPORT="${EMBEDDING_TRANSPORT:-binary-f32}"
export EMBEDDING_TEXT_VERSION="${EMBEDDING_TEXT_VERSION:-v2.1}"
export EMBEDDING_REQUEST_TIMEOUT_MS="${EMBEDDING_REQUEST_TIMEOUT_MS:-120000}"
export SEARCH_DEFAULT_SCORE_THRESHOLD="${SEARCH_DEFAULT_SCORE_THRESHOLD:-0.55}"
export SEARCH_CONSISTENCY_VERIFICATION_ENABLED="${SEARCH_CONSISTENCY_VERIFICATION_ENABLED:-true}"
export SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER="${SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER:-5}"
export SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED="${SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED:-true}"

mkdir -p "$DEMO_RUNTIME_DIR" "$DEMO_LOG_DIR" "$DEMO_BIN_DIR"

have() { command -v "$1" >/dev/null 2>&1; }

validate_demo_topology() {
  node - "$QDRANT_URL" "$EMBEDDING_URL" <<'NODE'
for (const [label, raw] of [['Qdrant', process.argv[2]], ['Embedding service', process.argv[3]]]) {
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    console.error(`ERROR: ${label} must be localhost-only for production demo; got ${raw}`)
    process.exit(65)
  }
}
NODE
}

pid_file() { printf '%s/%s.pid\n' "$DEMO_RUNTIME_DIR" "$1"; }
sig_file() { printf '%s/%s.sig\n' "$DEMO_RUNTIME_DIR" "$1"; }
log_file() { printf '%s/%s.log\n' "$DEMO_LOG_DIR" "$1"; }

read_pid() {
  local file="$1" pid=""
  [[ -f "$file" ]] && pid="$(tr -d '[:space:]' < "$file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] && printf '%s\n' "$pid"
}

pid_cmdline() {
  local pid="$1"
  if [[ -r "/proc/$pid/cmdline" ]]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true
  elif have ps; then
    ps -p "$pid" -o command= 2>/dev/null || true
  fi
}

owned_pid() {
  local name="$1" pfile sfile pid sig cmd
  pfile="$(pid_file "$name")"; sfile="$(sig_file "$name")"
  pid="$(read_pid "$pfile" || true)"
  sig="$(cat "$sfile" 2>/dev/null || true)"
  if [[ -z "$pid" || -z "$sig" ]] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pfile" "$sfile"
    return 1
  fi
  cmd="$(pid_cmdline "$pid")"
  if [[ "$cmd" != *"$sig"* ]]; then
    rm -f "$pfile" "$sfile"
    return 1
  fi
  printf '%s\n' "$pid"
}

record_owned() {
  local name="$1" pid="$2" sig="$3"
  printf '%s\n' "$pid" > "$(pid_file "$name")"
  printf '%s\n' "$sig" > "$(sig_file "$name")"
}

spawn_owned() {
  local name="$1" sig="$2" cwd="$3"; shift 3
  local log pid
  log="$(log_file "$name")"
  : > "$log"
  if [[ ! -f "$SPAWN_HELPER" || ! -r "$SPAWN_HELPER" ]]; then
    echo "ERROR: detached spawn helper missing or unreadable: $SPAWN_HELPER" >&2
    return 1
  fi
  if [[ -n "$cwd" ]]; then
    pid="$(python3 "$SPAWN_HELPER" --cwd "$cwd" --log "$log" -- "$@")"
  else
    pid="$(python3 "$SPAWN_HELPER" --log "$log" -- "$@")"
  fi
  record_owned "$name" "$pid" "$sig"
  printf '%s\n' "$pid"
}

qdrant_curl() {
  local args=(-fsS --max-time 3)
  [[ -n "${QDRANT_API_KEY:-}" ]] && args+=(-H "api-key: ${QDRANT_API_KEY}")
  curl "${args[@]}" "$@"
}

qdrant_ready() { qdrant_curl "$QDRANT_URL/" >/dev/null 2>&1; }
embedding_ready() { curl -fsS --max-time 3 "$EMBEDDING_URL/health" >/dev/null 2>&1; }
api_ready() { curl -fsS --max-time 5 "$API_URL/ready" >/dev/null 2>&1; }

wait_ready() {
  local label="$1" check_fn="$2" owned_name="$3"
  local pid=""
  for _ in $(seq 1 "$DEMO_STARTUP_ATTEMPTS"); do
    "$check_fn" && return 0
    pid="$(read_pid "$(pid_file "$owned_name")" || true)"
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$(pid_file "$owned_name")" "$(sig_file "$owned_name")"
      echo "ERROR: $label process exited before readiness (pid=$pid)." >&2
      tail -80 "$(log_file "$owned_name")" 2>/dev/null >&2 || true
      return 1
    fi
    sleep "$DEMO_STARTUP_INTERVAL_SECONDS"
  done
  echo "ERROR: $label did not become ready." >&2
  tail -80 "$(log_file "$owned_name")" 2>/dev/null >&2 || true
  return 1
}

ensure_node_dependencies() {
  if [[ -d "$DEMO_ROOT_DIR/node_modules/hono" ]]; then return 0; fi
  if [[ "$DEMO_INSTALL_DEPS" != "1" ]]; then
    echo "ERROR: Node dependencies missing. Run npm ci or set DEMO_INSTALL_DEPS=1." >&2
    return 1
  fi
  echo "Installing Node dependencies..."
  (cd "$DEMO_ROOT_DIR" && npm ci)
}

ensure_python_dependencies() {
  if python - <<'PY' >/dev/null 2>&1
import fastapi, uvicorn, sentence_transformers
PY
  then return 0; fi
  if [[ "$DEMO_INSTALL_DEPS" != "1" ]]; then
    echo "ERROR: embedding Python dependencies missing. Install embedding-service/requirements.txt or set DEMO_INSTALL_DEPS=1." >&2
    return 1
  fi
  echo "Installing embedding-service dependencies..."
  python -m pip install -q -r "$DEMO_ROOT_DIR/embedding-service/requirements.txt"
}

probe_qdrant_binary() {
  local candidate="$1" output version
  [[ -f "$candidate" && -x "$candidate" ]] || return 1

  if ! output="$(timeout 10 "$candidate" --version 2>&1)"; then
    printf 'WARN: rejected Qdrant candidate %s: %s\n' \
      "$candidate" "$output" >&2
    return 1
  fi

  version="$(printf '%s\n' "$output" \
    | sed -nE 's/.*[Qq]drant[[:space:]]+v?([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' \
    | head -1)"

  [[ -n "$version" ]] || {
    printf 'WARN: rejected Qdrant candidate %s: unparseable version: %s\n' \
      "$candidate" "$output" >&2
    return 1
  }

  if [[ -n "${QDRANT_VERSION:-}" && "$version" != "$QDRANT_VERSION" ]]; then
    printf 'WARN: rejected Qdrant candidate %s: version=%s expected=%s\n' \
      "$candidate" "$version" "$QDRANT_VERSION" >&2
    return 1
  fi

  printf 'Qdrant binary verified: path=%s version=%s\n' \
    "$candidate" "$version" >&2
  return 0
}

ensure_qdrant_binary() {
  if [[ -n "${QDRANT_BIN:-}" ]]; then
    if probe_qdrant_binary "$QDRANT_BIN"; then
      printf '%s\n' "$QDRANT_BIN"
      return 0
    fi
    echo "ERROR: explicit QDRANT_BIN failed the qdrant executable probe: $QDRANT_BIN" >&2
    return 1
  fi
  if have qdrant; then
    local on_path
    on_path="$(command -v qdrant)"
    if probe_qdrant_binary "$on_path"; then
      printf '%s\n' "$on_path"
      return 0
    fi
  fi
  local local_bin="$DEMO_BIN_DIR/qdrant"
  if [[ -x "$local_bin" ]] && probe_qdrant_binary "$local_bin"; then
    printf '%s\n' "$local_bin"
    return 0
  fi
  if [[ "$DEMO_DOWNLOAD_QDRANT" != "1" ]]; then
    echo "ERROR: no compatible qdrant binary found. Set QDRANT_BIN or DEMO_DOWNLOAD_QDRANT=1." >&2
    return 1
  fi
  local version="${QDRANT_VERSION:-1.18.0}"
  local archive="$DEMO_RUNTIME_DIR/qdrant.tar.gz"
  local extract_dir="$DEMO_RUNTIME_DIR/qdrant-extract"
  local asset
  if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
    asset="qdrant-x86_64-unknown-linux-musl.tar.gz"
  else
    echo "ERROR: unsupported platform for Qdrant download; set QDRANT_BIN explicitly." >&2
    return 1
  fi
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  echo "Downloading Qdrant v$version (musl)..." >&2
  if ! curl -fL --retry 3 -o "$archive" "https://github.com/qdrant/qdrant/releases/download/v${version}/${asset}"; then
    echo "ERROR: failed to download Qdrant release asset: ${asset}" >&2
    rm -f "$archive"
    rm -rf "$extract_dir"
    return 1
  fi
  if ! tar -xzf "$archive" -C "$extract_dir" qdrant; then
    echo "ERROR: failed to extract Qdrant archive: ${asset}" >&2
    rm -f "$archive"
    rm -rf "$extract_dir"
    return 1
  fi
  rm -f "$archive"
  if ! probe_qdrant_binary "$extract_dir/qdrant"; then
    echo "ERROR: downloaded Qdrant binary failed the executable probe; fail closed." >&2
    rm -f "$extract_dir/qdrant"
    rm -rf "$extract_dir"
    return 1
  fi
  mv -f "$extract_dir/qdrant" "$local_bin"
  chmod +x "$local_bin"
  rm -rf "$extract_dir"
  printf '%s\n' "$local_bin"
}

start_qdrant() {
  if qdrant_ready; then echo "Qdrant             READY (external/reused)"; return 0; fi
  local existing bin storage pid
  existing="$(owned_pid qdrant || true)"
  if [[ -z "$existing" ]]; then
    bin="$(ensure_qdrant_binary)"
    storage="${QDRANT_STORAGE_PATH:-$DEMO_RUNTIME_DIR/qdrant-storage}"
    mkdir -p "$storage"
    export QDRANT__STORAGE__STORAGE_PATH="$storage"
    export QDRANT__SERVICE__HOST="127.0.0.1"
    export QDRANT__SERVICE__HTTP_PORT="$QDRANT_PORT"
    if [[ -n "$QDRANT_API_KEY" ]]; then export QDRANT__SERVICE__API_KEY="$QDRANT_API_KEY"; fi
    pid="$(spawn_owned qdrant "$bin" "$DEMO_ROOT_DIR" "$bin")"
    echo "Qdrant PID: $pid"
  fi
  wait_ready "Qdrant" qdrant_ready qdrant
  echo "Qdrant             READY"
}

configure_embedding_runtime() {
  export EMBEDDING_PROFILE="${EMBEDDING_PROFILE:-qwen3}"
  export EMBEDDING_DEVICE="${EMBEDDING_DEVICE:-cuda}"
  export EMBEDDING_DTYPE="${EMBEDDING_DTYPE:-float16}"
  export EMBEDDING_BATCH_SIZE="${EMBEDDING_BATCH_SIZE:-8}"
  export EMBEDDING_MAX_SEQ_LENGTH="${EMBEDDING_MAX_SEQ_LENGTH:-512}"
  export ENABLE_TRANSLATION="${ENABLE_TRANSLATION:-false}"
}

assert_embedding_runtime_contract() {
  local body
  body="$(curl -fsS --max-time 5 "$EMBEDDING_URL/model")" || return 1
  node - "$body" "$EMBEDDING_DEVICE" "$EMBEDDING_DTYPE" "$EMBEDDING_RUNTIME_CONTRACT" <<'NODE'
const x = JSON.parse(process.argv[2])
const requestedDevice = String(process.argv[3] || 'auto').trim().toLowerCase()
const requestedDtype = String(process.argv[4] || 'auto').trim().toLowerCase()
const expectedContract = process.argv[5]
const mismatches = []

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    const shown = actual === undefined ? '<missing>' : JSON.stringify(actual)
    mismatches.push(`${label} expected=${expected} actual=${shown}`)
  }
}

expectEqual('model', x.model, 'Qwen/Qwen3-Embedding-4B')
if (Number(x.dimension) !== 2560) mismatches.push(`dimension expected=2560 actual=${x.dimension ?? '<missing>'}`)
expectEqual('backend', x.backend, 'sentence-transformers')
expectEqual('implementation', x.implementation, 'python-fastapi')
expectEqual('semantic', x.semantic, true)
expectEqual('profile', x.profile, 'qwen3')
expectEqual('query_strategy', x.query_strategy, 'prompt')
expectEqual('query_instruction_id', x.query_instruction_id, 'geo-retrieval-v1:d014d3ec6df87e49')
expectEqual('document_strategy', x.document_strategy, 'raw')
expectEqual('runtime_contract', x.runtime_contract, expectedContract)
expectEqual('transports.float32_binary', x.transports?.float32_binary, true)

let expectedDevice = requestedDevice
if (requestedDevice === 'auto') {
  expectedDevice = x.device === 'cpu' || x.device === 'cuda' ? x.device : '<invalid>'
}
expectEqual('device', x.device, expectedDevice)

if (expectedDevice === 'cpu' || expectedDevice === 'cuda') {
  expectEqual('accelerator', x.accelerator, expectedDevice === 'cpu' ? 'cpu' : 'gpu')
  expectEqual('runtime', x.runtime, expectedDevice === 'cpu' ? 'pytorch-cpu' : 'pytorch-cuda')
  const expectedDtype = requestedDtype === 'auto'
    ? (expectedDevice === 'cpu' ? 'float32' : 'float16')
    : requestedDtype
  expectEqual('dtype', x.dtype, expectedDtype)
} else {
  mismatches.push(`requested device is not reusable: ${requestedDevice}`)
}

if (mismatches.length) {
  console.error(`ERROR: embedding runtime contract mismatch: ${mismatches.join('; ')}`)
  process.exit(1)
}
NODE
}

print_oom_diagnostics() {
  {
    echo "--- OOM/system memory diagnostics (best-effort) ---"
    echo "[memory.max]"; cat /sys/fs/cgroup/memory.max 2>/dev/null || true
    echo "[memory.events]"; cat /sys/fs/cgroup/memory.events 2>/dev/null || true
    echo "[meminfo]"; grep -E 'MemTotal|MemAvailable' /proc/meminfo 2>/dev/null || true
    echo "[free -h]"; free -h 2>/dev/null || true
    echo "[embedding log tail]"
    tail -80 "$(log_file embedding)" 2>/dev/null || true
  } >&2
}

start_embedding() {
  configure_embedding_runtime
  if embedding_ready; then
    if ! assert_embedding_runtime_contract; then
      echo "ERROR: existing embedding service runtime contract mismatch; refusing reuse." >&2
      return 1
    fi
    echo "Embedding service  READY (external/reused)"; return 0
  fi
  local existing pid python_bin
  existing="$(owned_pid embedding || true)"
  if [[ -z "$existing" ]]; then
    ensure_python_dependencies
    python_bin="${PYTHON_BIN:-python}"
    pid="$(spawn_owned embedding "uvicorn app:app" "$DEMO_ROOT_DIR/embedding-service" "$python_bin" -m uvicorn app:app --host 127.0.0.1 --port "$EMBEDDING_PORT")"
    echo "Embedding PID: $pid"
  fi
  if ! wait_ready "Embedding service" embedding_ready embedding; then
    print_oom_diagnostics
    return 1
  fi
  assert_embedding_runtime_contract || { echo "ERROR: embedding /model does not match the required runtime contract." >&2; return 1; }
  echo "Embedding service  READY"
}

verify_canonical_runtime() {
  (cd "$DEMO_ROOT_DIR" && NODE_ENV=production node scripts/verify/canonical-config.mjs >/dev/null)
  (cd "$DEMO_ROOT_DIR" && NODE_ENV=production node scripts/verify/semantic-index.mjs "$EXPECTED_POINTS" >/dev/null)
}

start_api() {
  if api_ready; then echo "Node API           READY (external/reused)"; return 0; fi
  local existing pid
  existing="$(owned_pid api || true)"
  if [[ -z "$existing" ]]; then
    ensure_node_dependencies
    pid="$(spawn_owned api "src/server.js" "$DEMO_ROOT_DIR" node src/server.js)"
    echo "Node API PID: $pid"
  fi
  wait_ready "Node API" api_ready api
  echo "Node API           READY"
}

ensure_cloudflared() {
  if [[ -n "${CLOUDFLARED_BIN:-}" && -x "$CLOUDFLARED_BIN" ]]; then printf '%s\n' "$CLOUDFLARED_BIN"; return 0; fi
  if have cloudflared; then command -v cloudflared; return 0; fi
  local bin="$DEMO_BIN_DIR/cloudflared"
  if [[ -x "$bin" ]]; then printf '%s\n' "$bin"; return 0; fi
  curl -fL --retry 3 -o "$bin" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$bin"
  printf '%s\n' "$bin"
}

start_tunnel() {
  [[ "$DEMO_PUBLIC" == "1" ]] || { rm -f "$DEMO_RUNTIME_DIR/public.url"; echo "Public tunnel      DISABLED"; return 0; }
  local existing bin pid url log
  existing="$(owned_pid tunnel || true)"
  if [[ -z "$existing" ]]; then
    bin="$(ensure_cloudflared)" || { echo "WARNING: Cloudflare tunnel unavailable; local demo remains ready." >&2; return 0; }
    pid="$(spawn_owned tunnel "cloudflared tunnel" "$DEMO_ROOT_DIR" "$bin" tunnel --no-autoupdate --url "http://127.0.0.1:${API_PORT}")" || true
    [[ -n "$pid" ]] || { echo "WARNING: Cloudflare tunnel failed to start; local demo remains ready." >&2; return 0; }
  fi
  log="$(log_file tunnel)"
  url=""
  for _ in $(seq 1 "$DEMO_TUNNEL_ATTEMPTS"); do
    url="$(grep -Eo 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' "$log" 2>/dev/null | head -n1 || true)"
    [[ -n "$url" ]] && break
    sleep "$DEMO_STARTUP_INTERVAL_SECONDS"
  done
  if [[ -z "$url" ]]; then
    echo "WARNING: Cloudflare tunnel has no public URL yet; local demo remains ready." >&2
    stop_owned tunnel "Cloudflare tunnel"
    rm -f "$DEMO_RUNTIME_DIR/public.url"
    return 0
  fi
  printf '%s\n' "$url" > "$DEMO_RUNTIME_DIR/public.url"
  echo "Public tunnel      READY"
  echo "Public API:         $url"
}

stop_owned() {
  local name="$1" label="$2" pid
  pid="$(owned_pid "$name" || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$(pid_file "$name")" "$(sig_file "$name")"
    return 0
  fi
  echo "Stopping $label PID $pid"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 "$DEMO_STOP_ATTEMPTS"); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep "$DEMO_STOP_INTERVAL_SECONDS"
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "$label PID $pid did not exit after SIGTERM; sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$(pid_file "$name")" "$(sig_file "$name")"
}

service_line() {
  local label="$1" name="$2" check_fn="$3" pid=""
  pid="$(owned_pid "$name" || true)"
  if "$check_fn"; then
    if [[ -n "$pid" ]]; then printf '%-19s READY (owned pid=%s)\n' "$label" "$pid"; else printf '%-19s READY (external/reused)\n' "$label"; fi
  else
    printf '%-19s STOPPED\n' "$label"
  fi
}

status_tunnel() {
  local pid url
  pid="$(owned_pid tunnel || true)"
  url="$(cat "$DEMO_RUNTIME_DIR/public.url" 2>/dev/null || true)"
  if [[ -n "$pid" ]]; then printf '%-19s READY (owned pid=%s)%s\n' "Public tunnel" "$pid" "${url:+ $url}"; else printf '%-19s STOPPED\n' "Public tunnel"; fi
}

demo_start() {
  echo "== Production demo startup =="
  validate_demo_topology
  start_qdrant
  start_embedding
  ensure_node_dependencies
  echo "Verifying canonical 20k semantic index..."
  verify_canonical_runtime
  start_api
  start_tunnel
  echo
  echo "Local API:          $API_URL"
  if [[ -s "$DEMO_RUNTIME_DIR/public.url" ]]; then echo "Public API:         $(cat "$DEMO_RUNTIME_DIR/public.url")"; fi
  echo "Demo command:       npm run demo"
  echo "Smoke command:      npm run smoke:production"
}

demo_stop() {
  stop_owned tunnel "Cloudflare tunnel"
  stop_owned api "Node API"
  stop_owned embedding "Embedding service"
  stop_owned qdrant "Qdrant"
  rm -f "$DEMO_RUNTIME_DIR/public.url"
  echo "Production demo owned processes stopped. External/reused services were left untouched."
}

demo_restart() { demo_stop; demo_start; }

demo_status() {
  service_line "Qdrant" qdrant qdrant_ready
  service_line "Embedding service" embedding embedding_ready
  service_line "Node API" api api_ready
  status_tunnel
  echo "Local API:          $API_URL"
  if [[ -s "$DEMO_RUNTIME_DIR/public.url" ]]; then echo "Public API:         $(cat "$DEMO_RUNTIME_DIR/public.url")"; fi
}
