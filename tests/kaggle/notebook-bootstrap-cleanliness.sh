#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
NOTEBOOK="$ROOT/notebooks/kaggle-cpu-fp16-production-demo.ipynb"

python3 - "$NOTEBOOK" <<'PY_TEST'
import json, sys
from pathlib import Path

nb = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
first = nb['cells'][0]
if first.get('cell_type') != 'code':
    raise SystemExit('FAIL: notebook cell 0 must be the repository bootstrap code cell')
source = first.get('source', '')
if isinstance(source, list):
    source = ''.join(source)

required_bootstrap = [
    'RELEASE_REF="${RELEASE_REF:-v1.0.0}"',
    'git -C "$ROOT" fetch --force origin "refs/tags/$RELEASE_REF:refs/tags/$RELEASE_REF"',
    'git -C "$ROOT" cat-file -t "refs/tags/$RELEASE_REF"',
    'git -C "$ROOT" rev-parse "$RELEASE_REF^{commit}"',
    'git -C "$ROOT" checkout --detach "$EXPECTED_RELEASE_COMMIT"',
    'git -C "$ROOT" clean -ffd',
    'printf \'%s\\n\' "$RELEASE_REF" > "$ROOT/.git/release-ref"',
]
for token in required_bootstrap:
    if token not in source:
        raise SystemExit(f'FAIL: bootstrap contract missing: {token}')

for forbidden in ['fetch origin main', 'reset --hard origin/main']:
    if forbidden in source:
        raise SystemExit(f'FAIL: moving-main checkout remains: {forbidden}')

checkout = 'git -C "$ROOT" checkout --detach "$EXPECTED_RELEASE_COMMIT"'
clean = 'git -C "$ROOT" clean -ffd'
if source.index(clean) < source.index(checkout):
    raise SystemExit('FAIL: git clean must run after the detached exact-tag checkout')

verification = None
for cell in nb['cells']:
    if cell.get('cell_type') != 'code':
        continue
    cell_source = cell.get('source', '')
    if isinstance(cell_source, list):
        cell_source = ''.join(cell_source)
    if 'RELEASE_SOURCE_IDENTITY = PASS' in cell_source:
        verification = cell_source
        break
if verification is None:
    raise SystemExit('FAIL: exact-tag source verification cell not found')

required_verification = [
    'release_ref_file = ROOT / ".git" / "release-ref"',
    'f"refs/tags/{release_ref}"',
    'f"{release_ref}^{{commit}}"',
    'if head != expected_release_commit:',
    'RELEASE_SOURCE_IDENTITY = PASS',
    'Git status = clean',
]
for token in required_verification:
    if token not in verification:
        raise SystemExit(f'FAIL: exact-tag verification contract missing: {token}')

print('PASS: Kaggle notebook pins annotated v1.0.0, verifies exact tag identity, and cleans stale untracked state')
PY_TEST
