import test from 'node:test'
import assert from 'node:assert/strict'
import { EmbeddingServiceError, HttpEmbeddingProvider, MockEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
})

test('embedQuery posts normalized text and validates dimension', async () => {
  let request
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed/', model: 'test', dimension: 3,
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ vector: [0.1, 0.2, 0.3] })
    }
  })
  assert.deepEqual(await provider.embedQuery('  xin chào  '), [0.1, 0.2, 0.3])
  assert.equal(request.url, 'http://embed/embed/query')
  assert.deepEqual(JSON.parse(request.init.body), { text: 'xin chào' })
})

test('embedDocuments requires one vector per input', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2,
    fetchImpl: async () => jsonResponse({ vectors: [[1, 0]] })
  })
  await assert.rejects(() => provider.embedDocuments(['a', 'b']), EmbeddingServiceError)
})

test('HTTP errors become stable EmbeddingServiceError', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2,
    fetchImpl: async () => jsonResponse({ error: 'down' }, 503)
  })
  await assert.rejects(() => provider.embedQuery('hello'), /HTTP 503/)
})

test('MockEmbeddingProvider preserves E5 query/passage distinction', async () => {
  const seen = []
  const provider = new MockEmbeddingProvider({ dimension: 1, vectorFor: (text) => { seen.push(text); return [1] } })
  await provider.embedQuery('hello')
  await provider.embedDocuments(['world'])
  assert.deepEqual(seen, ['query: hello', 'passage: world'])
})

test('assertCompatible fails closed when embedding service model or dimension differs', async () => {
  const responses = [
    jsonResponse({ model: 'other-model', dimension: 3 }),
    jsonResponse({ model: 'test', dimension: 4 })
  ]
  for (const response of responses) {
    const provider = new HttpEmbeddingProvider({
      baseUrl: 'http://embed', model: 'test', dimension: 3,
      fetchImpl: async () => response.clone()
    })
    await assert.rejects(() => provider.assertCompatible(), /Embedding service (model|dimension) mismatch/)
  }
})

test('assertCompatible returns verified embedding service identity', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 3,
    fetchImpl: async (url) => {
      assert.equal(url, 'http://embed/model')
      return jsonResponse({ model: 'test', dimension: 3, query_prefix: 'query:', document_prefix: 'passage:' })
    }
  })
  assert.deepEqual(await provider.assertCompatible(), { model: 'test', dimension: 3 })
})

test('assertCompatible returns runtime provenance advertised by the embedding service', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 3,
    fetchImpl: async () => jsonResponse({
      model: 'test', dimension: 3,
      backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true
    })
  })
  assert.deepEqual(await provider.assertCompatible(), {
    model: 'test', dimension: 3,
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true
  })
})


test('assertCompatible preserves extended GPU and query-profile provenance', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'Qwen/Qwen3-Embedding-4B', dimension: 2560,
    fetchImpl: async () => jsonResponse({
      model: 'Qwen/Qwen3-Embedding-4B', dimension: 2560,
      backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
      accelerator: 'gpu', device: 'cuda', dtype: 'float16', runtime: 'pytorch-cuda',
      profile: 'qwen3', query_strategy: 'prompt', query_instruction_id: 'geo-retrieval-v1:abc',
      document_strategy: 'raw'
    })
  })
  assert.deepEqual(await provider.assertCompatible(), {
    model: 'Qwen/Qwen3-Embedding-4B', dimension: 2560,
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
    accelerator: 'gpu', device: 'cuda', dtype: 'float16', runtime: 'pytorch-cuda',
    profile: 'qwen3', query_strategy: 'prompt', query_instruction_id: 'geo-retrieval-v1:abc',
    document_strategy: 'raw'
  })
})

const binaryResponse = (values, { count, dimension, inferenceMs = 12.5, status = 200 } = {}) => {
  const body = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => body.writeFloatLE(value, index * 4))
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/x-float32',
      'x-embedding-count': String(count),
      'x-embedding-dimension': String(dimension),
      'x-embedding-dtype': 'float32',
      'x-embedding-inference-ms': String(inferenceMs)
    }
  })
}

test('binary-f32 document transport posts to binary endpoint and decodes row-major float32', async () => {
  let request
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2, transport: 'binary-f32',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return binaryResponse([1.5, -2.25, 3, 4.5], { count: 2, dimension: 2 })
    }
  })

  assert.deepEqual(await provider.embedDocuments([' a ', 'b']), [[1.5, -2.25], [3, 4.5]])
  assert.equal(request.url, 'http://embed/embed/documents/binary')
  assert.equal(request.init.headers.accept, 'application/x-float32')
  assert.deepEqual(JSON.parse(request.init.body), { texts: ['a', 'b'] })
})

test('binary-f32 compatibility preflight fails closed when server does not advertise binary capability', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2, transport: 'binary-f32',
    fetchImpl: async () => jsonResponse({
      model: 'test', dimension: 2,
      transports: { json: true, float32_binary: false }
    })
  })
  await assert.rejects(() => provider.assertCompatible(), /binary-f32 transport/i)
})

test('binary-f32 compatibility preflight accepts advertised capability without changing semantic identity', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2, transport: 'binary-f32',
    fetchImpl: async () => jsonResponse({
      model: 'test', dimension: 2,
      backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
      transports: { json: true, float32_binary: true }
    })
  })
  assert.deepEqual(await provider.assertCompatible(), {
    model: 'test', dimension: 2,
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true
  })
})

test('embedDocumentsDetailed reports binary server inference and transfer overhead', async () => {
  const ticks = [100, 140]
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2, transport: 'binary-f32',
    clock: () => ticks.shift(),
    fetchImpl: async () => binaryResponse([1, 2, 3, 4], { count: 2, dimension: 2, inferenceMs: 12.5 })
  })
  const result = await provider.embedDocumentsDetailed(['a', 'b'])
  assert.deepEqual(result.vectors, [[1, 2], [3, 4]])
  assert.deepEqual(result.metrics, {
    transport: 'binary-f32',
    serverInferenceMs: 12.5,
    httpRoundTripMs: 40,
    transferOverheadMs: 27.5
  })
})

test('embedDocumentsDetailed reports JSON server inference and preserves JSON compatibility', async () => {
  const ticks = [10, 40]
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2,
    clock: () => ticks.shift(),
    fetchImpl: async (url) => {
      assert.equal(url, 'http://embed/embed/documents')
      return jsonResponse({ vectors: [[1, 0]], inference_ms: 15 })
    }
  })
  const result = await provider.embedDocumentsDetailed(['a'])
  assert.deepEqual(result.vectors, [[1, 0]])
  assert.deepEqual(result.metrics, {
    transport: 'json',
    serverInferenceMs: 15,
    httpRoundTripMs: 30,
    transferOverheadMs: 15
  })
})

test('document request timeout stays armed until the response body is consumed', async () => {
  let signalSeenDuringBody
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2, timeoutMs: 5,
    fetchImpl: async (_url, init) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
        signalSeenDuringBody = init.signal.aborted
        return { vectors: [[1, 0]], inference_ms: 1 }
      }
    })
  })
  await provider.embedDocumentsDetailed(['a'])
  assert.equal(signalSeenDuringBody, true)
})

test('binary-f32 document transport rejects non-finite vector values', async () => {
  const provider = new HttpEmbeddingProvider({
    baseUrl: 'http://embed', model: 'test', dimension: 2, transport: 'binary-f32',
    fetchImpl: async () => binaryResponse([1, Number.NaN], { count: 1, dimension: 2 })
  })
  await assert.rejects(() => provider.embedDocuments(['a']), /numeric vector|finite/i)
})
