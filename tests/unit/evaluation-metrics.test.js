import test from 'node:test'
import assert from 'node:assert/strict'
import { reciprocalRank, hitAtK, summarizeEvaluation, summarizeLatencies, evaluateQueryCases } from '../../src/evaluation/metrics.js'

test('reciprocalRank rewards the first expected result position', () => {
  assert.equal(reciprocalRank(['Q1', 'Q869', 'Q2'], ['Q869']), 0.5)
  assert.equal(reciprocalRank(['Q1'], ['Q869']), 0)
})

test('hitAtK handles one or multiple acceptable IDs', () => {
  assert.equal(hitAtK(['Q1', 'Q2'], ['Q2', 'Q3'], 1), 0)
  assert.equal(hitAtK(['Q1', 'Q2'], ['Q2', 'Q3'], 2), 1)
})

test('summarizeEvaluation computes deterministic Recall@K and MRR', () => {
  const summary = summarizeEvaluation([
    { resultIds: ['Q1', 'Q2'], expectedIds: ['Q1'] },
    { resultIds: ['Q3', 'Q2'], expectedIds: ['Q2'] }
  ], [1, 2])
  assert.equal(summary.recallAt1, 0.5)
  assert.equal(summary.recallAt2, 1)
  assert.equal(summary.mrr, 0.75)
})

test('summarizeLatencies reports stable nearest-rank percentiles', () => {
  assert.deepEqual(summarizeLatencies([1, 2, 3, 4]), { min: 1, mean: 2.5, p50: 2, p90: 4, p95: 4, p99: 4, max: 4 })
})

test('evaluateQueryCases reports both aggregate and per-language quality', async () => {
  const report = await evaluateQueryCases([
    { id: 'en1', language: 'en', query: 'Thailand', expected_ids: ['Q869'] },
    { id: 'vi1', language: 'vi', query: 'Thái Lan', expected_ids: ['Q869'] }
  ], async (item) => ({ results: [{ id: item.id === 'en1' ? 'Q869' : 'Q1' }, { id: 'Q869' }], meta: { took_ms: 10 } }))
  assert.equal(report.quality.recallAt1, 0.5)
  assert.equal(report.qualityByLanguage.en.recallAt1, 1)
  assert.equal(report.qualityByLanguage.vi.recallAt1, 0)
  assert.equal(report.latencyMs.p95, 10)
})

test('evaluateQueryCases prefers server-side total timing when available', async () => {
  const report = await evaluateQueryCases([{ id: 'x', language: 'en', query: 'x', expected_ids: ['Q1'] }], async () => ({ results: [{ id: 'Q1' }], meta: { timing_ms: { total: 7.5 } } }))
  assert.equal(report.latencyMs.mean, 7.5)
})

test('evaluateQueryCases captures ranking evidence, category quality and component latency', async () => {
  const report = await evaluateQueryCases([
    { id: 'country-en', language: 'en', category: 'country-factual', query: 'country', expected_ids: ['C1'] },
    { id: 'city-vi', language: 'vi', category: 'city-capital', query: 'city', expected_ids: ['CITY1'] }
  ], async (item) => item.id === 'country-en'
    ? {
        results: [
          { id: 'X', score: 0.91, type: 'country', name: { en: 'Wrong', vi: null } },
          { id: 'C1', score: 0.88, type: 'country', name: { en: 'Expected', vi: null } }
        ],
        meta: { timing_ms: { embedding: 4, qdrant: 2, total: 7 } }
      }
    : {
        results: [{ id: 'CITY1', score: 0.95, type: 'city', name: { en: 'City', vi: 'Thành phố' } }],
        meta: { timing_ms: { embedding: 6, qdrant: 3, total: 10 } }
      })

  assert.equal(report.rows[0].expectedRank, 2)
  assert.deepEqual(report.rows[0].hits, { at1: 0, at3: 1, at5: 1 })
  assert.deepEqual(report.rows[0].topResults[1], {
    id: 'C1', score: 0.88, type: 'country', name: { en: 'Expected', vi: null }
  })
  assert.equal(report.qualityByCategory['country-factual'].recallAt1, 0)
  assert.equal(report.qualityByCategory['city-capital'].recallAt1, 1)
  assert.equal(report.qualityByLanguageAndCategory.en['country-factual'].mrr, 0.5)
  assert.equal(report.latencyMsByComponent.embedding.mean, 5)
  assert.equal(report.latencyMsByComponent.qdrant.mean, 2.5)
  assert.equal(report.latencyMsByComponent.total.mean, 8.5)
  assert.ok(report.latencyMsByComponent.client.mean >= 0)
})

test('evaluateQueryCases omits missing server component timings without corrupting summaries', async () => {
  const report = await evaluateQueryCases([
    { id: 'x', language: 'en', category: 'country-factual', query: 'x', expected_ids: ['Q1'] }
  ], async () => ({ results: [{ id: 'Q1', score: 1 }], meta: { took_ms: 12 } }))

  assert.deepEqual(report.latencyMsByComponent.embedding, { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 })
  assert.deepEqual(report.latencyMsByComponent.qdrant, { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 })
  assert.equal(report.latencyMsByComponent.total.mean, 12)
})

test('evaluateQueryCases separates no-answer cases from ranking quality and reports score margins', async () => {
  const report = await evaluateQueryCases([
    { id: 'positive', language: 'en', category: 'country-factual', challenge: 'hard-negative', query: 'country', expected_ids: ['C1'] },
    { id: 'negative', language: 'vi', category: 'no-answer', challenge: 'out-of-domain', query: 'không liên quan', expected_ids: [], answerable: false }
  ], async (item) => item.id === 'positive'
    ? {
        results: [
          { id: 'C1', score: 0.61, type: 'country' },
          { id: 'CITY1', score: 0.59, type: 'city' }
        ],
        meta: { timing_ms: { total: 5 } }
      }
    : {
        results: [
          { id: 'CITY2', score: 0.42, type: 'city' },
          { id: 'CITY3', score: 0.40, type: 'city' }
        ],
        meta: { timing_ms: { total: 6 } }
      }, { decisionThreshold: 0.55 })

  assert.equal(report.quality.recallAt1, 1)
  assert.equal(report.answerableCases, 1)
  assert.equal(report.noAnswerCases, 1)
  assert.equal(report.rows[0].top1Top2Margin, 0.02)
  assert.equal(report.rows[1].top1Top2Margin, 0.02)
  assert.equal(report.rankingMargins.mean, 0.02)
  assert.equal(report.qualityByChallenge['hard-negative'].recallAt1, 1)
  assert.deepEqual(report.decisionQuality, {
    threshold: 0.55,
    accuracy: 1,
    answerableTop1Accuracy: 1,
    noAnswerAccuracy: 1
  })
})

test('decision quality reports null for an absent no-answer cohort', async () => {
  const report = await evaluateQueryCases([
    { id: 'positive-only', language: 'en', category: 'country-factual', query: 'country', expected_ids: ['C1'] }
  ], async () => ({ results: [{ id: 'C1', score: 0.6 }], meta: { took_ms: 1 } }), { decisionThreshold: 0.55 })

  assert.equal(report.decisionQuality.answerableTop1Accuracy, 1)
  assert.equal(report.decisionQuality.noAnswerAccuracy, null)
})
