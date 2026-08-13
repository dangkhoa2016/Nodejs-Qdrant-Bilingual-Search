import { CANONICAL_QWEN_PROFILE } from '../canonical-profile.js'
import { summarizeEvaluation, summarizeLatencies } from './metrics.js'
import { calibrateThresholds } from './threshold-calibration.js'

export const EXPANDED_V21_THRESHOLDS = Object.freeze([0.50, 0.51, 0.53, 0.55])
export const EXPANDED_V21_CASES = 200
export const EXPANDED_V21_ANSWERABLE_CASES = 80
export const EXPANDED_V21_NO_ANSWER_CASES = 120
export const EXPANDED_V21_PRODUCTION_THRESHOLD = 0.55
export const EXPANDED_V21_LOWER_CANDIDATE = 0.53
export const KNOWN_V21_RANK2_CASE_IDS = Object.freeze([
  'vi-hard-country-14',
  'vi-hard-country-17',
  'vi-hard-city-19'
])

function finiteTiming(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function firstExpectedRank(results, expectedIds) {
  const expected = new Set(expectedIds)
  const index = results.findIndex((result) => expected.has(result?.id))
  return index < 0 ? null : index + 1
}

function normalizeResults(results) {
  return results.map((result) => ({
    id: result?.id ?? null,
    score: Number.isFinite(result?.score) ? result.score : null,
    type: result?.type ?? null,
    name: result?.name ?? null
  }))
}

function summarizeTiming(rows) {
  const summarize = (key) => summarizeLatencies(rows.map((row) => row.timingMs?.[key]).filter((value) => value !== null))
  return {
    embedding: summarize('embedding'),
    qdrant: summarize('qdrant'),
    total: summarize('total'),
    client: summarize('client')
  }
}

function assertCanonicalV21Preflight(preflight) {
  const failures = []
  if (preflight?.canonical !== true) failures.push('canonical=true')
  if (preflight?.collection !== CANONICAL_QWEN_PROFILE.collection) failures.push(`collection=${CANONICAL_QWEN_PROFILE.collection}`)
  if (preflight?.embeddingModel !== CANONICAL_QWEN_PROFILE.embeddingModel) failures.push(`model=${CANONICAL_QWEN_PROFILE.embeddingModel}`)
  if (Number(preflight?.embeddingDimension) !== CANONICAL_QWEN_PROFILE.embeddingDimension) failures.push(`dimension=${CANONICAL_QWEN_PROFILE.embeddingDimension}`)
  if (preflight?.embeddingTextVersion !== CANONICAL_QWEN_PROFILE.embeddingTextVersion) failures.push(`embedding_text=${CANONICAL_QWEN_PROFILE.embeddingTextVersion}`)
  if (Number(preflight?.productionScoreThreshold) !== EXPANDED_V21_PRODUCTION_THRESHOLD) failures.push(`threshold=${EXPANDED_V21_PRODUCTION_THRESHOLD}`)
  if (Number(preflight?.pointsCount) !== 20000 || Number(preflight?.indexedVectorsCount) !== 20000) failures.push('20k-indexed')
  if (preflight?.queryStrategy !== 'prompt') failures.push('query_strategy=prompt')
  if (preflight?.queryInstructionId !== 'geo-retrieval-v1:d014d3ec6df87e49') failures.push('query_instruction_id=geo-retrieval-v1:d014d3ec6df87e49')
  if (preflight?.documentStrategy !== 'raw') failures.push('document_strategy=raw')
  if (failures.length) throw new Error(`expanded threshold benchmark requires canonical v2.1 preflight: ${failures.join(', ')}`)
  return preflight
}

export async function evaluateExpandedNoAnswerApiCases(cases, requestSearch) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('expanded benchmark cases are required')
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
        id: item.id,
        language: item.language,
        category: item.category,
        challenge: item.challenge ?? null,
        query: item.query,
        answerable,
        expectedIds: item.expected_ids,
        httpStatus: 0,
        resultCount: 0,
        top1Id: null,
        top1Score: null,
        expectedRank: null,
        resultIds: [],
        topResults: [],
        timingMs: { embedding: null, qdrant: null, total: null, client: finiteTiming(performance.now() - clientStarted) },
        requestError: { name: String(error?.name ?? 'Error'), code }
      })
      continue
    }

    const body = response?.body ?? {}
    const rawResults = Array.isArray(body.results) ? body.results : []
    const topResults = normalizeResults(rawResults)
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
      language: item.language,
      category: item.category,
      challenge: item.challenge ?? null,
      query: item.query,
      answerable,
      expectedIds: item.expected_ids,
      httpStatus: Number(response?.status ?? 0),
      resultCount: Number.isInteger(body?.meta?.count) ? body.meta.count : topResults.length,
      top1Id: topResults[0]?.id ?? null,
      top1Score: topResults[0]?.score ?? null,
      expectedRank: answerable ? firstExpectedRank(topResults, item.expected_ids) : null,
      resultIds: topResults.map((result) => result.id),
      topResults,
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

