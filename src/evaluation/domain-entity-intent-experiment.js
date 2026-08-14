import { summarizeEvaluation, summarizeLatencies } from './metrics.js'
import { applyDomainEntityIntentGate } from '../search/domain-entity-intent-gate.js'
import { EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS } from './production-consistency-acceptance.js'

const EXPECTED_CASES = 200
const EXPECTED_ANSWERABLE = 80
const EXPECTED_NO_ANSWER = 120
const EXPECTED_RESIDUALS = new Set(EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS)

function rank(results, expectedIds) {
  const expected = new Set(expectedIds ?? [])
  const index = (results ?? []).findIndex((result) => expected.has(result?.id))
  return index < 0 ? null : index + 1
}

function quality(rows, key) {
  return summarizeEvaluation(rows.map((row) => ({
    resultIds: (row[key] ?? []).map((result) => result?.id ?? null),
    expectedIds: row.expectedIds ?? []
  })))
}

function latencySummary(rows) {
  const values = rows.map((row) => row.gateMs).filter((value) => Number.isFinite(value) && value >= 0)
  return summarizeLatencies(values)
}

export function evaluateDomainEntityIntentRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('domain/entity-intent rows are required')
  return rows.map((row) => {
    const rawResults = Array.isArray(row.rawResults) ? row.rawResults : (Array.isArray(row.topResults) ? row.topResults : [])
    const started = performance.now()
    const gate = applyDomainEntityIntentGate(row.query, rawResults)
    const gateMs = performance.now() - started
    return {
      ...row,
      rawResults,
      gatedResults: gate.acceptedResults,
      domainIntent: gate.intent,
      domainIntentRejectedCount: gate.rejectedResults.length,
      domainIntentRejectionReasons: gate.rejectedResults.flatMap((result) => result.domain_intent_rejection_reasons ?? []),
      gateMs
    }
  })
}

export function assessDomainEntityIntentExperiment(rows, { requireBaselineResidualEnvelope = true } = {}) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_CASES) throw new Error(`domain/entity-intent experiment requires exactly ${EXPECTED_CASES} rows`)
  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  if (answerableRows.length !== EXPECTED_ANSWERABLE || noAnswerRows.length !== EXPECTED_NO_ANSWER) {
    throw new Error(`domain/entity-intent row shape must be 80 answerable / 120 no-answer, got ${answerableRows.length} / ${noAnswerRows.length}`)
  }

  const failures = []
  const answerableRegressions = []
  for (const row of answerableRows) {
    const rawRank = rank(row.rawResults, row.expectedIds)
    const gatedRank = rank(row.gatedResults, row.expectedIds)
    if (rawRank == null || gatedRank == null || gatedRank > rawRank) {
      answerableRegressions.push({ id: row.id, rawRank, gatedRank })
    }
  }
  for (const regression of answerableRegressions) failures.push({ reason: 'answerable-regression', ...regression })

  const baselineFpRows = noAnswerRows.filter((row) => (row.rawResults ?? []).length > 0)
  const gatedFpRows = noAnswerRows.filter((row) => (row.gatedResults ?? []).length > 0)
  const baselineIds = baselineFpRows.map((row) => row.id).sort()
  const expectedIds = [...EXPECTED_RESIDUALS].sort()
  if (requireBaselineResidualEnvelope && JSON.stringify(baselineIds) !== JSON.stringify(expectedIds)) {
    failures.push({ reason: 'baseline-residual-envelope-mismatch', observed: baselineIds, expected: expectedIds })
  }

  const fixedResidualIds = baselineFpRows
    .filter((row) => EXPECTED_RESIDUALS.has(row.id) && (row.gatedResults ?? []).length === 0)
    .map((row) => row.id)
  if (requireBaselineResidualEnvelope && fixedResidualIds.length !== EXPECTED_RESIDUALS.size) {
    failures.push({ reason: 'residual-collisions-not-eliminated', fixed: fixedResidualIds, expected: expectedIds })
  }
  if (gatedFpRows.length >= baselineFpRows.length) failures.push({ reason: 'false-positives-not-reduced', baseline: baselineFpRows.length, gated: gatedFpRows.length })
  if (gatedFpRows.length !== 0) failures.push({ reason: 'residual-false-positives-remain', ids: gatedFpRows.map((row) => row.id) })

  const answerableGateApplications = answerableRows.filter((row) => row.domainIntent !== null).length
  if (answerableGateApplications !== 0) failures.push({ reason: 'gate-applied-to-answerable-query', observed: answerableGateApplications })

  const baselineQuality = quality(answerableRows, 'rawResults')
  const gatedQuality = quality(answerableRows, 'gatedResults')
  if (gatedQuality.recallAt1 < baselineQuality.recallAt1 || gatedQuality.mrr < baselineQuality.mrr || gatedQuality.recallAt3 < baselineQuality.recallAt3 || gatedQuality.recallAt5 < baselineQuality.recallAt5) {
    failures.push({ reason: 'answerable-quality-regression', baselineQuality, gatedQuality })
  }

  const appliedRows = rows.filter((row) => row.domainIntent !== null)
  const rejectedResults = rows.reduce((sum, row) => sum + Number(row.domainIntentRejectedCount ?? 0), 0)
  const reasonCounts = {}
  for (const row of rows) {
    for (const reason of row.domainIntentRejectionReasons ?? []) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
  }

  return {
    accepted: failures.length === 0,
    productionMutation: false,
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    baselineQuality,
    gatedQuality,
    answerableRegressions,
    answerableGateApplications,
    baselineFalsePositives: { total: baselineFpRows.length, ids: baselineFpRows.map((row) => row.id) },
    gatedFalsePositives: { total: gatedFpRows.length, ids: gatedFpRows.map((row) => row.id) },
    fixedResidualIds,
    gate: {
      appliedQueries: appliedRows.length,
      appliedIds: appliedRows.map((row) => row.id),
      rejectedResults,
      rejectionReasonCounts: reasonCounts,
      latencyMs: latencySummary(rows)
    },
    checks: {
      baselineResidualEnvelopeMatches: !requireBaselineResidualEnvelope || JSON.stringify(baselineIds) === JSON.stringify(expectedIds),
      allProvenResidualsEliminated: fixedResidualIds.length === EXPECTED_RESIDUALS.size,
      zeroGatedFalsePositives: gatedFpRows.length === 0,
      zeroAnswerableRegressions: answerableRegressions.length === 0,
      zeroAnswerableGateApplications: answerableGateApplications === 0,
      answerableQualityPreserved: gatedQuality.recallAt1 >= baselineQuality.recallAt1 && gatedQuality.mrr >= baselineQuality.mrr && gatedQuality.recallAt3 >= baselineQuality.recallAt3 && gatedQuality.recallAt5 >= baselineQuality.recallAt5
    },
    failures
  }
}
