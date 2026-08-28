import test from 'node:test'
import assert from 'node:assert/strict'
import { QdrantService } from '../../src/qdrant/qdrant-service.js'

function fakeConnection(client, operations = []) {
  return {
    async execute(operation, fn) {
      operations.push(operation)
      return fn(client)
    },
    async probe() { return { ready: true, provider: 'local', status: 'ready' } }
  }
}

test('QdrantService requires the provider-neutral connection boundary', () => {
  assert.throws(() => new QdrantService({ collection: 'c', dimension: 3 }), /connection/)
})

test('ensureCollection creates cosine collection and indexes through connection.execute', async () => {
  const calls = []
  const operations = []
  const client = {
    getCollections: async () => ({ collections: [] }),
    createCollection: async (...args) => calls.push(['collection', ...args]),
    createPayloadIndex: async (...args) => calls.push(['index', ...args]),
    getCollection: async () => ({
      config: { params: { vectors: { size: 384, distance: 'Cosine' } } },
      payload_schema: Object.fromEntries(['type', 'continent', 'region', 'country_code', 'source', 'index_fingerprint'].map((key) => [key, { data_type: 'keyword' }]).concat([['population', { data_type: 'integer' }]]))
    })
  }
  await new QdrantService({ connection: fakeConnection(client, operations), collection: 'knowledge_entities_v1', dimension: 384 }).ensureCollection()
  assert.deepEqual(calls[0], ['collection', 'knowledge_entities_v1', { vectors: { size: 384, distance: 'Cosine' } }])
  assert.equal(calls.filter(([kind]) => kind === 'index').length, 7)
  assert.deepEqual(operations, [
    'getCollections', 'createCollection', 'getCollection:schema',
    'createPayloadIndex:type', 'createPayloadIndex:continent', 'createPayloadIndex:region',
    'createPayloadIndex:country_code', 'createPayloadIndex:source', 'createPayloadIndex:population',
    'createPayloadIndex:index_fingerprint', 'getCollection:indexes'
  ])
})

test('ensureCollection tolerates already-created collection and payload indexes after retry races', async () => {
  const exists = (message) => Object.assign(new Error(message), { status: 409 })
  const client = {
    getCollections: async () => ({ collections: [] }),
    createCollection: async () => { throw exists('collection already exists') },
    createPayloadIndex: async () => { throw exists('payload field already indexed') },
    getCollection: async () => ({
      config: { params: { vectors: { size: 3, distance: 'Cosine' } } },
      payload_schema: Object.fromEntries(['type', 'continent', 'region', 'country_code', 'source', 'index_fingerprint'].map((key) => [key, { data_type: 'keyword' }]).concat([['population', { data_type: 'integer' }]]))
    })
  }
  const connection = {
    async execute(_operation, fn) {
      try { return await fn(client) }
      catch (cause) {
        const wrapped = new Error('connection wrapper')
        wrapped.cause = cause
        throw wrapped
      }
    },
    async probe() { return { ready: true } }
  }
  await assert.doesNotReject(() => new QdrantService({ connection, collection: 'c', dimension: 3 }).ensureCollection())
})

test('querySemantic uses Qdrant Query API with payload but no vectors through connection.execute', async () => {
  let request
  const operations = []
  const client = { query: async (...args) => { request = args; return { points: [{ id: 1, score: 0.9 }] } } }
  const service = new QdrantService({ connection: fakeConnection(client, operations), collection: 'c', dimension: 3 })
  const result = await service.querySemantic({ vector: [1, 0, 0], filter: { must: [] }, limit: 5, scoreThreshold: 0.5 })
  assert.equal(result[0].score, 0.9)
  assert.deepEqual(request, ['c', { query: [1, 0, 0], filter: { must: [] }, limit: 5, score_threshold: 0.5, with_payload: true, with_vector: false }])
  assert.deepEqual(operations, ['query'])
})

test('health delegates to the connection probe without provider branching', async () => {
  const connection = { execute: async () => {}, probe: async () => ({ ready: false, provider: 'beam', status: 'unavailable' }) }
  const service = new QdrantService({ connection, collection: 'c', dimension: 3 })
  assert.equal(await service.health(), false)
})


test('ensureCollection rejects an existing collection with incompatible vector schema', async () => {
  const client = {
    getCollections: async () => ({ collections: [{ name: 'c' }] }),
    getCollection: async () => ({ config: { params: { vectors: { size: 768, distance: 'Cosine' } } } }),
    createPayloadIndex: async () => {}
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 384 })
  await assert.rejects(() => service.ensureCollection(), /vector size mismatch/)
})

