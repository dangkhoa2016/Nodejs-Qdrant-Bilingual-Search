import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { evaluateProductionConsistencyApiCases } from '../../src/evaluation/production-consistency-acceptance.js'

const hardV3 = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v3-threshold.json', import.meta.url), 'utf8'))

function mediaResponse(item) {
  return {
    status: 200,
    body: {
      query: { text: item.query, language: item.language },
      search: { mode: 'semantic', embedding_model: 'Qwen/Qwen3-Embedding-4B', vector_dimension: 2560, distance: 'Cosine' },
      results: [],
      meta: {
        count: 0,
        consistency_verification: {
          enabled: true,
          applied: false,
          candidate_limit: 5,
          candidate_count: 1,
          rejected_count: 0,
          constraints: {},
          rejection_reason_counts: {}
        },
        domain_entity_intent: {
          enabled: true,
          applied: true,
          intent: { domain: 'media-work', reason: 'media-content-intent' },
          rejected_count: 1,
          rejection_reason_counts: { 'geographic-entity-for-nongeographic-intent': 1 }
        },
        timing_ms: { embedding: 520, qdrant: 8, total: 530 }
      }
    },
    clientElapsedMs: 532
  }
}

test('production API evaluator captures sanitized domain/entity-intent observability', async () => {
  const item = hardV3.find((row) => row.id === 'en-hard-v3-noanswer-lexical-collision-03')
  const [row] = await evaluateProductionConsistencyApiCases([item], async (query) => mediaResponse(query))

  assert.deepEqual(row.domainEntityIntent, {
    enabled: true,
    applied: true,
    intent: { domain: 'media-work', reason: 'media-content-intent' },
    rejectedCount: 1,
    rejectionReasonCounts: { 'geographic-entity-for-nongeographic-intent': 1 }
  })
})

const loadProductionAcceptance = async () => import('../../src/evaluation/production-domain-entity-intent-acceptance.js').catch(() => ({}))

function canonicalPreflight() {
  return {
    canonical: true,
    collection: 'knowledge_entities_qwen3_4b_text_v21',
    pointsCount: 20000,
    indexedVectorsCount: 20000,
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingDimension: 2560,
    embeddingTextVersion: 'v2.1',
    productionScoreThreshold: 0.55,
    searchConsistencyVerificationEnabled: true,
    searchConsistencyCandidateMultiplier: 5,
    searchDomainEntityIntentGateEnabled: true,
    queryStrategy: 'prompt',
    queryInstructionId: 'geo-retrieval-v1:d014d3ec6df87e49',
    documentStrategy: 'raw'
  }
}

test('production domain/entity-intent acceptance requires zero false positives and no positive gate application', async () => {
  const { assessProductionDomainEntityIntentAcceptance } = await loadProductionAcceptance()
  assert.equal(typeof assessProductionDomainEntityIntentAcceptance, 'function')

  const rows = hardV3.map((item) => {
    const answerable = item.answerable !== false
    const rank2 = item.id === 'vi-hard-city-19'
    const expected = { id: item.expected_ids?.[0] ?? null, score: 0.70, type: 'country' }
    const resultIds = answerable
      ? (rank2 ? ['distractor:1', expected.id] : [expected.id])
      : []
    const expectedRank = answerable ? (rank2 ? 2 : 1) : null
    const isMedia = /Casablanca/.test(item.query)
    const isClub = /Chelsea Football Club/.test(item.query)
    const applied = isMedia || isClub
    const rejected = ['en-hard-v3-noanswer-lexical-collision-03', 'vi-hard-v3-noanswer-lexical-collision-03', 'vi-hard-v3-noanswer-entity-name-collision-05'].includes(item.id)
    return {
      id: item.id,
      language: item.language,
      category: item.category,
      challenge: item.challenge ?? null,
      query: item.query,
      answerable,
      expectedIds: item.expected_ids,
      httpStatus: 200,
      resultCount: resultIds.length,
      top1Id: resultIds[0] ?? null,
      top1Score: resultIds.length ? 0.70 : null,
      expectedRank,
      resultIds,
      topResults: resultIds.map((id) => ({ id, score: 0.70, type: 'country' })),
      consistency: { enabled: true, applied: false, candidateLimit: 5, candidateCount: resultIds.length, rejectedCount: 0, constraints: {}, rejectionReasonCounts: {} },
      domainEntityIntent: {
        enabled: true,
        applied,
        intent: applied
          ? (isMedia ? { domain: 'media-work', reason: 'media-content-intent' } : { domain: 'sports-club', reason: 'sports-club-achievement-intent' })
          : null,
        rejectedCount: rejected ? 1 : 0,
        rejectionReasonCounts: rejected ? { 'geographic-entity-for-nongeographic-intent': 1 } : {}
      },
      timingMs: { embedding: 520, qdrant: 8, total: 530, client: 532 }
    }
  })

  const result = assessProductionDomainEntityIntentAcceptance({ preflight: canonicalPreflight(), rows })
  assert.equal(result.accepted, true)
  assert.equal(result.falsePositives.total, 0)
  assert.equal(result.answerableGateApplications, 0)
  assert.equal(result.gate.appliedQueries, 4)
  assert.equal(result.gate.rejectedQueries, 3)
})
