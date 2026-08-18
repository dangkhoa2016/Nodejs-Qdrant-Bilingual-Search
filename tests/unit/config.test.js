import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../../src/config.js'

const BEAM_URL = 'https://beam.example.test'
const MODAL_URL = 'https://modal.example.test'

test('loadConfig returns the promoted Qwen v2.1 canonical search defaults', () => {
  const config = loadConfig({})
  assert.equal(config.port, 3000)
  assert.equal(config.qdrantCollection, 'knowledge_entities_qwen3_4b_text_v21')
  assert.equal(config.embeddingModel, 'Qwen/Qwen3-Embedding-4B')
  assert.equal(config.embeddingDimension, 2560)
  assert.equal(config.embeddingTimeoutMs, 120000)
  assert.equal(config.embeddingTransport, 'binary-f32')
  assert.equal(config.embeddingTextVersion, 'v2.1')
  assert.equal(config.searchDefaultScoreThreshold, 0.55)
  assert.equal(config.seedProgressPath, 'reports/seed-progress.json')
  assert.equal(config.seedProgressEventsPath, 'reports/seed-progress.jsonl')
  assert.equal(config.seedProgressEveryBatches, 0)
  assert.deepEqual(config.qdrant, {
    provider: 'local',
    url: 'http://127.0.0.1:6333',
    apiKey: undefined,
    requestTimeoutMs: 10_000,
    requestRetry: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000, jitterRatio: 0.2 },
    startupRetry: { maxAttempts: 8, baseDelayMs: 500, maxDelayMs: 5_000, jitterRatio: 0.2 }
  })
})

test('loadConfig selects Beam profile without consulting Modal', () => {
  const config = loadConfig({
    QDRANT_PROVIDER: 'beam',
    QDRANT_BEAM_URL: BEAM_URL,
    QDRANT_BEAM_API_KEY: 'beam-secret',
    QDRANT_MODAL_URL: MODAL_URL,
    QDRANT_MODAL_API_KEY: 'modal-secret'
  })
  assert.equal(config.qdrant.provider, 'beam')
  assert.equal(config.qdrant.url, BEAM_URL)
  assert.equal(config.qdrant.apiKey, 'beam-secret')
})

test('loadConfig selects Modal profile and supports generic credential fallback', () => {
  const config = loadConfig({
    QDRANT_PROVIDER: 'modal',
    QDRANT_URL: MODAL_URL,
    QDRANT_API_KEY: 'generic-secret'
  })
  assert.equal(config.qdrant.provider, 'modal')
  assert.equal(config.qdrant.url, MODAL_URL)
  assert.equal(config.qdrant.apiKey, 'generic-secret')
})

test('loadConfig requires URL and API key for remote providers', () => {
  assert.throws(() => loadConfig({ QDRANT_PROVIDER: 'beam' }), /QDRANT_BEAM_URL|QDRANT_URL/)
  assert.throws(() => loadConfig({ QDRANT_PROVIDER: 'beam', QDRANT_BEAM_URL: BEAM_URL }), /QDRANT_BEAM_API_KEY|QDRANT_API_KEY/)
  assert.throws(() => loadConfig({ QDRANT_PROVIDER: 'modal', QDRANT_MODAL_URL: MODAL_URL }), /QDRANT_MODAL_API_KEY|QDRANT_API_KEY/)
})

test('loadConfig rejects unknown providers and invalid retry configuration', () => {
  assert.throws(() => loadConfig({ QDRANT_PROVIDER: 'other' }), /QDRANT_PROVIDER/)
  assert.throws(() => loadConfig({ QDRANT_RETRY_MAX_ATTEMPTS: '0' }), /QDRANT_RETRY_MAX_ATTEMPTS/)
  assert.throws(() => loadConfig({ QDRANT_RETRY_JITTER_RATIO: '1.5' }), /QDRANT_RETRY_JITTER_RATIO/)
})

test('loadConfig rejects non-HTTP Qdrant endpoints before constructing the SDK client', () => {
  assert.throws(() => loadConfig({ QDRANT_LOCAL_URL: 'ftp://qdrant.example.test' }), /http|https/i)
})

test('loadConfig validates unsafe port, embedding timeout, transport and threshold', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/)
  assert.throws(() => loadConfig({ EMBEDDING_REQUEST_TIMEOUT_MS: '0' }), /EMBEDDING_REQUEST_TIMEOUT_MS/)
  assert.throws(() => loadConfig({ EMBEDDING_TRANSPORT: 'base64' }), /EMBEDDING_TRANSPORT/)
  assert.equal(loadConfig({ EMBEDDING_TRANSPORT: 'binary-f32' }).embeddingTransport, 'binary-f32')
  assert.throws(() => loadConfig({ SEED_PROGRESS_EVERY_BATCHES: '-1' }), /SEED_PROGRESS_EVERY_BATCHES/)
  assert.throws(() => loadConfig({ SEARCH_DEFAULT_SCORE_THRESHOLD: '1.5' }), /THRESHOLD/)
})

test('loadConfig keeps local API key undefined when blank', () => {
  assert.equal(loadConfig({ QDRANT_API_KEY: '' }).qdrant.apiKey, undefined)
})

test('loadConfig keeps the promoted v2.1 text version by default and permits explicit v1 rollback configuration', () => {
  assert.equal(loadConfig({}).embeddingTextVersion, 'v2.1')
  const rollback = loadConfig({
    QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
    EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
    EMBEDDING_DIMENSION: '2560',
    EMBEDDING_TEXT_VERSION: 'v1'
  })
  assert.equal(rollback.qdrantCollection, 'knowledge_entities_qwen3_4b_v1')
  assert.equal(rollback.embeddingTextVersion, 'v1')
  assert.throws(() => loadConfig({ EMBEDDING_TEXT_VERSION: 'v2' }), /EMBEDDING_TEXT_VERSION/)
})

test('loadConfig enables canonical consistency verification with bounded candidate overfetch', () => {
  const config = loadConfig({})
  assert.equal(config.searchConsistencyVerificationEnabled, true)
  assert.equal(config.searchConsistencyCandidateMultiplier, 5)

  assert.equal(loadConfig({ SEARCH_CONSISTENCY_VERIFICATION_ENABLED: 'false' }).searchConsistencyVerificationEnabled, false)
  assert.throws(() => loadConfig({ SEARCH_CONSISTENCY_VERIFICATION_ENABLED: 'maybe' }), /SEARCH_CONSISTENCY_VERIFICATION_ENABLED/)
  assert.throws(() => loadConfig({ SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER: '0' }), /SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER/)
})

test('loadConfig enables canonical domain/entity-intent gate with explicit rollback support', () => {
  const config = loadConfig({})
  assert.equal(config.searchDomainEntityIntentGateEnabled, true)
  assert.equal(loadConfig({ SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED: 'false' }).searchDomainEntityIntentGateEnabled, false)
  assert.throws(
    () => loadConfig({ SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED: 'maybe' }),
    /SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED/
  )
})
