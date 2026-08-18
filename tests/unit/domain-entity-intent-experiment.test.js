import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const loadModule = async () => import('../../src/evaluation/domain-entity-intent-experiment.js').catch(() => ({}))
const hardV3 = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v3-threshold.json', import.meta.url), 'utf8'))

const TARGETS = new Set([
  'en-hard-v3-noanswer-lexical-collision-03',
  'vi-hard-v3-noanswer-lexical-collision-03',
  'vi-hard-v3-noanswer-entity-name-collision-05'
])

function makeRow(item) {
  const answerable = item.answerable !== false
  const target = TARGETS.has(item.id)
  const expected = item.expected_ids?.[0]
  const rank2 = item.id === 'vi-hard-city-19'
  let rawResults = []
  if (answerable) {
    const expectedResult = { id: expected, score: 0.70, type: item.category === 'city-capital' ? 'city' : 'country', name: { en: 'Expected', vi: 'Expected' } }
    rawResults = rank2
      ? [{ id: 'distractor:1', score: 0.72, type: 'country', name: { en: 'Distractor', vi: 'Distractor' } }, expectedResult]
      : [expectedResult]
  } else if (target) {
    rawResults = [{ id: 'collision:1', score: 0.60, type: 'city', name: { en: 'Collision', vi: 'Collision' } }]
  }
  return {
    id: item.id,
    query: item.query,
    language: item.language,
    category: item.category,
    challenge: item.challenge ?? null,
    answerable,
    expectedIds: item.expected_ids ?? [],
    httpStatus: 200,
    responseMappingError: null,
    timingMs: { embedding: 520, qdrant: 8, total: 530, client: 532 },
    rawResults
  }
}

test('200-case experiment eliminates the three proven residual collisions without answerable regression', async () => {
  const { assessDomainEntityIntentExperiment, evaluateDomainEntityIntentRows } = await loadModule()
  assert.equal(typeof assessDomainEntityIntentExperiment, 'function')
  assert.equal(typeof evaluateDomainEntityIntentRows, 'function')
  const rows = evaluateDomainEntityIntentRows(hardV3.map(makeRow))
  const result = assessDomainEntityIntentExperiment(rows)
  assert.equal(result.accepted, true)
  assert.equal(result.baselineFalsePositives.total, 3)
  assert.equal(result.gatedFalsePositives.total, 0)
  assert.deepEqual(result.fixedResidualIds.sort(), [...TARGETS].sort())
  assert.equal(result.answerableRegressions.length, 0)
  assert.equal(result.answerableGateApplications, 0)
  assert.equal(result.gatedQuality.recallAt1, 0.9875)
  assert.equal(result.gatedQuality.mrr, 0.99375)
})

test('experiment fails closed if a target is not present in the baseline or the gate harms an answerable result', async () => {
  const { assessDomainEntityIntentExperiment, evaluateDomainEntityIntentRows } = await loadModule()
  const base = hardV3.map(makeRow)
  const missingTarget = base.find((row) => row.id === 'en-hard-v3-noanswer-lexical-collision-03')
  missingTarget.rawResults = []
  let result = assessDomainEntityIntentExperiment(evaluateDomainEntityIntentRows(base))
  assert.equal(result.accepted, false)
  assert.ok(result.failures.some((failure) => failure.reason === 'baseline-residual-envelope-mismatch'))

  const harmed = hardV3.map(makeRow)
  const positive = harmed.find((row) => row.answerable)
  positive.query = 'What is the plot of the movie Example?'
  positive.rawResults = [{ id: positive.expectedIds[0], score: 0.70, type: 'city', name: { en: 'Example', vi: 'Example' } }]
  result = assessDomainEntityIntentExperiment(evaluateDomainEntityIntentRows(harmed), { requireBaselineResidualEnvelope: false })
  assert.equal(result.accepted, false)
  assert.ok(result.failures.some((failure) => failure.reason === 'answerable-regression'))
})
