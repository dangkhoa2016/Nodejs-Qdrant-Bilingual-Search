import { buildEmbeddingText, buildEmbeddingTextV2, buildEmbeddingTextV21 } from '../domain/embedding-text.js'
import { requireVerifiedSemanticEmbeddingRuntime } from '../embeddings/runtime-provenance.js'
import {
  FOCUSED_FAILURE_CASE_IDS,
  buildFocusedCandidateSet,
  compareFocusedVariants,
  evaluateFocusedVariant
} from './focused-text-ab.js'



export const FOCUSED_AB_RUNTIME = Object.freeze({
  model: 'Qwen/Qwen3-Embedding-4B',
  dimension: 2560,
  profile: 'qwen3',
  queryStrategy: 'prompt',
  queryInstructionId: 'geo-retrieval-v1:d014d3ec6df87e49',
  documentStrategy: 'raw',
  device: 'cuda',
  dtype: 'float16'
})


export const V21_ACCEPTANCE_CRITERIA = Object.freeze({
  countryFactualRecallAt1: 0.95,
  hardNegativeRecallAt1: 14 / 15,
  cityCapitalRecallAt1: 11 / 12,
  compressedRecallAt1: 0.8,
  implicitRelationRecallAt1: 1,
  maxNewRank1Regressions: 0
})

function recallAt1(group, key) {
  const value = group?.[key]?.recallAt1
  return Number.isFinite(value) ? value : null
}

export function assessV21Acceptance(v1, v21, criteria = V21_ACCEPTANCE_CRITERIA) {
  const observed = {
    countryFactualRecallAt1: recallAt1(v21?.qualityByCategory, 'country-factual'),
    hardNegativeRecallAt1: recallAt1(v21?.qualityByChallenge, 'hard-negative'),
    cityCapitalRecallAt1: recallAt1(v21?.qualityByCategory, 'city-capital'),
    compressedRecallAt1: recallAt1(v21?.qualityByChallenge, 'compressed'),
    implicitRelationRecallAt1: recallAt1(v21?.qualityByChallenge, 'implicit-relation')
  }
  const v21ById = new Map((v21?.rows ?? []).map((row) => [row.id, row]))
  const rank1Regressions = (v1?.rows ?? [])
    .filter((row) => row?.expectedRank === 1)
    .map((row) => ({ id: row.id, v1Rank: 1, v21Rank: v21ById.get(row.id)?.expectedRank ?? null }))
    .filter((row) => row.v21Rank !== 1)

  const checks = {
    countryFactualRecallAt1: observed.countryFactualRecallAt1 != null && observed.countryFactualRecallAt1 >= criteria.countryFactualRecallAt1,
    hardNegativeRecallAt1: observed.hardNegativeRecallAt1 != null && observed.hardNegativeRecallAt1 >= criteria.hardNegativeRecallAt1,
    cityCapitalRecallAt1: observed.cityCapitalRecallAt1 != null && observed.cityCapitalRecallAt1 >= criteria.cityCapitalRecallAt1,
    compressedRecallAt1: observed.compressedRecallAt1 != null && observed.compressedRecallAt1 >= criteria.compressedRecallAt1,
    implicitRelationRecallAt1: observed.implicitRelationRecallAt1 != null && observed.implicitRelationRecallAt1 >= criteria.implicitRelationRecallAt1,
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

export function assertFocusedAbRuntime(identity, expected = FOCUSED_AB_RUNTIME) {
  try {
    requireVerifiedSemanticEmbeddingRuntime(identity)
  } catch (error) {
    throw new Error('focused A/B semantic embedding runtime verification failed', { cause: error })
  }
  if (identity?.model !== expected.model) throw new Error(`focused A/B model mismatch: expected ${expected.model}, got ${identity?.model ?? 'unknown'}`)
  if (identity?.dimension !== expected.dimension) throw new Error(`focused A/B dimension mismatch: expected ${expected.dimension}, got ${identity?.dimension ?? 'unknown'}`)
  if (identity?.profile !== expected.profile) throw new Error(`focused A/B profile mismatch: expected ${expected.profile}, got ${identity?.profile ?? 'unknown'}`)
  if (identity?.query_strategy !== expected.queryStrategy) throw new Error(`focused A/B query strategy mismatch: expected ${expected.queryStrategy}, got ${identity?.query_strategy ?? 'unknown'}`)
  if (identity?.query_instruction_id !== expected.queryInstructionId) {
    throw new Error(`focused A/B query instruction mismatch: expected ${expected.queryInstructionId}, got ${identity?.query_instruction_id ?? 'unknown'}`)
  }
  if (identity?.document_strategy !== expected.documentStrategy) {
    throw new Error(`focused A/B document strategy mismatch: expected ${expected.documentStrategy}, got ${identity?.document_strategy ?? 'unknown'}`)
  }
  if (identity?.device !== expected.device) throw new Error(`focused A/B device mismatch: expected ${expected.device}, got ${identity?.device ?? 'unknown'}`)
  if (identity?.dtype !== expected.dtype) throw new Error(`focused A/B dtype mismatch: expected ${expected.dtype}, got ${identity?.dtype ?? 'unknown'}`)
  return identity
}

function assertBatchSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 256) {
    throw new TypeError('batchSize must be an integer between 1 and 256')
  }
}