function answerableEvaluationRows(rows) {
  return rows.filter((row) => row.answerable !== false).map((row) => ({
    resultIds: Array.isArray(row.resultIds) ? row.resultIds : (row.topResults ?? []).map((result) => result.id),
    expectedIds: row.expectedIds ?? []
  }))
}

export function assessExpandedNoAnswerExecution({ preflight, rows } = {}) {
  assertCanonicalV21Preflight(preflight)
  if (!Array.isArray(rows) || rows.length !== EXPANDED_V21_CASES) {
    throw new Error(`expanded threshold benchmark requires exactly ${EXPANDED_V21_CASES} rows`)
  }
  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  if (answerableRows.length !== EXPANDED_V21_ANSWERABLE_CASES || noAnswerRows.length !== EXPANDED_V21_NO_ANSWER_CASES) {
    throw new Error(`expanded threshold benchmark row shape must be 80 answerable / 120 no-answer, got ${answerableRows.length} / ${noAnswerRows.length}`)
  }

  const failures = []
  const knownRank2 = new Set(KNOWN_V21_RANK2_CASE_IDS)
  for (const row of rows) {
    if (row.requestError) failures.push({ id: row.id, reason: 'request-error', error: row.requestError })
    if (row.responseMappingError) failures.push({ id: row.id, reason: 'response-mapping', checks: row.responseMappingError })
    if (row.httpStatus !== 200) failures.push({ id: row.id, reason: 'http-status', observed: row.httpStatus, expected: 200 })
    if (!Number.isInteger(row.resultCount) || row.resultCount < 1 || row.top1Id == null || !Number.isFinite(row.top1Score)) {
      failures.push({ id: row.id, reason: 'invalid-response-contract' })
    }
    const missingTiming = ['embedding', 'qdrant', 'total', 'client'].some((key) => finiteTiming(row.timingMs?.[key]) === null)
    if (missingTiming) failures.push({ id: row.id, reason: 'missing-timing' })

    if (row.answerable !== false) {
      if (!Number.isInteger(row.expectedRank) || row.expectedRank < 1 || row.expectedRank > 5) {
        failures.push({ id: row.id, reason: 'answerable-top5-regression', observed: row.expectedRank })
      } else if (row.expectedRank > 1 && !knownRank2.has(row.id)) {
        failures.push({ id: row.id, reason: 'new-answerable-rank1-regression', observed: row.expectedRank })
      } else if (knownRank2.has(row.id) && row.expectedRank > 2) {
        failures.push({ id: row.id, reason: 'known-rank2-worsened', observed: row.expectedRank })
      }
    }
  }

  const answerableQuality = summarizeEvaluation(answerableEvaluationRows(answerableRows))
  return {
    accepted: failures.length === 0,
    checks: {
      canonicalPreflight: true,
      allHttp200: rows.every((row) => row.httpStatus === 200),
      allResponsesMapped: rows.every((row) => !row.responseMappingError && row.resultCount >= 1 && row.top1Id != null && Number.isFinite(row.top1Score)),
      allTimingsCaptured: rows.every((row) => ['embedding', 'qdrant', 'total', 'client'].every((key) => finiteTiming(row.timingMs?.[key]) !== null)),
      answerableTop5Preserved: answerableRows.every((row) => Number.isInteger(row.expectedRank) && row.expectedRank >= 1 && row.expectedRank <= 5),
      noNewAnswerableRank1Regressions: answerableRows.every((row) => row.expectedRank === 1 || knownRank2.has(row.id)),
      knownRank2NotWorseThan2: answerableRows.filter((row) => knownRank2.has(row.id)).every((row) => Number.isInteger(row.expectedRank) && row.expectedRank <= 2)
    },
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    answerableQuality,
    knownRank2Cases: answerableRows.filter((row) => knownRank2.has(row.id)).map((row) => ({ id: row.id, expectedRank: row.expectedRank })),
    latencyMs: summarizeTiming(rows),
    failures
  }
}