test('ensureCollection rejects an existing collection with incompatible distance metric', async () => {
  const client = {
    getCollections: async () => ({ collections: [{ name: 'c' }] }),
    getCollection: async () => ({ config: { params: { vectors: { size: 384, distance: 'Dot' } } } }),
    createPayloadIndex: async () => {}
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 384 })
  await assert.rejects(() => service.ensureCollection(), /distance mismatch/)
})

test('ensureCollection validates payload index data types after creation', async () => {
  const payloadSchema = Object.fromEntries(['type', 'continent', 'region', 'country_code', 'source', 'index_fingerprint'].map((key) => [key, { data_type: 'keyword' }]).concat([['population', { data_type: 'float' }]]))
  const client = {
    getCollections: async () => ({ collections: [{ name: 'c' }] }),
    getCollection: async () => ({ config: { params: { vectors: { size: 3, distance: 'Cosine' } } }, payload_schema: payloadSchema }),
    createPayloadIndex: async () => { throw new Error('already indexed') }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  await assert.rejects(() => service.ensureCollection(), /payload index population type mismatch/)
})

test('preflightSeed uses exact point counts instead of collection statistics', async () => {
  const requests = []
  const client = {
    getCollection: async () => ({ points_count: 0 }),
    count: async (_collection, request) => {
      requests.push(request)
      return { count: request.filter ? 1 : 1 }
    }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  const state = await service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 })
  assert.equal(state.mode, 'resume')
  assert.deepEqual(requests, [
    { exact: true },
    { exact: true, filter: { must: [{ key: 'index_fingerprint', match: { value: 'sha256:a' } }] } }
  ])
})

test('preflightSeed accepts empty, resumable, and exact idempotent states but rejects foreign points', async () => {
  let pointsCount = 0
  let matchingCount = 0
  const client = {
    count: async (_collection, request) => ({ count: request.filter ? matchingCount : pointsCount })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  assert.equal((await service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 })).mode, 'fresh')
  pointsCount = 1; matchingCount = 1
  assert.equal((await service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 })).mode, 'resume')
  pointsCount = 3; matchingCount = 3
  assert.equal((await service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 })).mode, 'idempotent')
  pointsCount = 3; matchingCount = 2
  await assert.rejects(() => service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 }), /different dataset or embedding configuration/)
})

test('verifySeed requires exact total and fingerprint-matching point counts', async () => {
  let pointsCount = 3
  let matchingCount = 3
  const client = {
    count: async (_collection, request) => ({ count: request.filter ? matchingCount : pointsCount })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  assert.deepEqual(await service.verifySeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 }), { pointsCount: 3, matchingCount: 3 })
  pointsCount = 4; matchingCount = 3
  await assert.rejects(() => service.verifySeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 }), /expected exactly 3 points/)
})

test('preflightSeed falls back to bounded scroll when Qdrant strict mode disables exact count', async () => {
  const requests = []
  const exactDisabled = new Error('connection wrapper')
  exactDisabled.cause = {
    message: 'Bad Request',
    data: { status: { error: 'Bad request: Exact search disabled!. Help: Set exact=false.' } }
  }
  const pages = [
    {
      points: [
        { id: '1', payload: { index_fingerprint: 'sha256:a' } },
        { id: '2', payload: { index_fingerprint: 'sha256:a' } }
      ],
      next_page_offset: '2'
    },
    {
      points: [{ id: '3', payload: { index_fingerprint: 'sha256:a' } }],
      next_page_offset: null
    }
  ]
  const client = {
    count: async () => { throw exactDisabled },
    scroll: async (_collection, request) => {
      requests.push(request)
      return pages.shift()
    }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  const state = await service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 3 })
  assert.equal(state.mode, 'idempotent')
  assert.equal(state.pointsCount, 3)
  assert.equal(state.matchingCount, 3)
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0], {
    limit: 256,
    with_payload: ['index_fingerprint'],
    with_vector: false
  })
  assert.deepEqual(requests[1], {
    limit: 256,
    with_payload: ['index_fingerprint'],
    with_vector: false,
    offset: '2'
  })
})

test('scroll fallback remains fail-closed when a point has a foreign fingerprint', async () => {
  const exactDisabled = new Error('Bad Request')
  exactDisabled.data = { status: { error: 'Exact search disabled!. Help: Set exact=false.' } }
  const client = {
    count: async () => { throw exactDisabled },
    scroll: async () => ({
      points: [
        { id: '1', payload: { index_fingerprint: 'sha256:a' } },
        { id: '2', payload: { index_fingerprint: 'sha256:foreign' } }
      ],
      next_page_offset: null
    })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  await assert.rejects(
    () => service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 2 }),
    /different dataset or embedding configuration/
  )
})

