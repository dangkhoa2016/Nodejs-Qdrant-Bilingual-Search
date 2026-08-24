#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
COLLECTOR="$ROOT/scripts/kaggle/collect-production-demo-notebook-evidence.sh"
SERVER="$ROOT/src/server.js"
WRAPPER="$ROOT/scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh"
NOTEBOOK="$ROOT/notebooks/kaggle-cpu-fp16-production-demo.ipynb"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

grep -F 'hostname: config.host' "$SERVER" >/dev/null || fail 'Node server does not use an explicit configured hostname'
grep -F "require_exact_or_unset HOST '127.0.0.1'" "$WRAPPER" >/dev/null || fail 'Kaggle profile does not force Node host to 127.0.0.1'
pass 'Node server loopback bind contract'

grep -F '(6333|6334|8001|3000)' "$COLLECTOR" >/dev/null || fail 'listener evidence gate does not cover Qdrant, embedding, and Node backend ports'
pass 'listener gate includes backend ports 6333/6334/8001/3000'

if grep -Eq 'ps[[:space:]].*args' "$COLLECTOR"; then
  fail 'collector still captures full process command lines'
fi
grep -F 'PROCESS_COMMAND_LINES=OMITTED' "$COLLECTOR" >/dev/null || fail 'collector does not record process evidence policy'
pass 'process evidence excludes full command lines'

grep -Fx '.runtime/' "$ROOT/.gitignore" >/dev/null || fail '.runtime/ is not ignored'
grep -F 'status --porcelain --untracked-files=all' "$COLLECTOR" >/dev/null || fail 'collector does not inspect Git worktree state'
grep -F 'REPOSITORY_GIT_STATUS=CLEAN' "$COLLECTOR" >/dev/null || fail 'collector does not record clean Git status'
pass 'runtime Git hygiene contract'

grep -F 'SYSTEM_NODE_VERSION=' "$COLLECTOR" >/dev/null || fail 'collector does not label the shell/system Node version explicitly'
grep -F 'DEMO_NODE_VERSION=' "$COLLECTOR" >/dev/null || fail 'collector does not label the running demo Node version explicitly'
if grep -F 'echo "node=$(node --version' "$COLLECTOR" >/dev/null; then
  fail 'collector still emits ambiguous node= environment evidence'
fi
pass 'system Node and running demo Node evidence are unambiguous'

grep -F 'basename "$ZIP"' "$COLLECTOR" >/dev/null || fail 'sidecar generation does not use a portable ZIP basename'
grep -F 'EVIDENCE_SIDECAR_PATH_MODE=PORTABLE' "$COLLECTOR" >/dev/null || fail 'collector does not report portable sidecar mode'
pass 'portable outer SHA256 sidecar contract'

grep -F 'PRODUCTION_DEMO_ACCEPTANCE_PASS=8' "$COLLECTOR" >/dev/null || fail 'public evidence gate does not require all eight public checks'
grep -F 'AUTHENTICATED_PUBLIC_DEMO=NOT_PROVEN' "$COLLECTOR" >/dev/null || fail 'collector cannot distinguish incomplete public evidence'
pass 'public evidence claims require real public acceptance'

python3 - "$NOTEBOOK" <<'PY'
import json, sys
nb=json.load(open(sys.argv[1], encoding='utf-8'))
code='\n'.join(str(c.get('source', '')) if isinstance(c.get('source'), str) else ''.join(c.get('source', [])) for c in nb['cells'] if c.get('cell_type')=='code')
markdown='\n'.join(str(c.get('source', '')) if isinstance(c.get('source'), str) else ''.join(c.get('source', [])) for c in nb['cells'] if c.get('cell_type')=='markdown')
if 'ENABLE_PUBLIC_TUNNEL = False' not in code:
    raise SystemExit('FAIL: public tunnel must default to False')
if 'AUTHENTICATED_PUBLIC_DEMO=NOT_RUN' not in code:
    raise SystemExit('FAIL: notebook does not expose NOT_RUN public status')
if 'public_completed' not in code:
    raise SystemExit('FAIL: final public PASS is not tied to actual completion evidence')
for token in ['**English**', '**Tiếng Việt**', 'Required / Bắt buộc', 'Optional / Tùy chọn', 'PRODUCTION_DEMO_ACCEPTANCE_PASS=8']:
    if token not in markdown:
        raise SystemExit(f'FAIL: bilingual notebook guidance missing: {token}')
print('PASS: notebook bilingual optional-public final-status contract')
PY