function safeDivide(numerator, denominator) {
  return denominator ? numerator / denominator : 0
}

function wilson95(successes, total) {
  if (!Number.isInteger(total) || total < 1) return { lower: null, upper: null }
  const z = 1.959963984540054
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denominator
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) }
}

function summarizeFiniteScores(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) throw new Error('score summary requires finite scores')
  const percentile = (p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
    max: sorted.at(-1)
  }
}

function enrichCandidate(candidate, rows, noAnswerCount) {
  const falsePositives = rows
    .filter((row) => row.answerable === false && (row.topResults ?? []).some((result) => Number.isFinite(result?.score) && result.score >= candidate.threshold))
    .map((row) => ({ id: row.id, language: row.language, challenge: row.challenge ?? null, query: row.query ?? null, top1Id: row.topResults?.[0]?.id ?? null, top1Score: row.topResults?.[0]?.score ?? null }))
  const falseNegatives = rows
    .filter((row) => row.answerable !== false && !(row.topResults ?? []).some((result) => Number.isFinite(result?.score) && result.score >= candidate.threshold))
    .map((row) => ({ id: row.id, language: row.language, challenge: row.challenge ?? null, query: row.query ?? null, top1Id: row.topResults?.[0]?.id ?? null, top1Score: row.topResults?.[0]?.score ?? null }))
  const falsePositiveByChallenge = {}
  for (const item of falsePositives) falsePositiveByChallenge[item.challenge ?? 'uncategorized'] = (falsePositiveByChallenge[item.challenge ?? 'uncategorized'] ?? 0) + 1
  const falsePositiveRate = safeDivide(candidate.answerability.fp, noAnswerCount)
  return {
    ...candidate,
    falsePositives,
    falseNegatives,
    falsePositiveRate,
    falsePositiveRateWilson95: wilson95(candidate.answerability.fp, noAnswerCount),
    falsePositiveByChallenge
  }
}

function assertCalibrationSource(report, expectedCorpusSha256) {
  if (!report || typeof report !== 'object') throw new TypeError('expanded benchmark report is required')
  if (!expectedCorpusSha256) throw new TypeError('expectedCorpusSha256 is required')
  if (report.experiment !== 'expanded_noanswer_v21_public_api_benchmark') throw new Error('expanded threshold calibration requires the expanded public API benchmark report')
  if (report.inputs?.queryCorpusSha256 !== expectedCorpusSha256) {
    throw new Error(`expanded threshold corpus SHA-256 mismatch: expected ${expectedCorpusSha256}, got ${report.inputs?.queryCorpusSha256 ?? 'missing'}`)
  }
  assertCanonicalV21Preflight(report.preflight?.verified)
  if (report.requestPolicy?.rankingScoreThreshold !== 0) throw new Error('expanded benchmark source score threshold must be 0')
  if (report.requestPolicy?.productionScoreThresholdRetained !== EXPANDED_V21_PRODUCTION_THRESHOLD) throw new Error('expanded benchmark must retain production threshold 0.55')
  if (report.executionAcceptance?.accepted !== true) throw new Error('expanded benchmark execution acceptance must be true before calibration')
  if (report.cases !== EXPANDED_V21_CASES || report.answerableCases !== EXPANDED_V21_ANSWERABLE_CASES || report.noAnswerCases !== EXPANDED_V21_NO_ANSWER_CASES) {
    throw new Error('expanded benchmark report shape must be 200 / 80 / 120')
  }
  const rows = report.rows
  if (!Array.isArray(rows) || rows.length !== EXPANDED_V21_CASES) throw new Error('expanded benchmark report must contain exactly 200 rows')
  if (rows.filter((row) => row.answerable !== false).length !== EXPANDED_V21_ANSWERABLE_CASES || rows.filter((row) => row.answerable === false).length !== EXPANDED_V21_NO_ANSWER_CASES) {
    throw new Error('expanded benchmark rows must contain 80 answerable and 120 no-answer cases')
  }
  for (const row of rows) {
    if (!Array.isArray(row.topResults) || !row.topResults.length || !Number.isFinite(row.topResults[0]?.score)) {
      throw new Error(`expanded benchmark row ${row?.id ?? '<unknown>'} is missing an uncensored finite top-1 score`)
    }
  }
  return rows
}

