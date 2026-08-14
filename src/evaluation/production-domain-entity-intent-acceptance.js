import { inferHighConfidenceNonGeographicIntent } from '../search/domain-entity-intent-gate.js'
import {
  EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS,
  assessProductionConsistencyAcceptance
} from './production-consistency-acceptance.js'

const EXPECTED_CASES = 200
const EXPECTED_ANSWERABLE = 80
const EXPECTED_NO_ANSWER = 120
const EXPECTED_INTENT_QUERIES = 4
const TARGET_REJECTION_REASON = 'geographic-entity-for-nongeographic-intent'
const TARGET_IDS = new Set(EXPECTED_PRODUCTION_CONSISTENCY_RESIDUAL_FP_IDS)

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function assertProductionPreflight(preflight) {
  if (preflight?.searchDomainEntityIntentGateEnabled !== true) {
    throw new Error('production domain/entity-intent acceptance requires searchDomainEntityIntentGateEnabled=true')
  }
}

export function assessProductionDomainEntityIntentAcceptance({ preflight, rows } = {}) {
  assertProductionPreflight(preflight)
  if (!Array.isArray(rows) || rows.length !== EXPECTED_CASES) {
    throw new Error(`production domain/entity-intent acceptance requires exactly ${EXPECTED_CASES} rows`)
  }

  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  if (answerableRows.length !== EXPECTED_ANSWERABLE || noAnswerRows.length !== EXPECTED_NO_ANSWER) {
    throw new Error(`production domain/entity-intent row shape must be 80 answerable / 120 no-answer, got ${answerableRows.length} / ${noAnswerRows.length}`)
  }

  const productionConsistency = assessProductionConsistencyAcceptance({ preflight, rows })
  const failures = productionConsistency.failures.map((failure) => ({ stage: 'production-consistency', ...failure }))

  const expectedIntentRows = []
  const observedAppliedRows = []
  const rejectedRows = []
  let answerableGateApplications = 0

  for (const row of rows) {
    const expectedIntent = inferHighConfidenceNonGeographicIntent(row.query)
    const expectedApplied = expectedIntent !== null
    const observed = row.domainEntityIntent ?? {}

    if (expectedApplied) expectedIntentRows.push(row)
    if (observed.applied === true) observedAppliedRows.push(row)
    if (Number(observed.rejectedCount ?? 0) > 0) rejectedRows.push(row)
    if (row.answerable !== false && observed.applied === true) answerableGateApplications += 1

    if (observed.enabled !== true) failures.push({ id: row.id, reason: 'domain-entity-intent-disabled' })
    if (observed.applied !== expectedApplied) {
      failures.push({ id: row.id, reason: 'domain-entity-intent-application-mismatch', observed: observed.applied === true, expected: expectedApplied })
    }
    if (!sameJson(observed.intent, expectedIntent)) {
      failures.push({ id: row.id, reason: 'domain-entity-intent-metadata-mismatch', observed: observed.intent ?? null, expected: expectedIntent })
    }
    if (!Number.isInteger(observed.rejectedCount) || observed.rejectedCount < 0) {
      failures.push({ id: row.id, reason: 'domain-entity-intent-invalid-rejected-count', observed: observed.rejectedCount ?? null })
    }
    if (!observed.rejectionReasonCounts || typeof observed.rejectionReasonCounts !== 'object' || Array.isArray(observed.rejectionReasonCounts)) {
      failures.push({ id: row.id, reason: 'domain-entity-intent-invalid-reason-counts' })
    }
  }

  if (expectedIntentRows.length !== EXPECTED_INTENT_QUERIES) {
    failures.push({ reason: 'domain-entity-intent-corpus-envelope-changed', observed: expectedIntentRows.length, expected: EXPECTED_INTENT_QUERIES })
  }
  if (answerableGateApplications !== 0) {
    failures.push({ reason: 'domain-entity-intent-applied-to-answerable', observed: answerableGateApplications })
  }

  const falsePositiveRows = noAnswerRows.filter((row) => row.resultCount > 0)
  if (falsePositiveRows.length !== 0) {
    failures.push({ reason: 'domain-entity-intent-residual-false-positives', ids: falsePositiveRows.map((row) => row.id) })
  }

  const fixedTargetIds = []
  for (const id of TARGET_IDS) {
    const row = noAnswerRows.find((candidate) => candidate.id === id)
    if (!row) {
      failures.push({ id, reason: 'domain-entity-intent-target-missing' })
      continue
    }
    const observed = row.domainEntityIntent ?? {}
    const reasonCount = Number(observed.rejectionReasonCounts?.[TARGET_REJECTION_REASON] ?? 0)
    if (row.resultCount === 0 && observed.applied === true && Number(observed.rejectedCount) >= 1 && reasonCount >= 1) {
      fixedTargetIds.push(id)
    } else {
      failures.push({
        id,
        reason: 'domain-entity-intent-target-not-proven-fixed',
        resultCount: row.resultCount,
        applied: observed.applied === true,
        rejectedCount: observed.rejectedCount ?? null,
        rejectionReasonCount: reasonCount
      })
    }
  }

  return {
    accepted: failures.length === 0,
    checks: {
      canonicalProductionConsistencyAccepted: productionConsistency.accepted,
      gateEnabledEverywhere: rows.every((row) => row.domainEntityIntent?.enabled === true),
      gateApplicationMatchesParser: rows.every((row) => {
        const expected = inferHighConfidenceNonGeographicIntent(row.query)
        return row.domainEntityIntent?.applied === (expected !== null) && sameJson(row.domainEntityIntent?.intent ?? null, expected)
      }),
      zeroFalsePositives: falsePositiveRows.length === 0,
      zeroAnswerableGateApplications: answerableGateApplications === 0,
      allProvenResidualsRejected: fixedTargetIds.length === TARGET_IDS.size
    },
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    answerableQuality: productionConsistency.answerableQuality,
    knownRemainingRank2Cases: productionConsistency.knownRemainingRank2Cases,
    answerableGateApplications,
    falsePositives: {
      total: falsePositiveRows.length,
      rate: falsePositiveRows.length / noAnswerRows.length,
      ids: falsePositiveRows.map((row) => row.id)
    },
    fixedTargetIds,
    gate: {
      expectedAppliedQueries: expectedIntentRows.length,
      appliedQueries: observedAppliedRows.length,
      appliedIds: observedAppliedRows.map((row) => row.id),
      rejectedQueries: rejectedRows.length,
      rejectedIds: rejectedRows.map((row) => row.id),
      rejectedResults: rejectedRows.reduce((sum, row) => sum + Number(row.domainEntityIntent?.rejectedCount ?? 0), 0)
    },
    latencyMs: productionConsistency.latencyMs,
    productionConsistency,
    failures
  }
}
