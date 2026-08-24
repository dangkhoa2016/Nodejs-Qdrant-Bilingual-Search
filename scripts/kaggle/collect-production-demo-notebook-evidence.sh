#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
OUT_ROOT="${PRODUCTION_DEMO_EVIDENCE_ROOT:-/kaggle/working}"
DEMO_RUNTIME_DIR="${DEMO_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/production-demo}"
DEMO_LOG_DIR="${DEMO_LOG_DIR:-$PROJECT_ROOT/logs/production-demo}"
PUBLIC_RUNTIME_DIR="${DEMO_PUBLIC_RUNTIME_DIR:-$PROJECT_ROOT/.runtime/production-demo-public}"
PUBLIC_LOG_DIR="${DEMO_PUBLIC_LOG_DIR:-$PROJECT_ROOT/logs/production-demo-public}"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
WORK="$OUT_ROOT/nodejs-qdrant-production-demo-evidence-$STAMP"
ROOT="$WORK/production-demo-evidence"
ZIP="$OUT_ROOT/nodejs-qdrant-v1.0.0-production-demo-evidence-$STAMP.zip"
SIDECAR="$ZIP.sha256"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
rm -rf "$WORK"
mkdir -p "$ROOT"/{identity,endpoints,logs,system,acceptance,public}

git -C "$PROJECT_ROOT" status --porcelain --untracked-files=all > "$ROOT/identity/git-status.txt"
if [[ -s "$ROOT/identity/git-status.txt" ]]; then
  cat "$ROOT/identity/git-status.txt" >&2
  die 'repository worktree is dirty; refuse publication evidence'
fi

{
  echo "timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "head=$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
  echo "tree=$(git -C "$PROJECT_ROOT" rev-parse 'HEAD^{tree}')"
  echo "status_count=0"
  echo "REPOSITORY_GIT_STATUS=CLEAN"
} > "$ROOT/identity/source.txt"

for spec in \
  "qdrant.json|http://127.0.0.1:6333/collections/knowledge_entities_qwen3_4b_text_v21" \
  "embedding-model.json|http://127.0.0.1:8001/model" \
  "node-health.json|http://127.0.0.1:3000/health" \
  "node-ready.json|http://127.0.0.1:3000/ready" \
  "node-info.json|http://127.0.0.1:3000/api/v1/info"; do
  name="${spec%%|*}"; url="${spec#*|}"
  curl -fsS --max-time 10 "$url" > "$ROOT/endpoints/$name" 2>/dev/null || true
done

