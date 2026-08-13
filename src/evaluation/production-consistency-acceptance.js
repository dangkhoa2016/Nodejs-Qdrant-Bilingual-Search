import { CANONICAL_QWEN_PROFILE } from '../canonical-profile.js'
import { extractStructuredQueryConstraints } from '../search/relation-consistency-verifier.js'
import { summarizeEvaluation, summarizeLatencies } from './metrics.js'

export const EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS = Object.freeze([
  'en-hard-v3-noanswer-lexical-collision-03',
  'vi-hard-v3-noanswer-lexical-collision-03',
  'vi-hard-v3-noanswer-entity-name-collision-05'
])

const EXPECTED_CASES = 200
const EXPECTED_ANSWERABLE = 80
const EXPECTED_NO_ANSWER = 120
const RESULT_LIMIT = 5
const PRODUCTION_THRESHOLD = 0.55
const REMAINING_RANK2_ID = 'vi-hard-city-19'

function finiteTiming(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function firstExpectedRank(results, expectedIds) {
  const expected = new Set(expectedIds ?? [])
  const index = (results ?? []).findIndex((result) => expected.has(result?.id))
  return index < 0 ? null : index + 1
}

function publicConstraints(constraints) {
  const result = {}
  if (constraints.entityType) result.entity_type = constraints.entityType
  if (constraints.continent) result.continent = constraints.continent
  if (constraints.capital) result.capital = constraints.capital
  return result
}

function normalizeConsistency(meta, query) {
  const expectedConstraints = publicConstraints(extractStructuredQueryConstraints(query))
  const expectedApplied = Object.keys(expectedConstraints).length > 0
  const observed = meta?.consistency_verification ?? {}
  return {
    enabled: observed.enabled === true,
    applied: observed.applied === true,
    candidateLimit: Number.isInteger(observed.candidate_limit) ? observed.candidate_limit : null,
    candidateCount: Number.isInteger(observed.candidate_count) ? observed.candidate_count : null,
    rejectedCount: Number.isInteger(observed.rejected_count) ? observed.rejected_count : null,
    constraints: observed.constraints && typeof observed.constraints === 'object' ? observed.constraints : null,
    rejectionReasonCounts: observed.rejection_reason_counts && typeof observed.rejection_reason_counts === 'object' ? observed.rejection_reason_counts : null,
    expectedApplied,
    expectedConstraints
  }
}

function normalizeDomainEntityIntent(meta) {
  const observed = meta?.domain_entity_intent ?? {}
  return {
    enabled: observed.enabled === true,
    applied: observed.applied === true,
    intent: observed.intent && typeof observed.intent === 'object' ? observed.intent : null,
    rejectedCount: Number.isInteger(observed.rejected_count) ? observed.rejected_count : null,
    rejectionReasonCounts: observed.rejection_reason_counts && typeof observed.rejection_reason_counts === 'object' ? observed.rejection_reason_counts : null
  }
}

function responseMappingError(body, item, consistency) {
  const checks = {
    queryText: body?.query?.text === item.query,
    queryLanguage: body?.query?.language === item.language,
    searchMode: body?.search?.mode === 'semantic',
    embeddingModel: body?.search?.embedding_model === CANONICAL_QWEN_PROFILE.embeddingModel,
    vectorDimension: body?.search?.vector_dimension === CANONICAL_QWEN_PROFILE.embeddingDimension,
    distance: String(body?.search?.distance ?? '').toLowerCase() === 'cosine',
    consistencyEnabled: consistency.enabled === true,
    consistencyApplied: consistency.applied === consistency.expectedApplied,
    consistencyConstraints: JSON.stringify(consistency.constraints ?? {}) === JSON.stringify(consistency.expectedConstraints),
    consistencyCandidateLimit: consistency.candidateLimit === (consistency.expectedApplied ? 25 : RESULT_LIMIT),
    consistencyCandidateCount: Number.isInteger(consistency.candidateCount) && consistency.candidateCount >= 0,
    consistencyRejectedCount: Number.isInteger(consistency.rejectedCount) && consistency.rejectedCount >= 0,
    consistencyReasonCounts: consistency.rejectionReasonCounts !== null
  }
  return Object.values(checks).every(Boolean) ? null : checks
}

export async function evaluateProductionConsistencyApiCases(cases, requestSearch) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('production consistency cases are required')
  if (typeof requestSearch !== 'function') throw new TypeError('requestSearch must be a function')
  const rows = []

  for (const item of cases) {
    const answerable = item.answerable !== false
    const clientStarted = performance.now()
    let response
    try {
      response = await requestSearch(item)
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(error.code) ? error.code : null
      rows.push({
        id: item.id, language: item.language, category: item.category, challenge: item.challenge ?? null,
        query: item.query, answerable, expectedIds: item.expected_ids,
        httpStatus: 0, resultCount: 0, top1Id: null, top1Score: null, expectedRank: null, resultIds: [],
        consistency: { enabled: false, applied: false, candidateLimit: null, candidateCount: null, rejectedCount: null, constraints: null, rejectionReasonCounts: null },
        domainEntityIntent: { enabled: false, applied: false, intent: null, rejectedCount: null, rejectionReasonCounts: null },
        timingMs: { embedding: null, qdrant: null, total: null, client: finiteTiming(performance.now() - clientStarted) },
        requestError: { name: String(error?.name ?? 'Error'), code }
      })
      continue
    }

    const body = response?.body ?? {}
    const results = Array.isArray(body.results) ? body.results : []
    const consistency = normalizeConsistency(body?.meta, item.query)
    const domainEntityIntent = normalizeDomainEntityIntent(body?.meta)
    const mappingError = responseMappingError(body, item, consistency)
    const timing = body?.meta?.timing_ms ?? {}
    const row = {
      id: item.id, language: item.language, category: item.category, challenge: item.challenge ?? null,
      query: item.query, answerable, expectedIds: item.expected_ids,
      httpStatus: Number(response?.status ?? 0),
      resultCount: Number.isInteger(body?.meta?.count) ? body.meta.count : results.length,
      top1Id: results[0]?.id ?? null,
      top1Score: Number.isFinite(results[0]?.score) ? results[0].score : null,
      expectedRank: answerable ? firstExpectedRank(results, item.expected_ids) : null,
      resultIds: results.map((result) => result?.id ?? null),
      topResults: results.map((result) => ({ id: result?.id ?? null, score: Number.isFinite(result?.score) ? result.score : null, type: result?.type ?? null, name: result?.name ?? null })),
      consistency: {
        enabled: consistency.enabled,
        applied: consistency.applied,
        candidateLimit: consistency.candidateLimit,
        candidateCount: consistency.candidateCount,
        rejectedCount: consistency.rejectedCount,
        constraints: consistency.constraints,
        rejectionReasonCounts: consistency.rejectionReasonCounts
      },
      domainEntityIntent,
      timingMs: {
        embedding: finiteTiming(timing.embedding),
        qdrant: finiteTiming(timing.qdrant),
        total: finiteTiming(timing.total),
        client: finiteTiming(response?.clientElapsedMs) ?? finiteTiming(performance.now() - clientStarted)
      }
    }
    if (mappingError) row.responseMappingError = mappingError
    rows.push(row)
  }
  return rows
}

