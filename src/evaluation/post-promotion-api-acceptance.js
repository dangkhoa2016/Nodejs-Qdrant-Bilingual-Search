import { assertCanonicalRuntimeConfig, CANONICAL_QWEN_PROFILE } from '../canonical-profile.js'
import { assertFocusedAbRuntime, FOCUSED_AB_RUNTIME } from './focused-text-ab-runner.js'
import { summarizeLatencies } from './metrics.js'

export const POST_PROMOTION_CASE_SPECS = Object.freeze([
  Object.freeze({ id: 'en-hard-country-01', role: 'easy-en', maxExpectedRank: 1 }),
  Object.freeze({ id: 'vi-hard-country-01', role: 'easy-vi', maxExpectedRank: 1 }),
  Object.freeze({ id: 'en-hard-city-19', role: 'v2-country-overbias-sentinel', maxExpectedRank: 1 }),
  Object.freeze({ id: 'vi-hard-city-05', role: 'v2-country-overbias-sentinel', maxExpectedRank: 1 }),
  Object.freeze({ id: 'vi-hard-city-11', role: 'v2-country-overbias-sentinel', maxExpectedRank: 1 }),
  Object.freeze({ id: 'vi-hard-city-12', role: 'v2-country-overbias-sentinel', maxExpectedRank: 1 }),
  Object.freeze({ id: 'vi-hard-city-20', role: 'v2-country-overbias-sentinel', maxExpectedRank: 1 }),
  Object.freeze({ id: 'vi-hard-country-14', role: 'known-v21-rank2', maxExpectedRank: 2 }),
  Object.freeze({ id: 'vi-hard-country-17', role: 'known-v21-rank2', maxExpectedRank: 2 }),
  Object.freeze({ id: 'vi-hard-city-19', role: 'known-v21-rank2', maxExpectedRank: 2 })
])

function finiteTiming(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function firstExpectedRank(results, expectedIds) {
  const expected = new Set(expectedIds)
  const index = results.findIndex((result) => expected.has(result?.id))
  return index < 0 ? null : index + 1
}

export function selectPostPromotionAcceptanceCases(cases) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('Hard-v2 cases are required')
  const byId = new Map(cases.map((item) => [item?.id, item]))
  return POST_PROMOTION_CASE_SPECS.map((spec) => {
    const item = byId.get(spec.id)
    if (!item) throw new Error(`required post-promotion Hard-v2 case is missing: ${spec.id}`)
    return { ...item, role: spec.role, maxExpectedRank: spec.maxExpectedRank }
  })
}

export function assertCanonicalApiPreflight(preflight, { expectedPoints = 20000 } = {}) {
  if (preflight?.ready?.ready !== true) throw new Error('post-promotion API readiness must be true')
  const config = preflight?.info?.config ?? {}
  assertCanonicalRuntimeConfig({
    qdrantCollection: config.qdrantCollection,
    embeddingModel: config.embeddingModel,
    embeddingDimension: config.embeddingDimension,
    embeddingTransport: config.embeddingTransport,
    embeddingTextVersion: config.embeddingTextVersion,
    embeddingTimeoutMs: config.embeddingTimeoutMs,
    searchDefaultScoreThreshold: config.searchDefaultScoreThreshold,
    searchConsistencyVerificationEnabled: config.searchConsistencyVerificationEnabled,
    searchConsistencyCandidateMultiplier: config.searchConsistencyCandidateMultiplier,
    searchDomainEntityIntentGateEnabled: config.searchDomainEntityIntentGateEnabled
  })

  const stats = preflight?.stats ?? {}
  if (String(stats.status ?? '').toLowerCase() !== 'green') {
    throw new Error(`canonical Qdrant status must be green, got ${stats.status ?? 'unknown'}`)
  }
  if (Number(stats.pointsCount) !== expectedPoints) {
    throw new Error(`canonical point count mismatch: expected ${expectedPoints}, got ${stats.pointsCount ?? 'unknown'}`)
  }
  if (Number(stats.indexedVectorsCount) !== expectedPoints) {
    throw new Error(`canonical indexed vector count mismatch: expected ${expectedPoints}, got ${stats.indexedVectorsCount ?? 'unknown'}`)
  }
  const vectors = stats.vectorConfig ?? {}
  if (Number(vectors.size) !== CANONICAL_QWEN_PROFILE.embeddingDimension) {
    throw new Error(`canonical vector dimension mismatch: expected ${CANONICAL_QWEN_PROFILE.embeddingDimension}, got ${vectors.size ?? 'unknown'}`)
  }
  if (String(vectors.distance ?? '').toLowerCase() !== 'cosine') {
    throw new Error(`canonical distance mismatch: expected Cosine, got ${vectors.distance ?? 'unknown'}`)
  }

  const embedding = assertFocusedAbRuntime(preflight?.embedding, FOCUSED_AB_RUNTIME)
  return {
    canonical: true,
    collection: config.qdrantCollection,
    pointsCount: Number(stats.pointsCount),
    indexedVectorsCount: Number(stats.indexedVectorsCount),
    embeddingModel: embedding.model,
    embeddingDimension: embedding.dimension,
    embeddingTextVersion: config.embeddingTextVersion,
    productionScoreThreshold: config.searchDefaultScoreThreshold,
    searchConsistencyVerificationEnabled: config.searchConsistencyVerificationEnabled,
    searchConsistencyCandidateMultiplier: config.searchConsistencyCandidateMultiplier,
    searchDomainEntityIntentGateEnabled: config.searchDomainEntityIntentGateEnabled,
    queryStrategy: embedding.query_strategy,
    queryInstructionId: embedding.query_instruction_id,
    documentStrategy: embedding.document_strategy
  }
}

