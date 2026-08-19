import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../../src/runtime/create-runtime.js'

const config = {
  qdrant: {
    provider: 'beam', url: 'https://beam.example.test', apiKey: 'secret', requestTimeoutMs: 10_000,
    requestRetry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20, jitterRatio: 0 },
    startupRetry: { maxAttempts: 5, baseDelayMs: 20, maxDelayMs: 40, jitterRatio: 0 }
  },
  qdrantCollection: 'knowledge_entities_v1',
  embeddingUrl: 'http://embedding:8001',
  embeddingModel: 'e5', embeddingDimension: 384,
  searchDefaultLimit: 10, searchMaxLimit: 100, searchDefaultScoreThreshold: 0.55
}

test('createRuntime wires one selected Qdrant connection into provider-neutral services', async () => {
  const factoryCalls = []
  const connection = {
    execute: async (_operation, fn) => fn({}),
    probe: async () => ({ ready: true, provider: 'beam', status: 'ready', http_status: null, transport_code: null, latency_ms: 1 })
  }
  const embeddingProvider = { health: async () => true, embedQuery: async () => Array(384).fill(0) }

  const runtime = await createRuntime({
    config,
    qdrantConnectionFactory: async (args) => { factoryCalls.push(args.config.qdrant.provider); return connection },
    embeddingProviderFactory: () => embeddingProvider,
    logger: { warn() {}, info() {}, error() {} }
  })

  assert.deepEqual(factoryCalls, ['beam'])
  assert.equal(runtime.qdrant.connection, connection)
  assert.equal(runtime.searchService.qdrant, runtime.qdrant)
  assert.equal(runtime.entityService.qdrant, runtime.qdrant)
  assert.deepEqual(await runtime.readiness(), {
    ready: true,
    qdrant: { ready: true, provider: 'beam', status: 'ready', http_status: null, transport_code: null, latency_ms: 1 },
    embedding: { ready: true, status: 'ready' }
  })
})


test('createRuntime propagates configured embedding request timeout', async () => {
  let embeddingOptions
  const connection = {
    execute: async (_operation, fn) => fn({}),
    probe: async () => ({ ready: true, provider: 'local', status: 'ready' })
  }
  await createRuntime({
    config: {
      ...config,
      embeddingUrl: 'https://embed.example',
      embeddingModel: 'Qwen/Qwen3-Embedding-4B',
      embeddingDimension: 2560,
      embeddingTimeoutMs: 120000,
      embeddingTransport: 'binary-f32'
    },
    qdrantConnectionFactory: async () => connection,
    embeddingProviderFactory: (options) => {
      embeddingOptions = options
      return { health: async () => true, embedQuery: async () => [], embedDocuments: async () => [] }
    },
    logger: { warn() {}, info() {}, error() {} }
  })
  assert.equal(embeddingOptions.timeoutMs, 120000)
  assert.equal(embeddingOptions.transport, 'binary-f32')
})
