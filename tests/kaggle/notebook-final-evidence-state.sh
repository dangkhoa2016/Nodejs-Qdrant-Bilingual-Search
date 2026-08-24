#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
NOTEBOOK="$ROOT/notebooks/kaggle-cpu-fp16-production-demo.ipynb"

python3 - "$NOTEBOOK" <<'PY'
import json, sys
from pathlib import Path

nb = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
code_cells = []
markdown_cells = []
for cell in nb['cells']:
    source = cell.get('source', '')
    if isinstance(source, list):
        source = ''.join(source)
    if cell.get('cell_type') == 'code':
        code_cells.append(source)
    elif cell.get('cell_type') == 'markdown':
        markdown_cells.append(source)
code = '\n'.join(code_cells)
markdown = '\n'.join(markdown_cells)

required_code = [
    'evidence_completed = False',
    'evidence_completed = True',
    'EVIDENCE_COLLECTION=PASS',
    'EVIDENCE_COLLECTION=FAIL',
    'PRODUCTION_ORIENTED_DEMO_NOTEBOOK=INCOMPLETE',
]
for token in required_code:
    if token not in code:
        raise SystemExit(f'FAIL: notebook evidence-state token missing: {token}')

if code.index('evidence_completed = True') < code.index('collect-production-demo-notebook-evidence.sh'):
    raise SystemExit('FAIL: evidence completion is marked before evidence collection is invoked')

final_cells = [src for src in code_cells if 'PRODUCTION_ORIENTED_DEMO_NOTEBOOK=' in src]
if len(final_cells) != 1:
    raise SystemExit(f'FAIL: expected exactly one final status code cell, found {len(final_cells)}')
final = final_cells[0]
if 'if evidence_completed:' not in final:
    raise SystemExit('FAIL: overall notebook PASS is not conditional on completed evidence collection')
if 'print("PRODUCTION_ORIENTED_DEMO_NOTEBOOK=PASS")' not in final:
    raise SystemExit('FAIL: successful overall PASS marker missing')
if 'print("PRODUCTION_ORIENTED_DEMO_NOTEBOOK=INCOMPLETE")' not in final:
    raise SystemExit('FAIL: fail-closed overall INCOMPLETE marker missing')

for token in [
    'runtime snapshots',
    'source checkout',
    'evidence packaging',
]:
    if token.lower() not in markdown.lower():
        raise SystemExit(f'FAIL: bilingual notebook guidance missing evidence/runtime explanation: {token}')

print('PASS: notebook overall status fails closed unless evidence packaging completes')
PY
