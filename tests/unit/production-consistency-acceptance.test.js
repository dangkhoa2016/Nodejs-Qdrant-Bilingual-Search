import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS,
  assessProductionConsistencyAcceptance,
  evaluateProductionConsistencyApiCases
} from '../../src/evaluation/production-consistency-acceptance.js'
import { extractStructuredQueryConstraints } from '../../src/search/relation-consistency-verifier.js'

const hardV3 = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v3-threshold.json', import.meta.url), 'utf8'))
const threshold = 0.55

function responseFor(item) {
  const answerable = item.answerable !== false
  const residualFp = EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS.includes(item.id)
  const rank2 = item.id === 'vi-hard-city-19'
  let results = []
  if (answerable) {
    const expected = { id: item.expected_ids[0], score: 0.70, type: 'country', name: { en: 'Expected', vi: 'Expected' }, facts: {} }
    results = rank2
      ? [{ id: 'distractor:1', score: 0.72, type: 'country', name: { en: 'Distractor', vi: 'Distractor' }, facts: {} }, expected]
      : [expected]
  } else if (residualFp) {
    results = [{ id: 'collision:1', score: 0.60, type: 'city', name: { en: 'Collision', vi: 'Collision' }, facts: {} }]
  }

  const extracted = extractStructuredQueryConstraints(item.query)
  const constrained = Object.keys(extracted).length > 0
  const publicConstraints = {}
  if (extracted.entityType) publicConstraints.entity_type = extracted.entityType
  if (extracted.continent) publicConstraints.continent = extracted.continent
  if (extracted.capital) publicConstraints.capital = extracted.capital
  return {
    status: 200,
    body: {
      query: { text: item.query, language: item.language },
      search: { mode: 'semantic', embedding_model: 'Qwen/Qwen3-Embedding-4B', vector_dimension: 2560, distance: 'Cosine' },
      results,
      meta: {
        count: results.length,
        consistency_verification: {
          enabled: true,
          applied: constrained,
          candidate_limit: constrained ? 25 : 5,
          candidate_count: constrained ? 5 : results.length,
          rejected_count: constrained && !results.length ? 2 : 0,
          constraints: publicConstraints,
          rejection_reason_counts: constrained && !results.length ? { 'entity-type-mismatch': 2 } : {}
        },
        timing_ms: { embedding: 520, qdrant: 8, total: 530 }
      }
    },
    clientElapsedMs: 532
  }
}

test('production evaluator accepts zero-result no-answer responses and captures consistency observability', async () => {
  const noAnswer = hardV3.find((item) => item.id === 'en-hard-v3-noanswer-contradictory-geography-01')
  const [row] = await evaluateProductionConsistencyApiCases([noAnswer], async (item) => responseFor(item))
  assert.equal(row.httpStatus, 200)
  assert.equal(row.resultCount, 0)
  assert.equal(row.top1Id, null)
  assert.equal(row.consistency.enabled, true)
  assert.equal(row.consistency.applied, true)
  assert.equal(row.consistency.candidateLimit, 25)
  assert.equal(row.timingMs.total, 530)
})

test('production acceptance matches the proven experiment envelope: 79/80 rank1, <=3 residual FP, zero targeted FP', async () => {
  const rows = await evaluateProductionConsistencyApiCases(hardV3, async (item) => responseFor(item))
  const preflight = {
    canonical: true,
    collection: 'knowledge_entities_qwen3_4b_text_v21',
    pointsCount: 20000,
    indexedVectorsCount: 20000,
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingDimension: 2560,
    embeddingTextVersion: 'v2.1',
    productionScoreThreshold: threshold,
    searchConsistencyVerificationEnabled: true,
    searchConsistencyCandidateMultiplier: 5,
    queryStrategy: 'prompt',
    queryInstructionId: 'geo-retrieval-v1:d014d3ec6df87e49',
    documentStrategy: 'raw'
  }
  const result = assessProductionConsistencyAcceptance({ preflight, rows })
  assert.equal(result.accepted, true)
  assert.equal(result.answerableQuality.recallAt1, 0.9875)
  assert.equal(result.answerableQuality.mrr, 0.99375)
  assert.equal(result.falsePositives.total, 3)
  assert.equal(result.falsePositives.byChallenge['contradictory-geography'] ?? 0, 0)
  assert.equal(result.falsePositives.byChallenge['plausible-absent-entity'] ?? 0, 0)
  assert.deepEqual(result.falsePositives.ids.sort(), [...EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS].sort())
  assert.deepEqual(result.knownRemainingRank2Cases, [{ id: 'vi-hard-city-19', expectedRank: 2 }])
})

test('production acceptance fails if a targeted contradiction leaks through or an answerable expected entity disappears', async () => {
  const rows = await evaluateProductionConsistencyApiCases(hardV3, async (item) => responseFor(item))
  const preflight = {
    canonical: true,
    collection: 'knowledge_entities_qwen3_4b_text_v21', pointsCount: 20000, indexedVectorsCount: 20000,
    embeddingModel: 'Qwen/Qwen3-Embedding-4B', embeddingDimension: 2560, embeddingTextVersion: 'v2.1',
    productionScoreThreshold: threshold, searchConsistencyVerificationEnabled: true, searchConsistencyCandidateMultiplier: 5,
    queryStrategy: 'prompt', queryInstructionId: 'geo-retrieval-v1:d014d3ec6df87e49', documentStrategy: 'raw'
  }

  const contradiction = rows.find((row) => row.challenge === 'contradictory-geography')
  contradiction.resultCount = 1
  contradiction.top1Id = 'japan'
  contradiction.top1Score = 0.73
  contradiction.resultIds = ['japan']
  let result = assessProductionConsistencyAcceptance({ preflight, rows })
  assert.equal(result.accepted, false)
  assert.ok(result.failures.some((failure) => failure.reason === 'targeted-noanswer-false-positive'))

  contradiction.resultCount = 0
  contradiction.top1Id = null
  contradiction.top1Score = null
  contradiction.resultIds = []
  const positive = rows.find((row) => row.answerable)
  positive.expectedRank = null
  positive.resultCount = 0
  positive.resultIds = []
  result = assessProductionConsistencyAcceptance({ preflight, rows })
  assert.equal(result.accepted, false)
  assert.ok(result.failures.some((failure) => failure.reason === 'answerable-miss'))
})
