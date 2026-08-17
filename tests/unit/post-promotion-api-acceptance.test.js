import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  POST_PROMOTION_CASE_SPECS,
  assessPostPromotionApiAcceptance,
  buildPostPromotionApiAcceptanceReport,
  assertCanonicalApiPreflight,
  evaluatePostPromotionApiCases,
  selectPostPromotionAcceptanceCases
} from '../../src/evaluation/post-promotion-api-acceptance.js'

const hardV2 = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v2.json', import.meta.url), 'utf8'))

function canonicalPreflight() {
  return {
    ready: { ready: true },
    info: {
      config: {
        qdrantCollection: 'knowledge_entities_qwen3_4b_text_v21',
        embeddingModel: 'Qwen/Qwen3-Embedding-4B',
        embeddingDimension: 2560,
        embeddingTransport: 'binary-f32',
        embeddingTextVersion: 'v2.1',
        embeddingTimeoutMs: 120000,
        searchDefaultScoreThreshold: 0.55,
        searchConsistencyVerificationEnabled: true,
        searchConsistencyCandidateMultiplier: 5,
        searchDomainEntityIntentGateEnabled: true
      }
    },
    stats: {
      status: 'green',
      pointsCount: 20000,
      indexedVectorsCount: 20000,
      vectorConfig: { size: 2560, distance: 'Cosine' }
    },
    embedding: {
      model: 'Qwen/Qwen3-Embedding-4B',
      dimension: 2560,
      backend: 'sentence-transformers',
      implementation: 'python-fastapi',
      semantic: true,
      accelerator: 'gpu',
      device: 'cuda',
      dtype: 'float16',
      runtime: 'pytorch-cuda',
      profile: 'qwen3',
      query_strategy: 'prompt',
      query_instruction_id: 'geo-retrieval-v1:d014d3ec6df87e49',
      document_strategy: 'raw'
    }
  }
}

function responseFor(item, rank = 1) {
  const expected = item.expected_ids[0]
  const distractors = [
    { id: 'distractor:1', score: 0.81 },
    { id: 'distractor:2', score: 0.71 }
  ]
  const results = rank === 1
    ? [{ id: expected, score: 0.82 }, ...distractors]
    : [{ id: 'distractor:1', score: 0.83 }, { id: expected, score: 0.82 }, distractors[1]]
  return {
    status: 200,
    body: {
      query: { text: item.query, language: item.language },
      search: { mode: 'semantic', embedding_model: 'Qwen/Qwen3-Embedding-4B', vector_dimension: 2560, distance: 'Cosine' },
      results,
      meta: { count: results.length, timing_ms: { embedding: 12.5, qdrant: 3.5, total: 18.25 } }
    },
    clientElapsedMs: 19
  }
}

test('post-promotion selection reuses exact Hard-v2 queries and covers the required roles', () => {
  const selected = selectPostPromotionAcceptanceCases(hardV2)
  assert.equal(selected.length, 10)
  assert.equal(new Set(selected.map((item) => item.id)).size, selected.length)
  assert.deepEqual(selected.map((item) => item.id), POST_PROMOTION_CASE_SPECS.map((item) => item.id))
  for (const item of selected) {
    const source = hardV2.find((candidate) => candidate.id === item.id)
    assert.equal(item.query, source.query)
    assert.deepEqual(item.expected_ids, source.expected_ids)
  }
  assert.equal(selected.filter((item) => item.role === 'v2-country-overbias-sentinel').length, 5)
  assert.equal(selected.filter((item) => item.role === 'known-v21-rank2').length, 3)
  assert.ok(selected.some((item) => item.role === 'easy-en'))
  assert.ok(selected.some((item) => item.role === 'easy-vi'))
  assert.ok(selected.some((item) => item.challenge === 'hard-negative'))
  assert.ok(selected.some((item) => item.challenge === 'compressed'))
  assert.ok(selected.some((item) => item.challenge === 'no-diacritics'))
})

test('canonical API preflight requires the promoted v2.1 runtime, green 20k index, and exact embedding runtime', () => {
  const result = assertCanonicalApiPreflight(canonicalPreflight())
  assert.equal(result.canonical, true)
  assert.equal(result.pointsCount, 20000)
  assert.equal(result.indexedVectorsCount, 20000)
  assert.equal(result.queryInstructionId, 'geo-retrieval-v1:d014d3ec6df87e49')
})

test('canonical API preflight fails closed when production domain/entity-intent gate is disabled', () => {
  const disabled = canonicalPreflight()
  disabled.info.config.searchDomainEntityIntentGateEnabled = false
  assert.throws(() => assertCanonicalApiPreflight(disabled), /searchDomainEntityIntentGateEnabled=false/)
})

test('canonical API preflight fails closed when production consistency verification is disabled or mis-sized', () => {
  const disabled = canonicalPreflight()
  disabled.info.config.searchConsistencyVerificationEnabled = false
  assert.throws(() => assertCanonicalApiPreflight(disabled), /searchConsistencyVerificationEnabled=false/)

  const wrongMultiplier = canonicalPreflight()
  wrongMultiplier.info.config.searchConsistencyCandidateMultiplier = 1
  assert.throws(() => assertCanonicalApiPreflight(wrongMultiplier), /searchConsistencyCandidateMultiplier=1/)
})

test('canonical API preflight fails closed on rollback collection or incomplete indexing', () => {
  const rollback = canonicalPreflight()
  rollback.info.config.qdrantCollection = 'knowledge_entities_qwen3_4b_v1'
  assert.throws(() => assertCanonicalApiPreflight(rollback), /canonical runtime config mismatch/)

  const incomplete = canonicalPreflight()
  incomplete.stats.indexedVectorsCount = 19999
  assert.throws(() => assertCanonicalApiPreflight(incomplete), /indexed vector count mismatch/)
})

