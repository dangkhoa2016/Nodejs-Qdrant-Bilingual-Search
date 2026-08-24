#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
NOTEBOOK="$ROOT/notebooks/kaggle-cpu-fp16-production-demo.ipynb"

python3 - "$NOTEBOOK" <<'PY'
import json, sys
from pathlib import Path

nb = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
first = nb['cells'][0]
if first.get('cell_type') != 'code':
    raise SystemExit('FAIL: notebook cell 0 must be the repository bootstrap code cell')
source = first.get('source', '')
if isinstance(source, list):
    source = ''.join(source)

reset = 'git -C "$ROOT" reset --hard origin/main'
clean = 'git -C "$ROOT" clean -ffd'
if reset not in source:
    raise SystemExit('FAIL: bootstrap does not hard-reset to origin/main')
if clean not in source:
    raise SystemExit('FAIL: bootstrap does not remove stale untracked repository state')
if source.index(clean) < source.index(reset):
    raise SystemExit('FAIL: git clean must run after reset --hard')

print('PASS: Kaggle notebook bootstrap removes stale untracked repository state after reset')
PY