function summarizeTiming(rows) {
  const by = (key) => summarizeLatencies(rows.map((row) => row.timingMs?.[key]).filter((value) => value !== null))
  return { embedding: by('embedding'), qdrant: by('qdrant'), total: by('total'), client: by('client') }
}

function assertPreflight(preflight) {
  const expected = CANONICAL_QWEN_PROFILE
  const failures = []
  if (preflight?.canonical !== true) failures.push('canonical=true')
  if (preflight?.collection !== expected.collection) failures.push(`collection=${expected.collection}`)
  if (preflight?.embeddingModel !== expected.embeddingModel) failures.push(`embeddingModel=${expected.embeddingModel}`)
  if (Number(preflight?.embeddingDimension) !== expected.embeddingDimension) failures.push(`embeddingDimension=${expected.embeddingDimension}`)
  if (preflight?.embeddingTextVersion !== expected.embeddingTextVersion) failures.push(`embeddingTextVersion=${expected.embeddingTextVersion}`)
  if (Number(preflight?.productionScoreThreshold) !== PRODUCTION_THRESHOLD) failures.push(`productionScoreThreshold=${PRODUCTION_THRESHOLD}`)
  if (preflight?.searchConsistencyVerificationEnabled !== true) failures.push('searchConsistencyVerificationEnabled=true')
  if (Number(preflight?.searchConsistencyCandidateMultiplier) !== 5) failures.push('searchConsistencyCandidateMultiplier=5')
  if (Number(preflight?.pointsCount) !== 20000 || Number(preflight?.indexedVectorsCount) !== 20000) failures.push('20k-indexed')
  if (preflight?.queryStrategy !== 'prompt') failures.push('queryStrategy=prompt')
  if (preflight?.queryInstructionId !== 'geo-retrieval-v1:d014d3ec6df87e49') failures.push('queryInstructionId=geo-retrieval-v1:d014d3ec6df87e49')
  if (preflight?.documentStrategy !== 'raw') failures.push('documentStrategy=raw')
  if (failures.length) throw new Error(`production consistency acceptance requires canonical preflight: ${failures.join(', ')}`)
}

