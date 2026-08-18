import test from 'node:test'
import assert from 'node:assert/strict'
import { collectBenchmarkPreflight } from '../../src/evaluation/benchmark-preflight.js'

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body }, async text() { return JSON.stringify(body) } }
}

function fakeFetch(routes) {
  return async (url) => {
    if (!(url in routes)) throw new Error(`unexpected URL ${url}`)
    return routes[url]
  }
}

test('benchmark preflight records ready/info/stats and verifies real semantic embedding provenance', async () => {
  const apiUrl = 'http://api'
  const embeddingUrl = 'http://embedding'
  const fetchImpl = fakeFetch({
    [`${apiUrl}/ready`]: response({ ready: true, qdrant: { ready: true }, embedding: { ready: true } }),
    [`${apiUrl}/api/v1/info`]: response({ info: { config: { qdrantCollection: 'knowledge_entities_e5_real_v1', embeddingUrl, embeddingModel: 'intfloat/multilingual-e5-small', embeddingDimension: 384 } } }),
    [`${apiUrl}/api/v1/stats`]: response({ stats: { points_count: 20000 } }),
    [`${embeddingUrl}/model`]: response({ model: 'intfloat/multilingual-e5-small', dimension: 384, backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true })
  })

  const snapshot = await collectBenchmarkPreflight({ apiUrl, fetchImpl })
  assert.equal(snapshot.ready.ready, true)
  assert.equal(snapshot.info.config.qdrantCollection, 'knowledge_entities_e5_real_v1')
  assert.equal(snapshot.stats.points_count, 20000)
  assert.equal(snapshot.embedding.backend, 'sentence-transformers')
  assert.equal(snapshot.embedding.semantic, true)
})

test('benchmark preflight fails closed when API is not ready', async () => {
  const apiUrl = 'http://api'
  const fetchImpl = fakeFetch({
    [`${apiUrl}/ready`]: response({ ready: false, qdrant: { ready: false }, embedding: { ready: true } }, { ok: false, status: 503 })
  })
  await assert.rejects(() => collectBenchmarkPreflight({ apiUrl, fetchImpl }), /benchmark API is not ready/)
})

test('benchmark preflight rejects mock or unverified embedding runtime', async () => {
  const apiUrl = 'http://api'
  const embeddingUrl = 'http://embedding'
  const fetchImpl = fakeFetch({
    [`${apiUrl}/ready`]: response({ ready: true }),
    [`${apiUrl}/api/v1/info`]: response({ info: { config: { embeddingUrl, embeddingModel: 'intfloat/multilingual-e5-small', embeddingDimension: 384 } } }),
    [`${apiUrl}/api/v1/stats`]: response({ stats: { points_count: 20000 } }),
    [`${embeddingUrl}/model`]: response({ model: 'intfloat/multilingual-e5-small', dimension: 384, backend: 'mock-deterministic', implementation: 'node-mock', semantic: false })
  })
  await assert.rejects(() => collectBenchmarkPreflight({ apiUrl, fetchImpl }), /verified semantic embedding backend is required/)
})

test('benchmark preflight requires the expected embedding backend implementation', async () => {
  const apiUrl = 'http://api'
  const embeddingUrl = 'http://embedding'
  const fetchImpl = fakeFetch({
    [`${apiUrl}/ready`]: response({ ready: true }),
    [`${apiUrl}/api/v1/info`]: response({ info: { config: { embeddingUrl, embeddingModel: 'intfloat/multilingual-e5-small', embeddingDimension: 384 } } }),
    [`${apiUrl}/api/v1/stats`]: response({ stats: { points_count: 20000 } }),
    [`${embeddingUrl}/model`]: response({ model: 'intfloat/multilingual-e5-small', dimension: 384, backend: 'onnx-runtime', implementation: 'other-service', semantic: true })
  })
  await assert.rejects(() => collectBenchmarkPreflight({ apiUrl, fetchImpl }), /embedding backend mismatch/)
})
