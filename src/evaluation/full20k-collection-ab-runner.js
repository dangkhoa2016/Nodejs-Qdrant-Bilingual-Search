import { FOCUSED_AB_RUNTIME, assertFocusedAbRuntime } from './focused-text-ab-runner.js'
import {
  FULL20K_FOCUS_CASE_IDS,
  FULL20K_V21_ACCEPTANCE_CRITERIA,
  V2_COUNTRY_OVERBIAS_SENTINEL_IDS,
  assessFull20kV21Acceptance,
  compareFull20kCollectionVariants,
  evaluateFull20kCollectionVariant
} from './full20k-collection-ab.js'

export const FULL20K_AB_RUNTIME = FOCUSED_AB_RUNTIME

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`)
}

function normalizePoint(point) {
  const score = Number(point?.score)
  if (!Number.isFinite(score)) throw new Error('Qdrant full-20k A/B result is missing a finite score')
  return {
    id: point?.payload?.entity_id ?? String(point?.id),
    score,
    type: point?.payload?.type ?? null,
    name: {
      en: point?.payload?.name_en ?? null,
      vi: point?.payload?.name_vi ?? null
    }
  }
}

export function assertFull20kAbRuntime(identity) {
  try {
    return assertFocusedAbRuntime(identity)
  } catch (error) {
    throw new Error('full-20k collection A/B semantic runtime verification failed', { cause: error })
  }
}

export function assertFull20kCollectionInfo(info, { collection, dimension, expectedPoints, rankProbeLimit = null }) {
  const status = String(info?.status ?? '').toLowerCase()
  if (status !== 'green') throw new Error(`Qdrant collection ${collection} status must be green, got ${status || 'unknown'}`)
  const vectors = info?.config?.params?.vectors
  const size = Number(vectors?.size)
  if (size !== dimension) throw new Error(`Qdrant collection ${collection} vector size mismatch: expected ${dimension}, got ${Number.isFinite(size) ? size : 'unknown'}`)
  if (String(vectors?.distance ?? '').toLowerCase() !== 'cosine') {
    throw new Error(`Qdrant collection ${collection} distance mismatch: expected Cosine, got ${vectors?.distance ?? 'unknown'}`)
  }
  const pointsCount = Number(info?.points_count)
  if (!Number.isInteger(pointsCount) || pointsCount !== expectedPoints) {
    throw new Error(`Qdrant collection ${collection} point count mismatch: expected ${expectedPoints}, got ${Number.isFinite(pointsCount) ? pointsCount : 'unknown'}`)
  }
  const strict = info?.config?.strict_mode_config
  const strictMax = strict?.enabled === true ? Number(strict.max_query_limit) : null
  if (rankProbeLimit != null && Number.isInteger(strictMax) && strictMax > 0 && rankProbeLimit > strictMax) {
    throw new Error(`Qdrant collection ${collection} rank probe limit ${rankProbeLimit} exceeds strict max_query_limit ${strictMax}`)
  }
  return {
    collection, status, pointsCount, dimension: size, distance: vectors.distance,
    strictMaxQueryLimit: Number.isInteger(strictMax) && strictMax > 0 ? strictMax : null
  }
}

export async function runFull20kCollectionAbExperiment({
  cases,
  embeddingProvider,
  qdrantV1,
  qdrantV21,
  resultLimit = 5,
  rankProbeLimit = 100,
  focusCaseIds = FULL20K_FOCUS_CASE_IDS,
  sentinelCaseIds = V2_COUNTRY_OVERBIAS_SENTINEL_IDS,
  acceptanceCriteria = FULL20K_V21_ACCEPTANCE_CRITERIA
}) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('cases must not be empty')
  if (!embeddingProvider || typeof embeddingProvider.embedQuery !== 'function') throw new TypeError('embeddingProvider must implement embedQuery')
  if (!qdrantV1 || typeof qdrantV1.querySemantic !== 'function') throw new TypeError('qdrantV1 must implement querySemantic')
  if (!qdrantV21 || typeof qdrantV21.querySemantic !== 'function') throw new TypeError('qdrantV21 must implement querySemantic')
  positiveInteger(resultLimit, 'resultLimit')
  positiveInteger(rankProbeLimit, 'rankProbeLimit')
  if (rankProbeLimit < resultLimit) throw new RangeError('rankProbeLimit must be >= resultLimit')

  const v1ResultsByCaseId = new Map()
  const v21ResultsByCaseId = new Map()

  for (const item of cases) {
    const vector = await embeddingProvider.embedQuery(item.query)
    const request = { vector, filter: undefined, limit: rankProbeLimit, scoreThreshold: 0 }
    const [v1Points, v21Points] = await Promise.all([
      qdrantV1.querySemantic(request),
      qdrantV21.querySemantic(request)
    ])
    v1ResultsByCaseId.set(item.id, v1Points.map(normalizePoint))
    v21ResultsByCaseId.set(item.id, v21Points.map(normalizePoint))
  }

  const variants = {
    v1: evaluateFull20kCollectionVariant(cases, v1ResultsByCaseId, { resultLimit, rankProbeLimit }),
    v21: evaluateFull20kCollectionVariant(cases, v21ResultsByCaseId, { resultLimit, rankProbeLimit })
  }
  const comparison = compareFull20kCollectionVariants(variants.v1, variants.v21, { focusCaseIds, sentinelCaseIds })
  const acceptance = assessFull20kV21Acceptance(variants.v1, variants.v21, {
    focusCaseIds,
    sentinelCaseIds,
    criteria: acceptanceCriteria
  })

  return {
    experiment: 'embedding_text_v1_vs_v2_1_full20k_collection_ab',
    cases: cases.length,
    answerableCases: cases.filter((item) => item.answerable !== false).length,
    noAnswerCases: cases.filter((item) => item.answerable === false).length,
    resultLimit,
    rankProbeLimit,
    variants,
    comparison,
    acceptance,
    noDiacriticsCaseIds: cases.filter((item) => item.answerable !== false && item.challenge === 'no-diacritics').map((item) => item.id)
  }
}
