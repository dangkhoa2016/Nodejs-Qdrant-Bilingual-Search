export const CANONICAL_QWEN_PROFILE = Object.freeze({
  collection: 'knowledge_entities_qwen3_4b_text_v21',
  embeddingModel: 'Qwen/Qwen3-Embedding-4B',
  embeddingDimension: 2560,
  embeddingTransport: 'binary-f32',
  embeddingTextVersion: 'v2.1',
  embeddingTimeoutMs: 120_000,
  searchDefaultScoreThreshold: 0.55,
  searchConsistencyVerificationEnabled: true,
  searchConsistencyCandidateMultiplier: 5,
  searchDomainEntityIntentGateEnabled: true
})

export const QWEN_V1_ROLLBACK_COLLECTION = 'knowledge_entities_qwen3_4b_v1'

export function assertCanonicalRuntimeConfig(config) {
  if (!config || typeof config !== 'object') throw new TypeError('config is required')
  const mismatches = []
  const expected = CANONICAL_QWEN_PROFILE
  if (config.qdrantCollection !== expected.collection) mismatches.push(`collection=${config.qdrantCollection ?? 'missing'}`)
  if (config.embeddingModel !== expected.embeddingModel) mismatches.push(`embeddingModel=${config.embeddingModel ?? 'missing'}`)
  if (config.embeddingDimension !== expected.embeddingDimension) mismatches.push(`embeddingDimension=${config.embeddingDimension ?? 'missing'}`)
  if (config.embeddingTransport !== expected.embeddingTransport) mismatches.push(`embeddingTransport=${config.embeddingTransport ?? 'missing'}`)
  if (config.embeddingTextVersion !== expected.embeddingTextVersion) mismatches.push(`embeddingTextVersion=${config.embeddingTextVersion ?? 'missing'}`)
  if (config.embeddingTimeoutMs !== expected.embeddingTimeoutMs) mismatches.push(`embeddingTimeoutMs=${config.embeddingTimeoutMs ?? 'missing'}`)
  if (config.searchDefaultScoreThreshold !== expected.searchDefaultScoreThreshold) mismatches.push(`searchDefaultScoreThreshold=${config.searchDefaultScoreThreshold ?? 'missing'}`)
  if (config.searchConsistencyVerificationEnabled !== expected.searchConsistencyVerificationEnabled) mismatches.push(`searchConsistencyVerificationEnabled=${config.searchConsistencyVerificationEnabled ?? 'missing'}`)
  if (config.searchConsistencyCandidateMultiplier !== expected.searchConsistencyCandidateMultiplier) mismatches.push(`searchConsistencyCandidateMultiplier=${config.searchConsistencyCandidateMultiplier ?? 'missing'}`)
  if (config.searchDomainEntityIntentGateEnabled !== expected.searchDomainEntityIntentGateEnabled) mismatches.push(`searchDomainEntityIntentGateEnabled=${config.searchDomainEntityIntentGateEnabled ?? 'missing'}`)
  if (mismatches.length) {
    throw new Error(`canonical runtime config mismatch: ${mismatches.join(', ')}`)
  }
  return true
}
