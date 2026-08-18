import test from 'node:test'
import assert from 'node:assert/strict'

const loadModule = async () => import('../../src/evaluation/full20k-collection-ab.js').catch(() => ({}))

function result(id, score, type = 'country') {
  return { id, score, type, name: { en: id, vi: id } }
}

test('full-20k evaluator keeps top-5 quality while probing a wider exact expected rank and target margin', async () => {
  const module = await loadModule()
  assert.equal(typeof module.evaluateFull20kCollectionVariant, 'function')

  const cases = [{
    id: 'q1', language: 'vi', category: 'country-factual', challenge: 'hard-negative',
    query: 'country query', expected_ids: ['target']
  }]
  const resultsByCaseId = new Map([['q1', [
    result('d1', 0.91), result('d2', 0.90), result('d3', 0.89),
    result('d4', 0.88), result('d5', 0.87), result('target', 0.86)
  ]]])

  const variant = module.evaluateFull20kCollectionVariant(cases, resultsByCaseId, { resultLimit: 5, rankProbeLimit: 100 })
  const row = variant.rows[0]
  assert.equal(row.expectedRank, 6)
  assert.deepEqual(row.resultIds, ['d1', 'd2', 'd3', 'd4', 'd5'])
  assert.equal(row.hits.at5, 0)
  assert.equal(row.top1Top2Margin, 0.01)
  assert.equal(row.targetVsBestDistractorMargin, -0.05)
  assert.equal(row.rankProbeLimit, 100)
})

test('full-20k comparison reports the 9 focus cases, regression sentinels, no-answer score deltas and strict acceptance evidence', async () => {
  const module = await loadModule()
  assert.equal(typeof module.compareFull20kCollectionVariants, 'function')
  assert.equal(typeof module.assessFull20kV21Acceptance, 'function')
  assert.ok(Array.isArray(module.FULL20K_FOCUS_CASE_IDS))
  assert.ok(Array.isArray(module.V2_COUNTRY_OVERBIAS_SENTINEL_IDS))
  assert.equal(module.FULL20K_FOCUS_CASE_IDS.length, 9)
  assert.deepEqual(module.V2_COUNTRY_OVERBIAS_SENTINEL_IDS, [
    'en-hard-city-19', 'vi-hard-city-05', 'vi-hard-city-11', 'vi-hard-city-12', 'vi-hard-city-20'
  ])

  const rows = (version) => [
    {
      id: 'focus', language: 'vi', category: 'country-factual', challenge: 'hard-negative', answerable: true,
      expectedIds: ['country'], expectedRank: version === 'v1' ? 2 : 1,
      resultIds: version === 'v1' ? ['city', 'country'] : ['country', 'city'],
      topResults: version === 'v1' ? [result('city', 0.9), result('country', 0.89)] : [result('country', 0.94), result('city', 0.90)],
      top1Top2Margin: version === 'v1' ? 0.01 : 0.04,
      targetVsBestDistractorMargin: version === 'v1' ? -0.01 : 0.04
    },
    {
      id: 'sentinel', language: 'en', category: 'city-capital', challenge: 'compressed', answerable: true,
      expectedIds: ['capital'], expectedRank: 1, resultIds: ['capital', 'country'],
      topResults: [result('capital', 0.92, 'city'), result('country', 0.91)], top1Top2Margin: 0.01,
      targetVsBestDistractorMargin: 0.01
    },
    {
      id: 'implicit', language: 'en', category: 'city-capital', challenge: 'implicit-relation', answerable: true,
      expectedIds: ['capital2'], expectedRank: 1, resultIds: ['capital2', 'country2'],
      topResults: [result('capital2', 0.93, 'city'), result('country2', 0.90)], top1Top2Margin: 0.03,
      targetVsBestDistractorMargin: 0.03
    },
    {
      id: 'noanswer', language: 'en', category: 'no-answer', challenge: 'out-of-domain', answerable: false,
      expectedIds: [], expectedRank: null, resultIds: ['noise'], topResults: [result('noise', version === 'v1' ? 0.52 : 0.50)],
      top1Top2Margin: null, targetVsBestDistractorMargin: null
    }
  ]
  const quality = version => ({ mrr: version === 'v1' ? 5 / 6 : 1, recallAt1: version === 'v1' ? 2 / 3 : 1, recallAt3: 1, recallAt5: 1 })
  const grouped = (version) => ({
    'country-factual': { mrr: version === 'v1' ? 0.5 : 1, recallAt1: version === 'v1' ? 0 : 1, recallAt3: 1, recallAt5: 1 },
    'city-capital': { mrr: 1, recallAt1: 1, recallAt3: 1, recallAt5: 1 }
  })
  const challenges = (version) => ({
    'hard-negative': { mrr: version === 'v1' ? 0.5 : 1, recallAt1: version === 'v1' ? 0 : 1, recallAt3: 1, recallAt5: 1 },
    compressed: { mrr: 1, recallAt1: 1, recallAt3: 1, recallAt5: 1 },
    'implicit-relation': { mrr: 1, recallAt1: 1, recallAt3: 1, recallAt5: 1 }
  })
  const variant = version => ({
    quality: quality(version), qualityByLanguage: {}, qualityByCategory: grouped(version), qualityByChallenge: challenges(version),
    rows: rows(version), noAnswerTop1Score: { min: version === 'v1' ? 0.52 : 0.50, mean: version === 'v1' ? 0.52 : 0.50, p50: version === 'v1' ? 0.52 : 0.50, p90: version === 'v1' ? 0.52 : 0.50, p95: version === 'v1' ? 0.52 : 0.50, p99: version === 'v1' ? 0.52 : 0.50, max: version === 'v1' ? 0.52 : 0.50 }
  })

  const comparison = module.compareFull20kCollectionVariants(variant('v1'), variant('v21'), {
    focusCaseIds: ['focus'], sentinelCaseIds: ['sentinel']
  })
  assert.equal(comparison.focusCases[0].id, 'focus')
  assert.equal(comparison.sentinels[0].v21.expectedRank, 1)
  assert.equal(comparison.noAnswerCases[0].deltaTop1Score, -0.02)

  const acceptance = module.assessFull20kV21Acceptance(variant('v1'), variant('v21'), {
    focusCaseIds: ['focus'], sentinelCaseIds: ['sentinel'],
    criteria: { minOverallRecallAt1Delta: 0.025, minNonNoDiacriticsRecallAt1Delta: 0, maxNewRank1Regressions: 0, maxTop5Misses: 0 }
  })
  assert.equal(acceptance.accepted, true)
  assert.equal(acceptance.checks.sentinelsRemainRank1, true)
  assert.equal(acceptance.checks.allV21TargetsRemainTop5, true)
  assert.deepEqual(acceptance.rank1Regressions, [])
  assert.deepEqual(acceptance.v21Top5Misses, [])
})
