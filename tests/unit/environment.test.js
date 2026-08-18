import test from 'node:test'
import assert from 'node:assert/strict'
import { environmentSnapshot } from '../../src/runtime/environment.js'

test('environmentSnapshot exposes selected provider metadata but never Qdrant credentials', () => {
  const snapshot = environmentSnapshot({
    config: {
      qdrant: {
        provider: 'beam',
        url: 'https://beam.example.test',
        apiKey: 'super-secret',
        requestTimeoutMs: 10_000,
        requestRetry: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000, jitterRatio: 0.2 },
        startupRetry: { maxAttempts: 8, baseDelayMs: 500, maxDelayMs: 5_000, jitterRatio: 0.2 }
      },
      qdrantCollection: 'knowledge_entities_v1',
      embeddingUrl: 'http://embedding:8001', embeddingModel: 'e5', embeddingDimension: 384,
      embeddingTransport: 'json', embeddingTextVersion: 'v1',
      searchMaxLimit: 100, searchDefaultScoreThreshold: 0.55
    },
    env: { NODE_ENV: 'test' }, versions: { node: '24.0.0' }, platform: 'linux', arch: 'x64'
  })
  assert.equal(snapshot.runtime.node, '24.0.0')
  assert.equal(snapshot.app.environment, 'test')
  assert.equal(snapshot.config.qdrant.provider, 'beam')
  assert.equal(snapshot.config.qdrant.url, 'https://beam.example.test')
  assert.equal(snapshot.config.qdrant.apiKey, undefined)
  assert.equal(snapshot.config.embeddingTransport, 'json')
  assert.equal(snapshot.config.embeddingTextVersion, 'v1')
  assert.equal(JSON.stringify(snapshot).includes('super-secret'), false)
})

test('environmentSnapshot exposes consistency verification state without rejected entity details', () => {
  const snapshot = environmentSnapshot({
    config: {
      qdrant: null,
      qdrantCollection: 'knowledge_entities_qwen3_4b_text_v21',
      embeddingUrl: 'http://embedding:8001',
      embeddingModel: 'Qwen/Qwen3-Embedding-4B',
      embeddingDimension: 2560,
      embeddingTransport: 'binary-f32',
      embeddingTextVersion: 'v2.1',
      embeddingTimeoutMs: 120000,
      searchMaxLimit: 100,
      searchDefaultScoreThreshold: 0.55,
      searchConsistencyVerificationEnabled: true,
      searchConsistencyCandidateMultiplier: 5
    },
    env: { NODE_ENV: 'test' }, versions: { node: '24.0.0' }, platform: 'linux', arch: 'x64'
  })

  assert.equal(snapshot.config.searchConsistencyVerificationEnabled, true)
  assert.equal(snapshot.config.searchConsistencyCandidateMultiplier, 5)
})

test('environmentSnapshot exposes domain/entity-intent gate state without rejected payloads', () => {
  const snapshot = environmentSnapshot({
    config: {
      qdrant: null,
      qdrantCollection: 'knowledge_entities_qwen3_4b_text_v21',
      embeddingUrl: 'http://embedding:8001',
      embeddingModel: 'Qwen/Qwen3-Embedding-4B',
      embeddingDimension: 2560,
      embeddingTransport: 'binary-f32',
      embeddingTextVersion: 'v2.1',
      embeddingTimeoutMs: 120000,
      searchMaxLimit: 100,
      searchDefaultScoreThreshold: 0.55,
      searchConsistencyVerificationEnabled: true,
      searchConsistencyCandidateMultiplier: 5,
      searchDomainEntityIntentGateEnabled: true
    },
    env: { NODE_ENV: 'test' }, versions: { node: '24.0.0' }, platform: 'linux', arch: 'x64'
  })

  assert.equal(snapshot.config.searchDomainEntityIntentGateEnabled, true)
})
