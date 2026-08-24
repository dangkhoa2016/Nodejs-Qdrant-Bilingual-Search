#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
COLLECTOR="$ROOT/scripts/kaggle/collect-production-demo-notebook-evidence.sh"
SERVER="$ROOT/src/server.js"
WRAPPER="$ROOT/scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh"
NOTEBOOK="$ROOT/notebooks/kaggle-cpu-fp16-production-demo.ipynb"
ACCEPTANCE="$ROOT/scripts/kaggle/production-demo-acceptance.mjs"

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

grep -F 'PRODUCTION_DEMO_ACCEPTANCE_PASS=14' "$COLLECTOR" >/dev/null || fail 'public evidence gate does not require all fourteen public checks'
grep -F 'AUTHENTICATED_PUBLIC_DEMO=NOT_PROVEN' "$COLLECTOR" >/dev/null || fail 'collector cannot distinguish incomplete public evidence'
pass 'public evidence claims require real public acceptance'

grep -F 'const SEMANTIC_SENTINEL_CHECKS = 10' "$ACCEPTANCE" >/dev/null || fail 'semantic sentinel count is not locked at ten'
grep -F 'const LOCAL_ACCEPTANCE_CHECKS = 13' "$ACCEPTANCE" >/dev/null || fail 'local acceptance count is not locked at thirteen'
grep -F 'const PUBLIC_ACCEPTANCE_CHECKS = 14' "$ACCEPTANCE" >/dev/null || fail 'public acceptance count is not locked at fourteen'
grep -F 'PRODUCTION_DEMO_SEMANTIC_PASS=${semanticChecks}' "$ACCEPTANCE" >/dev/null || fail 'semantic acceptance marker is missing'

for id in \
  VIETNAM_COUNTRY_EN \
  SOUTH_KOREA_COUNTRY_EN \
  HO_CHI_MINH_CITY_ALIAS_EN \
  PARIS_COMPRESSED_EN \
  FRANCE_COUNTRY_VI \
  LONDON_CAPITAL_VI \
  BERLIN_CAPITAL_VI \
  UNITED_KINGDOM_COUNTRY_VI \
  CASABLANCA_MEDIA_EN_NEGATIVE \
  CHELSEA_CLUB_VI_NEGATIVE; do
  grep -F "$id" "$ACCEPTANCE" >/dev/null || fail "semantic acceptance sentinel missing: $id"
done

for showcase_query in \
  'Southeast Asian country whose currency is baht' \
  'thành phố thủ đô của Nhật Bản' \
  'Bắc Kinh, thủ đô của Trung Quốc'; do
  if grep -F "$showcase_query" "$ACCEPTANCE" >/dev/null; then
    fail "acceptance suite duplicates Search Showcase query: $showcase_query"
  fi
done
pass '10-case semantic acceptance is distinct from Search Showcase'