test('API evaluator captures HTTP contract, expected rank, score, result count, and timing', async () => {
  const selected = selectPostPromotionAcceptanceCases(hardV2).slice(0, 2)
  const rows = await evaluatePostPromotionApiCases(selected, async (item) => responseFor(item, 1))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    id: selected[0].id,
    role: selected[0].role,
    language: selected[0].language,
    category: selected[0].category,
    challenge: selected[0].challenge,
    query: selected[0].query,
    expectedIds: selected[0].expected_ids,
    maxExpectedRank: 1,
    httpStatus: 200,
    resultCount: 3,
    top1Id: selected[0].expected_ids[0],
    top1Score: 0.82,
    expectedRank: 1,
    timingMs: { embedding: 12.5, qdrant: 3.5, total: 18.25, client: 19 }
  })
})

test('acceptance permits known rank-2 cases at rank 1 or 2 but rejects any sentinel below rank 1', async () => {
  const selected = selectPostPromotionAcceptanceCases(hardV2)
  const rows = await evaluatePostPromotionApiCases(selected, async (item) => {
    const rank = item.role === 'known-v21-rank2' ? 2 : 1
    return responseFor(item, rank)
  })
  const accepted = assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows })
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.failures.length, 0)

  const sentinel = rows.find((row) => row.role === 'v2-country-overbias-sentinel')
  sentinel.expectedRank = 2
  sentinel.top1Id = 'distractor:sentinel'
  const rejected = assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows })
  assert.equal(rejected.accepted, false)
  assert.ok(rejected.failures.some((failure) => failure.id === sentinel.id && failure.reason === 'rank-regression'))
})

test('acceptance rejects a known rank-2 case if it falls below rank 2 and rejects missing timings/HTTP failures', async () => {
  const selected = selectPostPromotionAcceptanceCases(hardV2)
  const rows = await evaluatePostPromotionApiCases(selected, async (item) => responseFor(item, item.role === 'known-v21-rank2' ? 2 : 1))
  const hard = rows.find((row) => row.role === 'known-v21-rank2')
  hard.expectedRank = 3
  assert.equal(assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows }).accepted, false)

  hard.expectedRank = 2
  hard.timingMs.embedding = null
  assert.ok(assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows }).failures.some((failure) => failure.reason === 'missing-timing'))

  hard.timingMs.embedding = 12.5
  hard.httpStatus = 503
  assert.ok(assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows }).failures.some((failure) => failure.reason === 'http-status'))
})

test('API evaluator records a request failure instead of losing the remaining evidence', async () => {
  const [item] = selectPostPromotionAcceptanceCases(hardV2)
  const rows = await evaluatePostPromotionApiCases([item], async () => {
    const error = new Error('secret-bearing transport detail')
    error.code = 'ETIMEDOUT'
    throw error
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].httpStatus, 0)
  assert.equal(rows[0].requestError.name, 'Error')
  assert.equal(rows[0].requestError.code, 'ETIMEDOUT')
  assert.equal(JSON.stringify(rows[0]).includes('secret-bearing transport detail'), false)
  const result = assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows })
  assert.equal(result.accepted, false)
  assert.ok(result.failures.some((failure) => failure.reason === 'request-error'))
})


test('report records ranking threshold separately from retained production threshold and keeps evidence snapshots', async () => {
  const selected = selectPostPromotionAcceptanceCases(hardV2)
  const rows = await evaluatePostPromotionApiCases(selected, async (item) => responseFor(item, item.role === 'known-v21-rank2' ? 2 : 1))
  const verifiedPreflight = assertCanonicalApiPreflight(canonicalPreflight())
  const acceptance = assessPostPromotionApiAcceptance({ preflight: verifiedPreflight, rows })
  const report = buildPostPromotionApiAcceptanceReport({
    generatedAt: '2026-08-26T07:30:00.000Z',
    apiUrl: 'http://127.0.0.1:3000',
    queryPath: '/repo/benchmarks/queries/bilingual-hard-v2.json',
    datasetPath: '/repo/data/generated/entities.final.json',
    queryCorpusSha256: '3f0ebee543de7fe93ef3add07fef390e88ab56f03f4b1b57ef71f8588e44bacc',
    preflightRaw: canonicalPreflight(),
    verifiedPreflight,
    rows,
    acceptance
  })
  assert.equal(report.experiment, 'post_promotion_v21_public_node_api_semantic_acceptance')
  assert.equal(report.requestPolicy.endpoint, 'POST /api/v1/search')
  assert.equal(report.requestPolicy.rankingScoreThreshold, 0)
  assert.equal(report.requestPolicy.productionScoreThresholdRetained, 0.55)
  assert.equal(report.preflight.verified.canonical, true)
  assert.equal(report.cases, 10)
  assert.equal(report.acceptance.accepted, true)
})


test('acceptance rejects public API response mapping that does not echo the request or canonical search metadata', async () => {
  const [item] = selectPostPromotionAcceptanceCases(hardV2)
  const [row] = await evaluatePostPromotionApiCases([item], async (selected) => {
    const response = responseFor(selected, 1)
    response.body.query.text = 'wrong query'
    response.body.search.embedding_model = 'intfloat/multilingual-e5-small'
    return response
  })
  const result = assessPostPromotionApiAcceptance({ preflight: assertCanonicalApiPreflight(canonicalPreflight()), rows: [row] })
  assert.equal(result.accepted, false)
  assert.ok(result.failures.some((failure) => failure.reason === 'response-mapping'))
})