test('seed count does not hide unrelated Qdrant count errors behind scroll fallback', async () => {
  let scrollCalls = 0
  const client = {
    count: async () => {
      const error = new Error('Bad Request')
      error.data = { status: { error: 'Bad request: malformed filter' } }
      throw error
    },
    scroll: async () => { scrollCalls += 1; return { points: [], next_page_offset: null } }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  await assert.rejects(() => service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 2 }), /Bad Request/)
  assert.equal(scrollCalls, 0)
})

test('ensureCollection respects strict max_query_limit for seed-state scroll fallback', async () => {
  const exactDisabled = new Error('Exact search disabled')
  exactDisabled.data = { status: { error: 'Exact search disabled!. Help: Set exact=false.' } }
  const scrollRequests = []
  const payloadSchema = Object.fromEntries(
    ['type', 'continent', 'region', 'country_code', 'source', 'index_fingerprint']
      .map((key) => [key, { data_type: 'keyword' }])
      .concat([['population', { data_type: 'integer' }]])
  )
  const client = {
    getCollections: async () => ({ collections: [{ name: 'c' }] }),
    getCollection: async () => ({
      config: {
        params: { vectors: { size: 3, distance: 'Cosine' } },
        strict_mode_config: { enabled: true, search_allow_exact: false, max_query_limit: 17 }
      },
      payload_schema: payloadSchema
    }),
    createPayloadIndex: async () => { throw new Error('already indexed') },
    count: async () => { throw exactDisabled },
    scroll: async (_collection, request) => {
      scrollRequests.push(request)
      return { points: [], next_page_offset: null }
    }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 3 })
  await service.ensureCollection()
  await service.preflightSeed({ indexFingerprint: 'sha256:a', expectedPoints: 1 })
  assert.equal(scrollRequests.length, 1)
  assert.equal(scrollRequests[0].limit, 17)
})

test('verifyEmbeddingRuntime audits every point provenance without loading vectors', async () => {
  const requests = []
  const pages = [
    {
      points: [
        { id: '1', payload: { embedding_backend: 'sentence-transformers', embedding_implementation: 'python-fastapi', embedding_semantic: true } },
        { id: '2', payload: { embedding_backend: 'sentence-transformers', embedding_implementation: 'python-fastapi', embedding_semantic: true } }
      ],
      next_page_offset: '2'
    },
    {
      points: [
        { id: '3', payload: { embedding_backend: 'sentence-transformers', embedding_implementation: 'python-fastapi', embedding_semantic: true } }
      ],
      next_page_offset: null
    }
  ]
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async (_collection, request) => { requests.push(request); return pages.shift() }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 384 })
  const result = await service.verifyEmbeddingRuntime({
    expectedPoints: 3,
    runtime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true }
  })
  assert.deepEqual(result, {
    pointsCount: 3,
    matchingCount: 3,
    runtime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true }
  })
  assert.deepEqual(requests[0], {
    limit: 256,
    with_payload: ['embedding_backend', 'embedding_implementation', 'embedding_semantic'],
    with_vector: false
  })
})

test('verifyEmbeddingRuntime rejects legacy or mixed provenance collections', async () => {
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async () => ({
      points: [
        { id: '1', payload: {} },
        { id: '2', payload: { embedding_backend: 'mock-deterministic', embedding_implementation: 'node-mock', embedding_semantic: false } }
      ],
      next_page_offset: null
    })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 384 })
  await assert.rejects(() => service.verifyEmbeddingRuntime({
    expectedPoints: 2,
    runtime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true }
  }), /embedding runtime provenance verification failed/)
})

test('verifyEmbeddingRuntime honors strict max_query_limit without mutating collection schema', async () => {
  const operations = []
  const requests = []
  const client = {
    getCollection: async () => ({ config: { strict_mode_config: { enabled: true, max_query_limit: 17 } } }),
    scroll: async (_collection, request) => { requests.push(request); return { points: [], next_page_offset: null } }
  }
  const service = new QdrantService({ connection: fakeConnection(client, operations), collection: 'c', dimension: 384 })
  await assert.rejects(() => service.verifyEmbeddingRuntime({
    expectedPoints: 1,
    runtime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true }
  }), /expected exactly 1 points/)
  assert.equal(requests[0].limit, 17)
  assert.deepEqual(operations, ['getCollection:embedding-runtime-audit', 'scroll:embedding-runtime'])
})