export function assessProductionConsistencyAcceptance({ preflight, rows } = {}) {
  assertPreflight(preflight)
  if (!Array.isArray(rows) || rows.length !== EXPECTED_CASES) throw new Error(`production consistency acceptance requires exactly ${EXPECTED_CASES} rows`)
  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  if (answerableRows.length !== EXPECTED_ANSWERABLE || noAnswerRows.length !== EXPECTED_NO_ANSWER) {
    throw new Error(`production consistency row shape must be 80 answerable / 120 no-answer, got ${answerableRows.length} / ${noAnswerRows.length}`)
  }

  const failures = []
  for (const row of rows) {
    if (row.requestError) failures.push({ id: row.id, reason: 'request-error', error: row.requestError })
    if (row.responseMappingError) failures.push({ id: row.id, reason: 'response-mapping', checks: row.responseMappingError })
    if (row.httpStatus !== 200) failures.push({ id: row.id, reason: 'http-status', observed: row.httpStatus, expected: 200 })
    const missingTiming = ['embedding', 'qdrant', 'total', 'client'].some((key) => finiteTiming(row.timingMs?.[key]) === null)
    if (missingTiming) failures.push({ id: row.id, reason: 'missing-timing' })
    if (!Number.isInteger(row.resultCount) || row.resultCount < 0 || row.resultCount > RESULT_LIMIT) failures.push({ id: row.id, reason: 'invalid-result-count', observed: row.resultCount })
    if (row.resultCount === 0 && (row.top1Id !== null || row.top1Score !== null)) failures.push({ id: row.id, reason: 'empty-result-contract' })
    if (row.resultCount > 0 && (row.top1Id == null || !Number.isFinite(row.top1Score))) failures.push({ id: row.id, reason: 'nonempty-result-contract' })
    if ((row.topResults ?? []).some((result) => Number.isFinite(result?.score) && result.score < PRODUCTION_THRESHOLD)) {
      failures.push({ id: row.id, reason: 'production-threshold-leak' })
    }
    if (row.answerable !== false) {
      if (!Number.isInteger(row.expectedRank) || row.expectedRank < 1 || row.expectedRank > RESULT_LIMIT) {
        failures.push({ id: row.id, reason: 'answerable-miss', observed: row.expectedRank })
      } else if (row.id === REMAINING_RANK2_ID) {
        if (row.expectedRank > 2) failures.push({ id: row.id, reason: 'remaining-rank2-worsened', observed: row.expectedRank })
      } else if (row.expectedRank !== 1) {
        failures.push({ id: row.id, reason: 'answerable-rank1-regression', observed: row.expectedRank })
      }
    }
  }

  const falsePositiveRows = noAnswerRows.filter((row) => row.resultCount > 0)
  const residualAllowed = new Set(EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS)
  const unexpectedFalsePositiveIds = falsePositiveRows.filter((row) => !residualAllowed.has(row.id)).map((row) => row.id)
  const byChallenge = {}
  for (const row of falsePositiveRows) byChallenge[row.challenge ?? 'uncategorized'] = (byChallenge[row.challenge ?? 'uncategorized'] ?? 0) + 1
  for (const row of falsePositiveRows.filter((row) => ['contradictory-geography', 'plausible-absent-entity'].includes(row.challenge))) {
    failures.push({ id: row.id, reason: 'targeted-noanswer-false-positive', challenge: row.challenge, top1Id: row.top1Id, top1Score: row.top1Score })
  }
  for (const id of unexpectedFalsePositiveIds) failures.push({ id, reason: 'unexpected-noanswer-false-positive' })
  if (falsePositiveRows.length > EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS.length) {
    failures.push({ reason: 'false-positive-envelope-exceeded', observed: falsePositiveRows.length, maximum: EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS.length })
  }

  const answerableQuality = summarizeEvaluation(answerableRows.map((row) => ({ resultIds: row.resultIds ?? [], expectedIds: row.expectedIds ?? [] })))
  if (answerableQuality.recallAt1 < 0.9875) failures.push({ reason: 'answerable-r1-below-proven-floor', observed: answerableQuality.recallAt1, minimum: 0.9875 })
  if (answerableQuality.mrr < 0.99375) failures.push({ reason: 'answerable-mrr-below-proven-floor', observed: answerableQuality.mrr, minimum: 0.99375 })
  if (answerableQuality.recallAt3 < 1 || answerableQuality.recallAt5 < 1) failures.push({ reason: 'answerable-top5-regression', quality: answerableQuality })

  const knownRemainingRank2Cases = answerableRows.filter((row) => row.expectedRank === 2).map((row) => ({ id: row.id, expectedRank: row.expectedRank }))
  return {
    accepted: failures.length === 0,
    checks: {
      canonicalPreflight: true,
      allHttp200: rows.every((row) => row.httpStatus === 200),
      allResponsesMapped: rows.every((row) => !row.responseMappingError),
      allTimingsCaptured: rows.every((row) => ['embedding', 'qdrant', 'total', 'client'].every((key) => finiteTiming(row.timingMs?.[key]) !== null)),
      productionThresholdPreserved: rows.every((row) => (row.topResults ?? []).every((result) => !Number.isFinite(result?.score) || result.score >= PRODUCTION_THRESHOLD)),
      answerableQualityAtOrAboveExperiment: answerableQuality.recallAt1 >= 0.9875 && answerableQuality.mrr >= 0.99375 && answerableQuality.recallAt3 === 1 && answerableQuality.recallAt5 === 1,
      residualFalsePositivesWithinEnvelope: falsePositiveRows.length <= 3 && unexpectedFalsePositiveIds.length === 0,
      contradictoryGeographyZeroFalsePositives: (byChallenge['contradictory-geography'] ?? 0) === 0,
      plausibleAbsentZeroFalsePositives: (byChallenge['plausible-absent-entity'] ?? 0) === 0
    },
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    answerableQuality,
    knownRemainingRank2Cases,
    falsePositives: {
      total: falsePositiveRows.length,
      rate: falsePositiveRows.length / noAnswerRows.length,
      ids: falsePositiveRows.map((row) => row.id),
      unexpectedIds: unexpectedFalsePositiveIds,
      byChallenge,
      rows: falsePositiveRows.map((row) => ({ id: row.id, language: row.language, challenge: row.challenge ?? null, query: row.query, top1Id: row.top1Id, top1Score: row.top1Score, consistency: row.consistency }))
    },
    latencyMs: summarizeTiming(rows),
    failures
  }
}
