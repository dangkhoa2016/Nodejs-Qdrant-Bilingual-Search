import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const loadRunner = async () => readFile(new URL('../../scripts/benchmark/v21-consistency-verification.mjs', import.meta.url), 'utf8').catch(() => '')
const loadWrapper = async () => readFile(new URL('../../scripts/benchmark/run-v21-consistency-verification.sh', import.meta.url), 'utf8').catch(() => '')
const CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'

test('package exposes the consistency verification experiment and evidence wrapper', () => {
  assert.equal(packageJson.scripts['benchmark:v21-consistency-verification:run'], 'NODE_ENV=development node scripts/benchmark/v21-consistency-verification.mjs')
  assert.equal(packageJson.scripts['benchmark:v21-consistency-verification'], 'bash scripts/benchmark/run-v21-consistency-verification.sh')
})

test('runner locks Hard-v3, canonical 20k preflight, public API requests, and production threshold 0.55', async () => {
  const source = await loadRunner()
  assert.match(source, /bilingual-hard-v3-threshold\.json/)
  assert.match(source, new RegExp(CORPUS_SHA256))
  assert.match(source, /collectBenchmarkPreflight/)
  assert.match(source, /assertCanonicalApiPreflight/)
  assert.match(source, /\/api\/v1\/search/)
  assert.match(source, /score_threshold:\s*0/)
  assert.match(source, /applyConsistencyVerification/)
  assert.match(source, /assessConsistencyExperiment/)
  assert.match(source, /embedding_model/)
  assert.match(source, /vector_dimension/)
  assert.match(source, /distance/)
  assert.match(source, /0\.55/)
  assert.match(source, /v21-consistency-verification\.json/)
})

test('wrapper captures canonical checks, report, log, sha256, and zip evidence', async () => {
  const source = await loadWrapper()
  assert.match(source, /verify:canonical-config/)
  assert.match(source, /verify:semantic-index -- 20000/)
  assert.match(source, /seed:status -- --once --expected 20000/)
  assert.match(source, /benchmark:v21-consistency-verification:run/)
  assert.match(source, /sha256sum/)
  assert.match(source, /zip/)
  assert.match(source, /V21_CONSISTENCY_VERIFICATION=COMPLETE/)
})