test('verifyEmbeddingRuntime audits extended provenance fields when the runtime declares them', async () => {
  const requestLog = []
  const payload = {
    embedding_backend: 'sentence-transformers',
    embedding_implementation: 'python-fastapi',
    embedding_semantic: true,
    embedding_accelerator: 'gpu',
    embedding_device: 'cuda',
    embedding_dtype: 'float16',
    embedding_runtime: 'pytorch-cuda',
    embedding_profile: 'qwen3',
    embedding_query_strategy: 'prompt',
    embedding_query_instruction_id: 'geo-retrieval-v1:abc',
    embedding_document_strategy: 'raw'
  }
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async (_collection, request) => {
      requestLog.push(request)
      return { points: [{ id: '1', payload }], next_page_offset: null }
    }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 2560 })
  const runtime = {
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
    accelerator: 'gpu', device: 'cuda', dtype: 'float16', runtime: 'pytorch-cuda',
    profile: 'qwen3', query_strategy: 'prompt', query_instruction_id: 'geo-retrieval-v1:abc',
    document_strategy: 'raw'
  }
  const result = await service.verifyEmbeddingRuntime({ expectedPoints: 1, runtime })
  assert.deepEqual(result, { pointsCount: 1, matchingCount: 1, runtime })
  assert.deepEqual(requestLog[0].with_payload, [
    'embedding_backend', 'embedding_implementation', 'embedding_semantic',
    'embedding_accelerator', 'embedding_device', 'embedding_dtype', 'embedding_runtime',
    'embedding_profile', 'embedding_query_strategy', 'embedding_query_instruction_id',
    'embedding_document_strategy'
  ])
})

test('verifyEmbeddingRuntime rejects execution provenance mismatch when full runtime is passed (CPU/float32 vs GPU/float16)', async () => {
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async () => ({
      points: [{
        id: '1',
        payload: {
          embedding_backend: 'sentence-transformers', embedding_implementation: 'python-fastapi', embedding_semantic: true,
          embedding_accelerator: 'gpu', embedding_device: 'cuda', embedding_dtype: 'float16', embedding_runtime: 'pytorch-cuda'
        }
      }],
      next_page_offset: null
    })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 2560 })
  await assert.rejects(() => service.verifyEmbeddingRuntime({
    expectedPoints: 1,
    runtime: {
      backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
      accelerator: 'cpu', device: 'cpu', dtype: 'float32', runtime: 'pytorch-cpu'
    }
  }), /embedding runtime provenance verification failed/)
})

test('verifyEmbeddingRuntime rejects a mismatched extended Qwen provenance field', async () => {
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async () => ({
      points: [{
        id: '1',
        payload: {
          embedding_backend: 'sentence-transformers', embedding_implementation: 'python-fastapi', embedding_semantic: true,
          embedding_profile: 'qwen3', embedding_query_instruction_id: 'geo-retrieval-v1:other'
        }
      }],
      next_page_offset: null
    })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 2560 })
  await assert.rejects(() => service.verifyEmbeddingRuntime({
    expectedPoints: 1,
    runtime: {
      backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
      profile: 'qwen3', query_instruction_id: 'geo-retrieval-v1:expected'
    }
  }), /embedding runtime provenance verification failed/)
})

test('verifyEmbeddingRuntime can require model and embedding text version provenance for shadow validation', async () => {
  const requests = []
  const payload = {
    embedding_backend: 'sentence-transformers',
    embedding_implementation: 'python-fastapi',
    embedding_semantic: true,
    embedding_model: 'Qwen/Qwen3-Embedding-4B',
    embedding_text_version: 'v2.1'
  }
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async (_collection, request) => {
      requests.push(request)
      return { points: [{ id: '1', payload }], next_page_offset: null }
    }
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 2560 })
  const result = await service.verifyEmbeddingRuntime({
    expectedPoints: 1,
    runtime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true },
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingTextVersion: 'v2.1'
  })
  assert.equal(result.matchingCount, 1)
  assert.equal(result.embeddingModel, 'Qwen/Qwen3-Embedding-4B')
  assert.equal(result.embeddingTextVersion, 'v2.1')
  assert.deepEqual(requests[0].with_payload, [
    'embedding_backend', 'embedding_implementation', 'embedding_semantic',
    'embedding_model', 'embedding_text_version'
  ])
})

test('verifyEmbeddingRuntime rejects a mismatched embedding text version during shadow validation', async () => {
  const client = {
    getCollection: async () => ({ config: {} }),
    scroll: async () => ({
      points: [{ id: '1', payload: {
        embedding_backend: 'sentence-transformers', embedding_implementation: 'python-fastapi', embedding_semantic: true,
        embedding_model: 'Qwen/Qwen3-Embedding-4B', embedding_text_version: 'v1'
      } }],
      next_page_offset: null
    })
  }
  const service = new QdrantService({ connection: fakeConnection(client), collection: 'c', dimension: 2560 })
  await assert.rejects(() => service.verifyEmbeddingRuntime({
    expectedPoints: 1,
    runtime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true },
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingTextVersion: 'v2.1'
  }), /embedding runtime provenance verification failed/)
})