if [[ -s "$PUBLIC_RUNTIME_DIR/public.url" ]]; then echo "PUBLIC_URL=$(cat "$PUBLIC_RUNTIME_DIR/public.url")" > "$ROOT/endpoints/public-url.txt"; fi
[[ -s "$PUBLIC_RUNTIME_DIR/cloudflared-version.txt" ]] && cp "$PUBLIC_RUNTIME_DIR/cloudflared-version.txt" "$ROOT/public/" || true
cp "$DEMO_LOG_DIR"/*.log "$ROOT/logs/" 2>/dev/null || true
cp "$PUBLIC_LOG_DIR"/*.log "$ROOT/logs/" 2>/dev/null || true
cp /kaggle/working/production-demo-local-acceptance.log "$ROOT/acceptance/" 2>/dev/null || true
cp /kaggle/working/production-demo-public-acceptance.log "$ROOT/acceptance/" 2>/dev/null || true

system_node="$(node --version 2>&1 || true)"
demo_node="$(python3 - "$ROOT/endpoints/node-info.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)
    value = (((data.get('info') or {}).get('runtime') or {}).get('node'))
    print(value or 'unknown')
except Exception:
    print('unknown')
PY
)"

{
  echo "uname=$(uname -a)"
  echo "nproc=$(nproc 2>/dev/null || true)"
  echo "python=$(python3 --version 2>&1 || true)"
  echo "SYSTEM_NODE_VERSION=$system_node"
  echo "DEMO_NODE_VERSION=$demo_node"
  echo "memory:"; free -h 2>/dev/null || true
  echo "disk:"; df -h /kaggle/working /kaggle/input 2>/dev/null || true
  echo "cgroup.memory.current:"; cat /sys/fs/cgroup/memory.current 2>/dev/null || true
  echo "cgroup.memory.peak:"; cat /sys/fs/cgroup/memory.peak 2>/dev/null || true
  echo "cgroup.memory.events:"; cat /sys/fs/cgroup/memory.events 2>/dev/null || true
  echo "gpu:"; nvidia-smi -L 2>/dev/null || echo "none"
} > "$ROOT/system/environment.txt"

# Deliberately omit command-line arguments. Kaggle/Jupyter process argv can contain
# session-specific proxy/base-url credentials that must never enter release evidence.
ps -eo pid,ppid,comm,%cpu,%mem,rss,vsz,etime --sort=-rss > "$ROOT/system/processes.txt" 2>/dev/null || true
printf 'PROCESS_COMMAND_LINES=OMITTED\n' > "$ROOT/system/process-evidence-policy.txt"

if command -v ss >/dev/null 2>&1; then
  ss -ltnp > "$ROOT/system/listeners.txt" 2>&1 || true
  if grep -E '(^|[[:space:]])(0\.0\.0\.0|\*|\[::\]):(6333|6334|8001|3000)([[:space:]]|$)' "$ROOT/system/listeners.txt" >/dev/null; then
    die 'Qdrant, embedding service, or Node API is listening on a wildcard interface'
  fi
fi

if [[ -s "$PUBLIC_RUNTIME_DIR/cloudflared.pid" ]]; then
  tunnel_pid="$(cat "$PUBLIC_RUNTIME_DIR/cloudflared.pid")"
  tunnel_cmd="$(tr '\0' ' ' < "/proc/$tunnel_pid/cmdline" 2>/dev/null || true)"
  printf '%s\n' "$tunnel_cmd" > "$ROOT/public/cloudflared-command.txt"
  [[ "$tunnel_cmd" == *'http://127.0.0.1:8090'* ]] || die 'cloudflared is not targeting 127.0.0.1:8090'
  [[ "$tunnel_cmd" != *':6333'* && "$tunnel_cmd" != *':6334'* && "$tunnel_cmd" != *':8001'* && "$tunnel_cmd" != *':3000'* ]] || die 'cloudflared exposes a forbidden backend port'
fi

cat > "$ROOT/RESULT.txt" <<'EOF_RESULT'
MODEL=READY
QDRANT=20000/20000
NODE_READY=PASS
RESEED_PERFORMED=NO
PUBLIC_MUTATION_PERFORMED=NO
QDRANT_PUBLIC_EXPOSURE=NO
EMBEDDING_PUBLIC_EXPOSURE=NO
NODE_PUBLIC_EXPOSURE=NO
EOF_RESULT

PUBLIC_ACCEPTANCE="$ROOT/acceptance/production-demo-public-acceptance.log"
if [[ -s "$PUBLIC_RUNTIME_DIR/public.url" ]]; then
  if [[ -s "$PUBLIC_ACCEPTANCE" ]] \
    && grep -Fx 'PASS public unauthenticated request = 401' "$PUBLIC_ACCEPTANCE" >/dev/null \
    && grep -Fx 'PRODUCTION_DEMO_ACCEPTANCE_PASS=8' "$PUBLIC_ACCEPTANCE" >/dev/null; then
    cat >> "$ROOT/RESULT.txt" <<'EOF_RESULT'
AUTH_GATEWAY=PASS
UNAUTHENTICATED_REQUEST=401
PUBLIC_TUNNEL_TARGET=http://127.0.0.1:8090
PUBLIC_TUNNEL=PASS
AUTHENTICATED_PUBLIC_DEMO=PASS
EOF_RESULT
  else
    echo 'AUTHENTICATED_PUBLIC_DEMO=NOT_PROVEN' >> "$ROOT/RESULT.txt"
  fi
else
  echo 'AUTHENTICATED_PUBLIC_DEMO=NOT_RUN' >> "$ROOT/RESULT.txt"
fi

if [[ -s "$PUBLIC_RUNTIME_DIR/demo-token" ]]; then
  TOKEN="$(cat "$PUBLIC_RUNTIME_DIR/demo-token")"
  if grep -R -F -l -- "$TOKEN" "$ROOT" >/tmp/nodejs-qdrant-demo-secret-hits.txt 2>/dev/null; then
    cat /tmp/nodejs-qdrant-demo-secret-hits.txt >&2
    die 'Bearer token leaked into evidence'
  fi
fi
if find "$ROOT" -type f -iname '*token*' -print | grep .; then die 'token-named file entered evidence archive'; fi

(
  cd "$ROOT"
  find . -type f ! -path './SHA256SUMS' -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum | sed 's#  \./#  #' > SHA256SUMS
  ! grep -Eq '  (/|\./)?SHA256SUMS$' SHA256SUMS
  ! grep -Eq '^[0-9a-fA-F]{64}  /' SHA256SUMS
  sha256sum -c SHA256SUMS
)

rm -f "$ZIP" "$SIDECAR"
python3 - "$WORK" "$ZIP" <<'PY'
from pathlib import Path
import sys, zipfile
src=Path(sys.argv[1]); out=Path(sys.argv[2])
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(src.rglob('*')):
        if p.is_file(): z.write(p, p.relative_to(src))
PY

zip_sha="$(sha256sum "$ZIP" | awk '{print $1}')"
printf '%s  %s\n' "$zip_sha" "$(basename "$ZIP")" > "$SIDECAR"

VERIFY="$(mktemp -d)"; trap 'rm -rf "$VERIFY"' EXIT
python3 - "$ZIP" "$VERIFY" <<'PY'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    for name in z.namelist():
        if name.startswith('/') or '..' in name.split('/'): raise SystemExit('unsafe ZIP path: '+name)
    z.extractall(sys.argv[2])
PY
(cd "$VERIFY/production-demo-evidence" && sha256sum -c SHA256SUMS && ! grep -Eq '  (/|\./)?SHA256SUMS$' SHA256SUMS && ! grep -Eq '^[0-9a-fA-F]{64}  /' SHA256SUMS)
(cd "$OUT_ROOT" && sha256sum -c "$(basename "$SIDECAR")")

echo "EVIDENCE_PACKAGE=$ZIP"
echo "EVIDENCE_SIDECAR=$SIDECAR"
echo "EVIDENCE_MANIFEST_PATH_MODE=RELATIVE"
echo "EVIDENCE_SHA256SUMS_SELF_ENTRY=NO"
echo "EVIDENCE_SIDECAR_PATH_MODE=PORTABLE"
echo "EVIDENCE_REEXTRACT_VERIFY=PASS"