export async function evaluatePostPromotionApiCases(cases, requestSearch) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('acceptance cases are required')
  if (typeof requestSearch !== 'function') throw new TypeError('requestSearch must be a function')
  const rows = []
  for (const item of cases) {
    const clientStarted = performance.now()
    let response
    try {
      response = await requestSearch(item)
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(error.code) ? error.code : null
      rows.push({
        id: item.id,
        role: item.role,
        language: item.language,
        category: item.category,
        challenge: item.challenge ?? null,
        query: item.query,
        expectedIds: item.expected_ids,
        maxExpectedRank: item.maxExpectedRank,
        httpStatus: 0,
        resultCount: 0,
        top1Id: null,
        top1Score: null,
        expectedRank: null,
        timingMs: { embedding: null, qdrant: null, total: null, client: finiteTiming(performance.now() - clientStarted) },
        requestError: { name: String(error?.name ?? 'Error'), code }
      })
      continue
    }
    const body = response?.body ?? {}
    const results = Array.isArray(body.results) ? body.results : []
    const serverTiming = body?.meta?.timing_ms ?? {}
    const responseMappingChecks = {
      queryText: body?.query?.text === item.query,
      queryLanguage: body?.query?.language === item.language,
      searchMode: body?.search?.mode === 'semantic',
      embeddingModel: body?.search?.embedding_model === CANONICAL_QWEN_PROFILE.embeddingModel,
      vectorDimension: body?.search?.vector_dimension === CANONICAL_QWEN_PROFILE.embeddingDimension,
      distance: String(body?.search?.distance ?? '').toLowerCase() === 'cosine'
    }
    const responseMappingError = Object.values(responseMappingChecks).every(Boolean) ? null : responseMappingChecks
    const row = {
      id: item.id,
      role: item.role,
      language: item.language,
      category: item.category,
      challenge: item.challenge ?? null,
      query: item.query,
      expectedIds: item.expected_ids,
      maxExpectedRank: item.maxExpectedRank,
      httpStatus: Number(response?.status ?? 0),
      resultCount: Number.isInteger(body?.meta?.count) ? body.meta.count : results.length,
      top1Id: results[0]?.id ?? null,
      top1Score: Number.isFinite(results[0]?.score) ? results[0].score : null,
      expectedRank: firstExpectedRank(results, item.expected_ids),
      timingMs: {
        embedding: finiteTiming(serverTiming.embedding),
        qdrant: finiteTiming(serverTiming.qdrant),
        total: finiteTiming(serverTiming.total),
        client: finiteTiming(response?.clientElapsedMs) ?? finiteTiming(performance.now() - clientStarted)
      }
    }
    if (responseMappingError) row.responseMappingError = responseMappingError
    rows.push(row)
  }
  return rows
}

