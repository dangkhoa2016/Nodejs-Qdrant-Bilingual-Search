import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const loadRunner = async () => readFile(new URL('../../scripts/benchmark/expanded-noanswer-v21-api.mjs', import.meta.url), 'utf8').catch(() => '')
const loadCalibration = async () => readFile(new URL('../../scripts/benchmark/calibrate-expanded-v21-threshold.mjs', import.meta.url), 'utf8').catch(() => '')
const loadWrapper = async () => readFile(new URL('../../scripts/benchmark/run-expanded-v21-threshold.sh', import.meta.url), 'utf8').catch(() => '')

const CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'

test('package exposes separate expanded no-answer API collection, offline calibration, and evidence commands', () => {
  assert.equal(packageJson.scripts['benchmark:expanded-v21-noanswer-api'], 'NODE_ENV=development node scripts/benchmark/expanded-noanswer-v21-api.mjs')
  assert.equal(packageJson.scripts['benchmark:calibrate-expanded-v21-threshold'], 'node scripts/benchmark/calibrate-expanded-v21-threshold.mjs')
  assert.equal(packageJson.scripts['benchmark:expanded-v21-threshold'], 'bash scripts/benchmark/run-expanded-v21-threshold.sh')
})

test('expanded API benchmark locks Hard-v3 threshold corpus, canonical 20k preflight and uncensored public API requests', async () => {
  const source = await loadRunner()
  assert.match(source, /bilingual-hard-v3-threshold\.json/)
  assert.match(source, new RegExp(CORPUS_SHA256))
  assert.match(source, /cases\.length !== 200/)
  assert.match(source, /answerableCount !== 80/)
  assert.match(source, /noAnswerCount !== 120/)
  assert.match(source, /POST \/api\/v1\/search|\/api\/v1\/search/)
  assert.match(source, /score_threshold:\s*0/)
  assert.match(source, /collectBenchmarkPreflight/)
  assert.match(source, /assertCanonicalApiPreflight/)
  assert.match(source, /expanded-noanswer-v21-api\.json/)
})

test('expanded calibration is offline and fail-closes on the committed corpus SHA', async () => {
  const source = await loadCalibration()
  assert.match(source, /expanded-noanswer-v21-api\.json/)
  assert.match(source, /expanded-v21-threshold-calibration\.json/)
  assert.match(source, /calibrateExpandedNoAnswerThreshold/)
  assert.match(source, new RegExp(CORPUS_SHA256))
  assert.doesNotMatch(source, /fetch\(/)
})

test('evidence wrapper verifies canonical runtime, runs collection then offline calibration, hashes outputs and creates a zip', async () => {
  const source = await loadWrapper()
  assert.match(source, /verify:canonical-config/)
  assert.match(source, /verify:semantic-index -- 20000/)
  assert.match(source, /seed:status -- --once --expected 20000/)
  assert.match(source, /benchmark:expanded-v21-noanswer-api/)
  assert.match(source, /benchmark:calibrate-expanded-v21-threshold/)
  assert.match(source, /sha256sum/)
  assert.match(source, /zip/)
  assert.match(source, /EXPANDED_V21_THRESHOLD_BENCHMARK=COMPLETE/)
})