# The release-blocking acceptance runner must show the exact evidence it validated,
# not only aggregate PASS labels. Exercise the real runner against a deterministic
# local mock API so presentation output and fail-closed semantics stay coupled.
PRESENTATION_TMP="$(mktemp -d)"
MOCK_PID=''
cleanup_presentation_mock() {
  if [[ -n "${MOCK_PID:-}" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=''
  fi
  rm -rf "$PRESENTATION_TMP"
}
trap cleanup_presentation_mock EXIT

cat > "$PRESENTATION_TMP/mock-server.mjs" <<'NODEMOCK'
import http from 'node:http'

const mode = process.env.MOCK_ACCEPTANCE_MODE ?? 'pass'
const cases = new Map([
  ['Southeast Asian country with Hanoi as capital and dong as currency', { id: 'geonames:country:1562822', name: 'Vietnam', type: 'country', score: 0.81234 }],
  ['East Asian country with Seoul as capital and won as currency', { id: 'geonames:country:1835841', name: 'South Korea', type: 'country', score: 0.82345 }],
  ['Vietnamese city also known by the Vietnamese alias Sài Gòn', { id: 'geonames:city:1566083', name: 'Ho Chi Minh City', type: 'city', score: 0.83456 }],
  ['France → national capital city', { id: 'geonames:city:2988507', name: 'Paris', type: 'city', score: 0.84567 }],
  ['quốc gia châu Âu có thủ đô Paris và sử dụng đồng euro', { id: 'geonames:country:3017382', name: 'France', type: 'country', score: 0.85678 }],
  ['Thành phố nào là thủ đô Vương quốc Anh?', { id: 'geonames:city:2643743', name: 'London', type: 'city', score: 0.86789 }],
  ['thành phố thủ đô của Đức', { id: 'geonames:city:2950159', name: 'Berlin', type: 'city', score: 0.87891 }],
  ['quốc gia châu Âu có thủ đô Luân Đôn và dùng đồng bảng', { id: 'geonames:country:2635167', name: 'United Kingdom', type: 'country', score: 0.88912 }]
])

const canonicalInfo = {
  config: {
    qdrantCollection: 'knowledge_entities_qwen3_4b_text_v21',
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingDimension: 2560,
    embeddingTransport: 'binary-f32',
    embeddingTextVersion: 'v2.1',
    searchDefaultScoreThreshold: 0.55,
    searchConsistencyVerificationEnabled: true,
    searchConsistencyCandidateMultiplier: 5,
    searchDomainEntityIntentGateEnabled: true
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__presentation_mock') return send(res, 200, { ready: true, mode })
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok' })
  if (req.method === 'GET' && req.url === '/ready') return send(res, 200, { ready: true })
  if (req.method === 'GET' && req.url === '/api/v1/info') return send(res, 200, canonicalInfo)
  if (req.method !== 'POST' || req.url !== '/api/v1/search') return send(res, 404, { error: 'not found' })

  let raw = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const { query } = JSON.parse(raw || '{}')
    if (query === 'What is the plot of the movie Casablanca?') {
      if (mode === 'negative-result') {
        return send(res, 200, { results: [{ id: 'geonames:city:2553604', name: { en: 'Casablanca' }, type: 'city', score: 0.61 }] })
      }
      return send(res, 200, { results: [] })
    }
    if (query === 'Chelsea Football Club đã giành những danh hiệu nào?') return send(res, 200, { results: [] })

    const item = cases.get(query)
    if (!item) return send(res, 500, { error: `unexpected query: ${query}` })
    const id = mode === 'wrong-id' && query.startsWith('Southeast Asian country with Hanoi')
      ? 'geonames:country:9999999'
      : item.id
    return send(res, 200, { results: [{ id, name: { en: item.name }, type: item.type, score: item.score }] })
  })
})

server.listen(3000, '127.0.0.1')
NODEMOCK

start_presentation_mock() {
  local mode="$1"
  MOCK_ACCEPTANCE_MODE="$mode" node "$PRESENTATION_TMP/mock-server.mjs" >"$PRESENTATION_TMP/mock-$mode.log" 2>&1 &
  MOCK_PID=$!
  for _ in {1..50}; do
    if curl -fsS --max-time 1 http://127.0.0.1:3000/__presentation_mock 2>/dev/null | grep -F '"mode":"'$mode'"' >/dev/null; then return 0; fi
    sleep 0.1
  done
  cat "$PRESENTATION_TMP/mock-$mode.log" >&2 || true
  fail "mock acceptance API did not become ready ($mode)"
}