export function calibrateExpandedNoAnswerThreshold(report, {
  expectedCorpusSha256,
  thresholds = EXPANDED_V21_THRESHOLDS,
  currentProductionThreshold = EXPANDED_V21_PRODUCTION_THRESHOLD,
  lowerCandidateThreshold = EXPANDED_V21_LOWER_CANDIDATE
} = {}) {
  const rows = assertCalibrationSource(report, expectedCorpusSha256)
  const framework = calibrateThresholds(rows, { thresholds })
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  const answerableRows = rows.filter((row) => row.answerable !== false)
  const candidates = framework.candidates.map((candidate) => enrichCandidate(candidate, rows, noAnswerRows.length))
  const current = candidates.find((candidate) => candidate.threshold === currentProductionThreshold)
  const lower = candidates.find((candidate) => candidate.threshold === lowerCandidateThreshold)
  if (!current) throw new Error(`current production threshold ${currentProductionThreshold} was not evaluated`)
  if (!lower) throw new Error(`lower candidate threshold ${lowerCandidateThreshold} was not evaluated`)

  let recommendation
  if (current.answerability.fp > 0) {
    recommendation = {
      status: 'retain-production-investigate-false-positives',
      threshold: currentProductionThreshold,
      reasonCode: 'CURRENT_THRESHOLD_HAS_ADVERSARIAL_FALSE_POSITIVES',
      thresholdAloneInsufficient: true
    }
  } else if (lower.answerability.fp <= current.answerability.fp && lower.answerability.fn < current.answerability.fn) {
    recommendation = {
      status: 'promote-candidate',
      threshold: lowerCandidateThreshold,
      reasonCode: 'RECALL_GAIN_WITHOUT_FP_REGRESSION',
      thresholdAloneInsufficient: false
    }
  } else if (lower.answerability.fp > current.answerability.fp) {
    recommendation = {
      status: 'retain-production',
      threshold: currentProductionThreshold,
      reasonCode: 'LOWER_THRESHOLD_INCREASES_FALSE_POSITIVES',
      thresholdAloneInsufficient: false
    }
  } else {
    recommendation = {
      status: 'retain-production',
      threshold: currentProductionThreshold,
      reasonCode: 'NO_RECALL_GAIN_FROM_LOWER_THRESHOLD',
      thresholdAloneInsufficient: false
    }
  }

  return {
    experiment: 'expanded_noanswer_v21_threshold_calibration',
    sourceExperiment: report.experiment,
    sourceGeneratedAt: report.generatedAt ?? null,
    sourceQueryCorpusSha256: report.inputs.queryCorpusSha256,
    sourceCollection: report.preflight.verified.collection,
    sourceEmbeddingModel: report.preflight.verified.embeddingModel,
    sourceEmbeddingTextVersion: report.preflight.verified.embeddingTextVersion,
    cases: rows.length,
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    thresholds: candidates.map((candidate) => candidate.threshold),
    scoreDistribution: {
      answerableTop1: summarizeFiniteScores(answerableRows.map((row) => row.topResults[0].score)),
      noAnswerTop1: summarizeFiniteScores(noAnswerRows.map((row) => row.topResults[0].score))
    },
    candidates,
    recommendation: {
      ...recommendation,
      currentProductionThreshold,
      lowerCandidateThreshold,
      currentProductionCandidate: current,
      lowerCandidate: lower,
      policy: 'Lower 0.55 to 0.53 only when 0.53 recovers answerable cases and does not worsen adversarial false positives. Never change production configuration automatically.'
    }
  }
}
