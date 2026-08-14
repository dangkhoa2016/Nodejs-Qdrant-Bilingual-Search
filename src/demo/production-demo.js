export const CANONICAL_DEMO = Object.freeze({
  collection: 'knowledge_entities_qwen3_4b_text_v21',
  embeddingModel: 'Qwen/Qwen3-Embedding-4B',
  embeddingDimension: 2560,
  embeddingTransport: 'binary-f32',
  embeddingTextVersion: 'v2.1',
  scoreThreshold: 0.55,
  consistencyEnabled: true,
  consistencyCandidateMultiplier: 5,
  domainEntityIntentGateEnabled: true
})

export const DEMO_QUERIES = Object.freeze([
  { language: 'en', query: 'Southeast Asian country whose capital is Bangkok', expected: 'Thailand' },
  { language: 'vi', query: 'quốc gia Đông Nam Á có thủ đô Bangkok', expected: 'Thailand' },
  { language: 'en', query: 'Asian country famous for Mount Fuji', expected: 'Japan' },
  { language: 'vi', query: 'quốc gia châu Á nổi tiếng với núi Phú Sĩ', expected: 'Japan' },
  { language: 'en', query: 'What is the plot of the movie Casablanca?', expected: 'Casablanca', negative: true }
])

function infoConfig(payload) {
  const info = payload?.info ?? payload
  return info?.config ?? info ?? {}
}

function field(config, camel, snake) {
  return config?.[camel] ?? config?.[snake]
}

export function assertCanonicalInfo(payload) {
  const config = infoConfig(payload)
  const checks = [
    ['collection', field(config, 'qdrantCollection', 'qdrant_collection'), CANONICAL_DEMO.collection],
    ['embedding model', field(config, 'embeddingModel', 'embedding_model'), CANONICAL_DEMO.embeddingModel],
    ['embedding dimension', Number(field(config, 'embeddingDimension', 'embedding_dimension')), CANONICAL_DEMO.embeddingDimension],
    ['embedding transport', field(config, 'embeddingTransport', 'embedding_transport'), CANONICAL_DEMO.embeddingTransport],
    ['embedding text version', field(config, 'embeddingTextVersion', 'embedding_text_version'), CANONICAL_DEMO.embeddingTextVersion],
    ['score threshold', Number(field(config, 'searchDefaultScoreThreshold', 'search_default_score_threshold')), CANONICAL_DEMO.scoreThreshold],
    ['consistency enabled', field(config, 'searchConsistencyVerificationEnabled', 'search_consistency_verification_enabled'), true],
    ['consistency multiplier', Number(field(config, 'searchConsistencyCandidateMultiplier', 'search_consistency_candidate_multiplier')), 5],
    ['domain/entity-intent gate', field(config, 'searchDomainEntityIntentGateEnabled', 'search_domain_entity_intent_gate_enabled'), true]
  ]
  const mismatches = checks.filter(([, actual, expected]) => actual !== expected).map(([name, actual, expected]) => `${name}: ${actual} != ${expected}`)
  if (mismatches.length) throw new Error(`non-canonical production demo info: ${mismatches.join('; ')}`)
  return true
}

export function displayName(result) {
  return result?.name?.en ?? result?.name?.vi ?? result?.name_en ?? result?.name_vi ?? result?.payload?.name_en ?? result?.payload?.name_vi ?? ''
}

export function assertExpectedTopEntity(payload, expectedName) {
  const top = payload?.results?.[0]
  const name = displayName(top)
  if (!top || name.toLowerCase() !== String(expectedName).toLowerCase()) {
    throw new Error(`expected top entity ${expectedName}, got ${name || 'no result'}`)
  }
  return top
}

export function assertNoGeographicFalsePositive(payload, entityName) {
  const target = String(entityName).toLowerCase()
  const bad = (payload?.results ?? []).find((result) => {
    const name = displayName(result).toLowerCase()
    const type = String(result?.type ?? result?.payload?.type ?? '').toLowerCase()
    return name === target && ['city', 'country', 'landmark', 'region', 'geographic'].some((token) => type.includes(token))
  })
  if (bad) throw new Error(`geographic false positive returned for ${entityName}`)
  return true
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { throw new Error(`${url} returned non-JSON HTTP ${response.status}`) }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`)
  return body
}

export async function search(apiUrl, item) {
  return fetchJson(`${apiUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: item.query, language: item.language, limit: 5 })
  })
}