async function embedInBatches(provider, texts, batchSize) {
  const vectors = []
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize)
    const embedded = await provider.embedDocuments(batch)
    if (!Array.isArray(embedded) || embedded.length !== batch.length) {
      throw new Error(`embedding provider returned ${embedded?.length ?? 'invalid'} vectors for batch of ${batch.length}`)
    }
    vectors.push(...embedded)
  }
  return vectors
}

function buildCandidateTexts(candidates, builder) {
  return candidates.map((entity) => {
    const built = builder(entity)
    return { id: entity.id, version: built.version, text: built.text }
  })
}

export async function runFocusedTextAbExperiment({
  cases,
  hardReport,
  entities,
  embeddingProvider,
  focusCaseIds = FOCUSED_FAILURE_CASE_IDS,
  targetSize = 75,
  maxSize = 150,
  batchSize = 128,
  limit = 5
}) {
  if (!embeddingProvider || typeof embeddingProvider.embedQuery !== 'function' || typeof embeddingProvider.embedDocuments !== 'function') {
    throw new TypeError('embeddingProvider must implement embedQuery and embedDocuments')
  }
  assertBatchSize(batchSize)

  const answerableCases = cases.filter((item) => item?.answerable !== false)
  if (!answerableCases.length) throw new TypeError('focused A/B requires answerable benchmark cases')

  const { entities: candidates, manifest: candidateManifest } = buildFocusedCandidateSet({
    cases: answerableCases,
    hardReport,
    entities,
    focusCaseIds,
    targetSize,
    maxSize
  })

  const candidateTexts = {
    v1: buildCandidateTexts(candidates, buildEmbeddingText),
    v2: buildCandidateTexts(candidates, buildEmbeddingTextV2)
  }
  if (candidateTexts.v1.some((item) => item.version !== 'v1')) throw new Error('v1 candidate text builder returned unexpected version')
  if (candidateTexts.v2.some((item) => item.version !== 'v2')) throw new Error('v2 candidate text builder returned unexpected version')

  const queryVectorsById = new Map()
  for (const item of answerableCases) {
    queryVectorsById.set(item.id, await embeddingProvider.embedQuery(item.query))
  }

  const v1Vectors = await embedInBatches(embeddingProvider, candidateTexts.v1.map((item) => item.text), batchSize)
  const v2Vectors = await embedInBatches(embeddingProvider, candidateTexts.v2.map((item) => item.text), batchSize)

  const variants = {
    v1: evaluateFocusedVariant(answerableCases, queryVectorsById, candidates, v1Vectors, { limit }),
    v2: evaluateFocusedVariant(answerableCases, queryVectorsById, candidates, v2Vectors, { limit })
  }
  const comparison = compareFocusedVariants(variants.v1, variants.v2, { focusCaseIds })

  return {
    experiment: 'embedding_text_v1_vs_v2_focused_ab',
    answerableCases: answerableCases.length,
    candidateManifest,
    candidateTexts,
    variants,
    comparison,
    noDiacriticsCaseIds: answerableCases.filter((item) => item.challenge === 'no-diacritics').map((item) => item.id)
  }
}


export async function runFocusedTextV21AbExperiment({
  cases,
  hardReport,
  entities,
  embeddingProvider,
  focusCaseIds = FOCUSED_FAILURE_CASE_IDS,
  targetSize = 75,
  maxSize = 150,
  batchSize = 128,
  limit = 5
}) {
  if (!embeddingProvider || typeof embeddingProvider.embedQuery !== 'function' || typeof embeddingProvider.embedDocuments !== 'function') {
    throw new TypeError('embeddingProvider must implement embedQuery and embedDocuments')
  }
  assertBatchSize(batchSize)

  const answerableCases = cases.filter((item) => item?.answerable !== false)
  if (!answerableCases.length) throw new TypeError('focused A/B requires answerable benchmark cases')

  const { entities: candidates, manifest: candidateManifest } = buildFocusedCandidateSet({
    cases: answerableCases,
    hardReport,
    entities,
    focusCaseIds,
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
  for (const item of answerableCases) {
    queryVectorsById.set(item.id, await embeddingProvider.embedQuery(item.query))
  }

  const v1Vectors = await embedInBatches(embeddingProvider, candidateTexts.v1.map((item) => item.text), batchSize)
  const v21Vectors = await embedInBatches(embeddingProvider, candidateTexts.v21.map((item) => item.text), batchSize)

  const variants = {
    v1: evaluateFocusedVariant(answerableCases, queryVectorsById, candidates, v1Vectors, { limit }),
    v21: evaluateFocusedVariant(answerableCases, queryVectorsById, candidates, v21Vectors, { limit })
  }
  const comparison = compareFocusedVariants(variants.v1, variants.v21, { focusCaseIds, secondLabel: 'v21' })
  const acceptance = assessV21Acceptance(variants.v1, variants.v21)

  return {
    experiment: 'embedding_text_v1_vs_v2_1_focused_ab',
    answerableCases: answerableCases.length,
    candidateManifest,
    candidateTexts,
    variants,
    comparison,
    acceptance,
    noDiacriticsCaseIds: answerableCases.filter((item) => item.challenge === 'no-diacritics').map((item) => item.id)
  }
}