stop_presentation_mock() {
  if [[ -n "${MOCK_PID:-}" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=''
  fi
}

start_presentation_mock pass
node "$ACCEPTANCE" >"$PRESENTATION_TMP/pass.out"
stop_presentation_mock

[[ "$(grep -c '^Query:$' "$PRESENTATION_TMP/pass.out" || true)" -eq 10 ]] || fail 'acceptance output does not print all ten query texts'
[[ "$(grep -c '^Expected:$' "$PRESENTATION_TMP/pass.out" || true)" -eq 10 ]] || fail 'acceptance output does not print ten expected outcomes'
[[ "$(grep -c '^Actual:$' "$PRESENTATION_TMP/pass.out" || true)" -eq 10 ]] || fail 'acceptance output does not print ten actual outcomes'
[[ "$(grep -c '^Score:$' "$PRESENTATION_TMP/pass.out" || true)" -eq 8 ]] || fail 'acceptance output does not print eight positive scores'
grep -F '  Vietnam  [geonames:country:1562822]' "$PRESENTATION_TMP/pass.out" >/dev/null || fail 'positive evidence does not show Vietnam expected/actual identity'
grep -F '  0.8123' "$PRESENTATION_TMP/pass.out" >/dev/null || fail 'positive evidence does not show runtime score'
[[ "$(grep -c '^  NO GEOGRAPHIC RESULT$' "$PRESENTATION_TMP/pass.out" || true)" -eq 2 ]] || fail 'negative evidence does not show expected no-geographic-result twice'
[[ "$(grep -c '^  NO RESULT$' "$PRESENTATION_TMP/pass.out" || true)" -eq 2 ]] || fail 'negative evidence does not show actual no-result twice'
grep -F 'PRODUCTION_DEMO_SEMANTIC_PASS=10' "$PRESENTATION_TMP/pass.out" >/dev/null || fail 'semantic marker changed'
grep -F 'PRODUCTION_DEMO_ACCEPTANCE_PASS=13' "$PRESENTATION_TMP/pass.out" >/dev/null || fail 'local acceptance marker changed'

start_presentation_mock wrong-id
if node "$ACCEPTANCE" >"$PRESENTATION_TMP/wrong-id.out" 2>&1; then
  stop_presentation_mock
  fail 'acceptance no longer fails closed on a wrong top entity ID'
fi
stop_presentation_mock
grep -F 'VIETNAM_COUNTRY_EN: expected top entity geonames:country:1562822' "$PRESENTATION_TMP/wrong-id.out" >/dev/null || fail 'wrong-ID failure is not explicit'

start_presentation_mock negative-result
if node "$ACCEPTANCE" >"$PRESENTATION_TMP/negative-result.out" 2>&1; then
  stop_presentation_mock
  fail 'acceptance no longer fails closed on an unexpected geographic negative result'
fi
stop_presentation_mock
grep -F 'CASABLANCA_MEDIA_EN_NEGATIVE: expected no production result' "$PRESENTATION_TMP/negative-result.out" >/dev/null || fail 'negative false-positive failure is not explicit'

cleanup_presentation_mock
trap - EXIT
pass 'semantic acceptance presentation evidence and fail-closed behavior'

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
for token in ['**English**', '**Tiếng Việt**', 'Required / Bắt buộc', 'Optional / Tùy chọn', 'PRODUCTION_DEMO_ACCEPTANCE_PASS=14']:
    if token not in markdown:
        raise SystemExit(f'FAIL: bilingual notebook guidance missing: {token}')
print('PASS: notebook bilingual optional-public final-status contract')
PY

# Canonical project identity and viewer-facing notebook showcase contract
README_EN="$ROOT/README.md"
README_VI="$ROOT/README.vi.md"
CONTRIBUTING_EN="$ROOT/.github/CONTRIBUTING.md"
CONTRIBUTING_VI="$ROOT/.github/CONTRIBUTING.vi.md"

grep -Fx '# Node.js Qdrant Bilingual Search' "$README_EN" >/dev/null || fail 'English README does not use the canonical project name'
grep -Fx '# Node.js Qdrant Bilingual Search' "$README_VI" >/dev/null || fail 'Vietnamese README does not use the canonical project name'
grep -Fx '# Contributing to Node.js Qdrant Bilingual Search' "$CONTRIBUTING_EN" >/dev/null || fail 'English contributing guide does not use the canonical project name'
grep -Fx '# Đóng góp cho Node.js Qdrant Bilingual Search' "$CONTRIBUTING_VI" >/dev/null || fail 'Vietnamese contributing guide does not use the canonical project name'

if grep -F 'Node.js Qdrant Bilingual Open Knowledge Search' "$README_EN" "$README_VI" "$CONTRIBUTING_EN" "$CONTRIBUTING_VI" >/dev/null; then
  fail 'legacy project brand remains in publication-facing H1 surfaces'
fi
pass 'canonical project naming contract'

python3 - "$NOTEBOOK" <<'PYSHOWCASE'
import json, sys

nb = json.load(open(sys.argv[1], encoding='utf-8'))

def source(cell):
    value = cell.get('source', '')
    return value if isinstance(value, str) else ''.join(value)

markdown_cells = [source(c) for c in nb['cells'] if c.get('cell_type') == 'markdown']
code = '\n'.join(source(c) for c in nb['cells'] if c.get('cell_type') == 'code')

if not markdown_cells:
    raise SystemExit('FAIL: notebook has no markdown cells')
if not markdown_cells[0].startswith('# Node.js Qdrant Bilingual Search\n'):
    raise SystemExit('FAIL: notebook first markdown H1 is not the canonical project name')

for token in [
    'Kaggle CPU-FP16 production demo for **English/Vietnamese semantic search**',
    'Demo production CPU-FP16 trên Kaggle cho **tìm kiếm ngữ nghĩa Anh/Việt**',
    'Search Showcase / Trình diễn tìm kiếm',
]:
    if token not in '\n'.join(markdown_cells):
        raise SystemExit(f'FAIL: notebook presentation missing: {token}')

for token in [
    'http://127.0.0.1:3000/api/v1/search',
    'Southeast Asian country whose currency is baht',
    'thành phố thủ đô của Nhật Bản',
    'Bắc Kinh, thủ đô của Trung Quốc',
    'timing_ms',
    'embedding_ms',
    'qdrant_ms',
    'server_total_ms',
    'client_ms',
    'SEARCH_SHOWCASE=PASS',
]:
    if token not in code:
        raise SystemExit(f'FAIL: notebook search showcase code missing: {token}')

print('PASS: viewer-facing bilingual search showcase contract')
PYSHOWCASE
