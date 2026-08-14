import { buildEmbeddingText, buildEmbeddingTextV21 } from '../domain/embedding-text.js'
import { summarizeEvaluation } from './metrics.js'
import { FOCUSED_FAILURE_CASE_IDS, compareFocusedVariants, evaluateFocusedVariant } from './focused-text-ab.js'
import { FOCUSED_AB_RUNTIME, assertFocusedAbRuntime } from './focused-text-ab-runner.js'
import { buildStressCandidateSet } from './stress-text-ab.js'

export const STRESS_AB_RUNTIME = FOCUSED_AB_RUNTIME

export const V21_STRESS_ACCEPTANCE_CRITERIA = Object.freeze({
  minOverallRecallAt1Delta: 0.025,
  minNonNoDiacriticsRecallAt1Delta: 0.02,
  hardNegativeRecallAt1: 14 / 15,
  maxNewRank1Regressions: 0
})

function roundMetric(value) {
  return Math.round(value * 1e12) / 1e12
}

function recallAt1(group, key) {
  const value = group?.[key]?.recallAt1
  return Number.isFinite(value) ? value : null
}

function summarizeWithoutNoDiacritics(variant) {
  const rows = (variant?.rows ?? []).filter((row) => row.challenge !== 'no-diacritics')
  return summarizeEvaluation(rows.map((row) => ({ resultIds: row.resultIds, expectedIds: row.expectedIds })))
}

export function assessV21StressAcceptance(v1, v21, criteria = V21_STRESS_ACCEPTANCE_CRITERIA) {
  const v1WithoutNoDiacritics = summarizeWithoutNoDiacritics(v1)
  const v21WithoutNoDiacritics = summarizeWithoutNoDiacritics(v21)
  const overallRecallAt1Delta = roundMetric((v21?.quality?.recallAt1 ?? 0) - (v1?.quality?.recallAt1 ?? 0))
  const nonNoDiacriticsRecallAt1Delta = roundMetric(v21WithoutNoDiacritics.recallAt1 - v1WithoutNoDiacritics.recallAt1)

  const observed = {
    overallRecallAt1Delta,
    nonNoDiacriticsRecallAt1Delta,
    v1WithoutNoDiacritics,
    v21WithoutNoDiacritics,
    hardNegativeRecallAt1: recallAt1(v21?.qualityByChallenge, 'hard-negative'),
    v1CityCapitalRecallAt1: recallAt1(v1?.qualityByCategory, 'city-capital'),
    v21CityCapitalRecallAt1: recallAt1(v21?.qualityByCategory, 'city-capital'),
    v1CountryFactualRecallAt1: recallAt1(v1?.qualityByCategory, 'country-factual'),
    v21CountryFactualRecallAt1: recallAt1(v21?.qualityByCategory, 'country-factual'),
    v1CompressedRecallAt1: recallAt1(v1?.qualityByChallenge, 'compressed'),
    v21CompressedRecallAt1: recallAt1(v21?.qualityByChallenge, 'compressed'),
    v1ImplicitRelationRecallAt1: recallAt1(v1?.qualityByChallenge, 'implicit-relation'),
    v21ImplicitRelationRecallAt1: recallAt1(v21?.qualityByChallenge, 'implicit-relation')
  }

  const v21ById = new Map((v21?.rows ?? []).map((row) => [row.id, row]))
  const rank1Regressions = (v1?.rows ?? [])
    .filter((row) => row.expectedRank === 1)
    .map((row) => ({ id: row.id, v1Rank: 1, v21Rank: v21ById.get(row.id)?.expectedRank ?? null }))
    .filter((row) => row.v21Rank !== 1)

  const noRegression = (before, after) => before != null && after != null && after >= before
  const checks = {
    overallRecallAt1MaterialGain: overallRecallAt1Delta >= criteria.minOverallRecallAt1Delta,
    nonNoDiacriticsRecallAt1MaterialGain: nonNoDiacriticsRecallAt1Delta >= criteria.minNonNoDiacriticsRecallAt1Delta,
    hardNegativeMeetsBar: observed.hardNegativeRecallAt1 != null && observed.hardNegativeRecallAt1 >= criteria.hardNegativeRecallAt1,
    cityCapitalNoRegression: noRegression(observed.v1CityCapitalRecallAt1, observed.v21CityCapitalRecallAt1),
    countryFactualNoRegression: noRegression(observed.v1CountryFactualRecallAt1, observed.v21CountryFactualRecallAt1),
    compressedNoRegression: noRegression(observed.v1CompressedRecallAt1, observed.v21CompressedRecallAt1),
    implicitRelationNoRegression: noRegression(observed.v1ImplicitRelationRecallAt1, observed.v21ImplicitRelationRecallAt1),
    zeroNewRank1Regressions: rank1Regressions.length <= criteria.maxNewRank1Regressions
  }

  return {
    accepted: Object.values(checks).every(Boolean),
    criteria,
    observed,
    checks,
    rank1Regressions
  }
}

function assertBatchSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 256) throw new RangeError('batchSize must be an integer from 1 through 256')
}

function buildCandidateTexts(candidates, builder) {
  return candidates.map((entity) => ({ id: entity.id, type: entity.type, name: entity.name, ...builder(entity) }))
}

async function embedInBatches(provider, texts, batchSize) {
  const vectors = []
  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = await provider.embedDocuments(texts.slice(index, index + batchSize))
    if (!Array.isArray(batch) || batch.length !== Math.min(batchSize, texts.length - index)) {
      throw new Error('embedding provider returned an unexpected document vector count')
    }
    vectors.push(...batch)
  }
  return vectors
}

export { assertFocusedAbRuntime as assertStressAbRuntime }

export async function runStressTextV21AbExperiment({
  cases,
  hardReport,
  entities,
  embeddingProvider,
  focusCaseIds = FOCUSED_FAILURE_CASE_IDS,
  targetSize = 750,
  maxSize = 1000,
  batchSize = 128,
  limit = 5
}) {
  if (!embeddingProvider || typeof embeddingProvider.embedQuery !== 'function' || typeof embeddingProvider.embedDocuments !== 'function') {
    throw new TypeError('embeddingProvider must implement embedQuery and embedDocuments')
  }
  assertBatchSize(batchSize)

  const answerableCases = cases.filter((item) => item?.answerable !== false)
  if (!answerableCases.length) throw new TypeError('stress A/B requires answerable benchmark cases')

  const { entities: candidates, manifest: candidateManifest } = buildStressCandidateSet({
    cases: answerableCases,
    hardReport,
    entities,
    targetSize,
    maxSize
  })
  const candidateTexts = {
    v1: buildCandidateTexts(candidates, buildEmbeddingText),
    v21: buildCandidateTexts(candidates, buildEmbeddingTextV21)
  }
  if (candidateTexts.v1.some((item) => item.version !== 'v1')) throw new Error('v1 candidate text builder returned unexpected version')
  if (candidateTexts.v21.some((item) => item.version !== 'v2.1')) throw new Error('v2.1 candidate text builder returned unexpected version')

  const queryVectorsById = new Map()
  for (const item of answerableCases) queryVectorsById.set(item.id, await embeddingProvider.embedQuery(item.query))

  const v1Vectors = await embedInBatches(embeddingProvider, candidateTexts.v1.map((item) => item.text), batchSize)
  const v21Vectors = await embedInBatches(embeddingProvider, candidateTexts.v21.map((item) => item.text), batchSize)
  const variants = {
    v1: evaluateFocusedVariant(answerableCases, queryVectorsById, candidates, v1Vectors, { limit }),
    v21: evaluateFocusedVariant(answerableCases, queryVectorsById, candidates, v21Vectors, { limit })
  }
  const comparison = compareFocusedVariants(variants.v1, variants.v21, { focusCaseIds, secondLabel: 'v21' })
  const acceptance = assessV21StressAcceptance(variants.v1, variants.v21)

  return {
    experiment: 'embedding_text_v1_vs_v2_1_stress_ab',
    answerableCases: answerableCases.length,
    candidateManifest,
    candidateTexts,
    variants,
    comparison,
    acceptance,
    noDiacriticsCaseIds: answerableCases.filter((item) => item.challenge === 'no-diacritics').map((item) => item.id)
  }
}
