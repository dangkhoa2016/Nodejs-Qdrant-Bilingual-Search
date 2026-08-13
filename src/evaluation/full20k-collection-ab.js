import { summarizeEvaluation, summarizeLatencies } from './metrics.js'
import { FOCUSED_FAILURE_CASE_IDS, compareFocusedVariants } from './focused-text-ab.js'

export const FULL20K_FOCUS_CASE_IDS = FOCUSED_FAILURE_CASE_IDS

export const V2_COUNTRY_OVERBIAS_SENTINEL_IDS = Object.freeze([
  'en-hard-city-19',
  'vi-hard-city-05',
  'vi-hard-city-11',
  'vi-hard-city-12',
  'vi-hard-city-20'
])

export const FULL20K_V21_ACCEPTANCE_CRITERIA = Object.freeze({
  minOverallRecallAt1Delta: 0.025,
  minNonNoDiacriticsRecallAt1Delta: 0.02,
  maxNewRank1Regressions: 0,
  maxTop5Misses: 0
})

function roundMetric(value) {
  return Math.round(value * 1e12) / 1e12
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`)
}

function firstExpectedRank(results, expectedIds) {
  const expected = new Set(expectedIds)
  const index = results.findIndex((result) => expected.has(result.id))
  return index < 0 ? null : index + 1
}

function scoreMargin(results) {
  if (results.length < 2) return null
  const first = Number(results[0]?.score)
  const second = Number(results[1]?.score)
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  return roundMetric(first - second)
}

function targetMargin(results, expectedIds) {
  const expected = new Set(expectedIds)
  const target = results.find((result) => expected.has(result.id))
  const distractor = results.find((result) => !expected.has(result.id))
  if (!Number.isFinite(target?.score) || !Number.isFinite(distractor?.score)) return null
  return roundMetric(target.score - distractor.score)
}

function summarizeRows(rows) {
  return summarizeEvaluation(rows.map((row) => ({ resultIds: row.resultIds, expectedIds: row.expectedIds })))
}

function summarizeBy(rows, key) {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[key]).filter(Boolean))]
      .sort()
      .map((value) => [value, summarizeRows(rows.filter((row) => row[key] === value))])
  )
}

function summarizeWithoutNoDiacritics(variant) {
  const rows = (variant?.rows ?? []).filter((row) => row.answerable !== false && row.challenge !== 'no-diacritics')
  return rows.length ? summarizeRows(rows) : null
}

function rowEvidence(row) {
  return {
    expectedRank: row?.expectedRank ?? null,
    top1Top2Margin: row?.top1Top2Margin ?? null,
    targetVsBestDistractorMargin: row?.targetVsBestDistractorMargin ?? null,
    top1Id: row?.topResults?.[0]?.id ?? null,
    top1Score: Number.isFinite(row?.topResults?.[0]?.score) ? row.topResults[0].score : null
  }
}

export function evaluateFull20kCollectionVariant(cases, resultsByCaseId, { resultLimit = 5, rankProbeLimit = 100 } = {}) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('cases must not be empty')
  if (!(resultsByCaseId instanceof Map)) throw new TypeError('resultsByCaseId must be a Map')
  assertPositiveInteger(resultLimit, 'resultLimit')
  assertPositiveInteger(rankProbeLimit, 'rankProbeLimit')
  if (rankProbeLimit < resultLimit) throw new RangeError('rankProbeLimit must be >= resultLimit')

  const rows = cases.map((item) => {
    const probeResults = resultsByCaseId.get(item.id)
    if (!Array.isArray(probeResults)) throw new Error(`missing full-20k results for ${item.id}`)
    const topResults = probeResults.slice(0, resultLimit)
    const resultIds = topResults.map((result) => result.id)
    const expectedIds = Array.isArray(item.expected_ids) ? item.expected_ids : []
    const answerable = item.answerable !== false
    const expectedRank = answerable ? firstExpectedRank(probeResults, expectedIds) : null
    const expectedSet = new Set(expectedIds)

    return {
      id: item.id,
      language: item.language,
      category: item.category ?? 'uncategorized',
      challenge: item.challenge ?? null,
      query: item.query,
      answerable,
      expectedIds,
      expectedRank,
      expectedRankLowerBound: answerable && expectedRank == null ? probeResults.length + 1 : null,
      rankProbeLimit,
      resultIds,
      hits: answerable
        ? {
            at1: topResults.slice(0, 1).some((result) => expectedSet.has(result.id)) ? 1 : 0,
            at3: topResults.slice(0, 3).some((result) => expectedSet.has(result.id)) ? 1 : 0,
            at5: topResults.slice(0, 5).some((result) => expectedSet.has(result.id)) ? 1 : 0
          }
        : { at1: 0, at3: 0, at5: 0 },
      topResults,
      top1Top2Margin: scoreMargin(topResults),
      targetVsBestDistractorMargin: answerable ? targetMargin(probeResults, expectedIds) : null
    }
  })

  const answerableRows = rows.filter((row) => row.answerable)
  if (!answerableRows.length) throw new TypeError('full-20k A/B requires at least one answerable case')
  const noAnswerScores = rows
    .filter((row) => !row.answerable)
    .map((row) => row.topResults[0]?.score)
    .filter((score) => Number.isFinite(score))

  return {
    cases: rows.length,
    answerableCases: answerableRows.length,
    noAnswerCases: rows.length - answerableRows.length,
    quality: summarizeRows(answerableRows),
    qualityByLanguage: summarizeBy(answerableRows, 'language'),
    qualityByCategory: summarizeBy(answerableRows, 'category'),
    qualityByChallenge: summarizeBy(answerableRows, 'challenge'),
    noAnswerTop1Score: noAnswerScores.length ? summarizeLatencies(noAnswerScores) : null,
    rows
  }
}

export function compareFull20kCollectionVariants(v1, v21, {
  focusCaseIds = FULL20K_FOCUS_CASE_IDS,
  sentinelCaseIds = V2_COUNTRY_OVERBIAS_SENTINEL_IDS
} = {}) {
  const core = compareFocusedVariants(v1, v21, { focusCaseIds, secondLabel: 'v21' })
  const v1ById = new Map((v1?.rows ?? []).map((row) => [row.id, row]))
  const v21ById = new Map((v21?.rows ?? []).map((row) => [row.id, row]))

  const sentinels = sentinelCaseIds.map((id) => {
    const before = v1ById.get(id)
    const after = v21ById.get(id)
    if (!before || !after) throw new Error(`missing full-20k sentinel row for ${id}`)
    return { id, v1: rowEvidence(before), v21: rowEvidence(after) }
  })

  const noAnswerCases = (v1?.rows ?? [])
    .filter((row) => !row.answerable)
    .map((before) => {
      const after = v21ById.get(before.id)
      if (!after) throw new Error(`missing v2.1 no-answer row for ${before.id}`)
      const v1Evidence = rowEvidence(before)
      const v21Evidence = rowEvidence(after)
      return {
        id: before.id,
        language: before.language,
        query: before.query,
        v1: v1Evidence,
        v21: v21Evidence,
        deltaTop1Score: v1Evidence.top1Score != null && v21Evidence.top1Score != null
          ? roundMetric(v21Evidence.top1Score - v1Evidence.top1Score)
          : null
      }
    })

  return {
    ...core,
    nonNoDiacritics: {
      v1: summarizeWithoutNoDiacritics(v1),
      v21: summarizeWithoutNoDiacritics(v21)
    },
    sentinels,
    noAnswerTop1Score: { v1: v1?.noAnswerTop1Score ?? null, v21: v21?.noAnswerTop1Score ?? null },
    noAnswerCases
  }
}

function recallAt1(group, key) {
  const value = group?.[key]?.recallAt1
  return Number.isFinite(value) ? value : null
}

function noRegression(before, after) {
  return before != null && after != null && after >= before
}

export function assessFull20kV21Acceptance(v1, v21, {
  focusCaseIds = FULL20K_FOCUS_CASE_IDS,
  sentinelCaseIds = V2_COUNTRY_OVERBIAS_SENTINEL_IDS,
  criteria = FULL20K_V21_ACCEPTANCE_CRITERIA
} = {}) {
  const v1NonNoDiacritics = summarizeWithoutNoDiacritics(v1)
  const v21NonNoDiacritics = summarizeWithoutNoDiacritics(v21)
  const overallRecallAt1Delta = roundMetric((v21?.quality?.recallAt1 ?? 0) - (v1?.quality?.recallAt1 ?? 0))
  const nonNoDiacriticsRecallAt1Delta = v1NonNoDiacritics && v21NonNoDiacritics
    ? roundMetric(v21NonNoDiacritics.recallAt1 - v1NonNoDiacritics.recallAt1)
    : null

  const v21ById = new Map((v21?.rows ?? []).map((row) => [row.id, row]))
  const rank1Regressions = (v1?.rows ?? [])
    .filter((row) => row.answerable !== false && row.expectedRank === 1)
    .map((row) => ({ id: row.id, v1Rank: 1, v21Rank: v21ById.get(row.id)?.expectedRank ?? null }))
    .filter((row) => row.v21Rank !== 1)
  const v21Top5Misses = (v21?.rows ?? [])
    .filter((row) => row.answerable !== false && (row.expectedRank == null || row.expectedRank > 5))
    .map((row) => ({ id: row.id, expectedRank: row.expectedRank, expectedRankLowerBound: row.expectedRankLowerBound ?? null }))

  const sentinelRanks = sentinelCaseIds.map((id) => ({ id, rank: v21ById.get(id)?.expectedRank ?? null }))
  const observed = {
    overallRecallAt1Delta,
    nonNoDiacriticsRecallAt1Delta,
    v1NonNoDiacritics,
    v21NonNoDiacritics,
    v1HardNegativeRecallAt1: recallAt1(v1?.qualityByChallenge, 'hard-negative'),
    v21HardNegativeRecallAt1: recallAt1(v21?.qualityByChallenge, 'hard-negative'),
    v1CityCapitalRecallAt1: recallAt1(v1?.qualityByCategory, 'city-capital'),
    v21CityCapitalRecallAt1: recallAt1(v21?.qualityByCategory, 'city-capital'),
    v1CountryFactualRecallAt1: recallAt1(v1?.qualityByCategory, 'country-factual'),
    v21CountryFactualRecallAt1: recallAt1(v21?.qualityByCategory, 'country-factual'),
    v1CompressedRecallAt1: recallAt1(v1?.qualityByChallenge, 'compressed'),
    v21CompressedRecallAt1: recallAt1(v21?.qualityByChallenge, 'compressed'),
    v1ImplicitRelationRecallAt1: recallAt1(v1?.qualityByChallenge, 'implicit-relation'),
    v21ImplicitRelationRecallAt1: recallAt1(v21?.qualityByChallenge, 'implicit-relation'),
    sentinelRanks
  }

  const checks = {
    overallRecallAt1MaterialGain: observed.overallRecallAt1Delta >= criteria.minOverallRecallAt1Delta,
    nonNoDiacriticsRecallAt1MaterialGain: observed.nonNoDiacriticsRecallAt1Delta != null && observed.nonNoDiacriticsRecallAt1Delta >= criteria.minNonNoDiacriticsRecallAt1Delta,
    hardNegativeNoRegression: noRegression(observed.v1HardNegativeRecallAt1, observed.v21HardNegativeRecallAt1),
    cityCapitalNoRegression: noRegression(observed.v1CityCapitalRecallAt1, observed.v21CityCapitalRecallAt1),
    countryFactualNoRegression: noRegression(observed.v1CountryFactualRecallAt1, observed.v21CountryFactualRecallAt1),
    compressedNoRegression: noRegression(observed.v1CompressedRecallAt1, observed.v21CompressedRecallAt1),
    implicitRelationNoRegression: noRegression(observed.v1ImplicitRelationRecallAt1, observed.v21ImplicitRelationRecallAt1),
    zeroNewRank1Regressions: rank1Regressions.length <= criteria.maxNewRank1Regressions,
    allV21TargetsRemainTop5: v21Top5Misses.length <= criteria.maxTop5Misses,
    sentinelsRemainRank1: sentinelRanks.every((item) => item.rank === 1)
  }

  return {
    accepted: Object.values(checks).every(Boolean),
    criteria,
    observed,
    checks,
    focusCaseIds: [...focusCaseIds],
    rank1Regressions,
    v21Top5Misses
  }
}