function latencySummary(rows) {
  const summarize = (key) => summarizeLatencies(rows.map((row) => row.timingMs?.[key]).filter((value) => value !== null))
  return {
    embedding: summarize('embedding'),
    qdrant: summarize('qdrant'),
    total: summarize('total'),
    client: summarize('client')
  }
}

export function assessPostPromotionApiAcceptance({ preflight, rows } = {}) {
  if (!preflight?.canonical) throw new Error('verified canonical preflight is required')
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('acceptance rows are required')

  const failures = []
  for (const row of rows) {
    if (row.requestError) failures.push({ id: row.id, reason: 'request-error', error: row.requestError })
    if (row.responseMappingError) failures.push({ id: row.id, reason: 'response-mapping', checks: row.responseMappingError })
    if (row.httpStatus !== 200) failures.push({ id: row.id, reason: 'http-status', observed: row.httpStatus, expected: 200 })
    if (!Number.isInteger(row.resultCount) || row.resultCount < 1 || row.top1Id == null || !Number.isFinite(row.top1Score)) {
      failures.push({ id: row.id, reason: 'invalid-response-contract' })
    }
    if (!Number.isInteger(row.expectedRank) || row.expectedRank < 1 || row.expectedRank > row.maxExpectedRank) {
      failures.push({ id: row.id, reason: 'rank-regression', observed: row.expectedRank, maxExpectedRank: row.maxExpectedRank })
    }
    const missingTiming = ['embedding', 'qdrant', 'total', 'client'].some((key) => finiteTiming(row.timingMs?.[key]) === null)
    if (missingTiming) failures.push({ id: row.id, reason: 'missing-timing' })
  }

  return {
    accepted: failures.length === 0,
    checks: {
      canonicalPreflight: preflight.canonical === true,
      allHttp200: rows.every((row) => row.httpStatus === 200),
      allResponsesMapped: rows.every((row) => !row.responseMappingError && row.resultCount >= 1 && row.top1Id != null && Number.isFinite(row.top1Score)),
      allRanksWithinKnownBounds: rows.every((row) => Number.isInteger(row.expectedRank) && row.expectedRank >= 1 && row.expectedRank <= row.maxExpectedRank),
      allTimingsCaptured: rows.every((row) => ['embedding', 'qdrant', 'total', 'client'].every((key) => finiteTiming(row.timingMs?.[key]) !== null))
    },
    sentinelCases: rows.filter((row) => row.role === 'v2-country-overbias-sentinel').map((row) => ({ id: row.id, expectedRank: row.expectedRank })),
    knownRank2Cases: rows.filter((row) => row.role === 'known-v21-rank2').map((row) => ({ id: row.id, expectedRank: row.expectedRank })),
    latencyMs: latencySummary(rows),
    failures
  }
}

export function buildPostPromotionApiAcceptanceReport({
  generatedAt,
  apiUrl,
  queryPath,
  datasetPath,
  queryCorpusSha256,
  preflightRaw,
  verifiedPreflight,
  rows,
  acceptance
} = {}) {
  if (!generatedAt) throw new TypeError('generatedAt is required')
  if (!apiUrl) throw new TypeError('apiUrl is required')
  if (!queryCorpusSha256) throw new TypeError('queryCorpusSha256 is required')
  if (!verifiedPreflight?.canonical) throw new Error('verified canonical preflight is required')
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('rows are required')
  if (!acceptance || typeof acceptance.accepted !== 'boolean') throw new TypeError('acceptance result is required')

  return {
    generatedAt,
    experiment: 'post_promotion_v21_public_node_api_semantic_acceptance',
    inputs: { apiUrl, queryPath, datasetPath, queryCorpusSha256 },
    requestPolicy: {
      endpoint: 'POST /api/v1/search',
      resultLimit: 5,
      rankingScoreThreshold: 0,
      productionScoreThresholdRetained: verifiedPreflight.productionScoreThreshold,
      rationale: 'Ranking acceptance requests score_threshold=0 to preserve rank evidence; canonical preflight independently requires the retained production default threshold.'
    },
    preflight: {
      ready: preflightRaw?.ready ?? null,
      info: preflightRaw?.info ?? null,
      stats: preflightRaw?.stats ?? null,
      embedding: preflightRaw?.embedding ?? null,
      verified: verifiedPreflight
    },
    cases: rows.length,
    rows,
    acceptance
  }
}
