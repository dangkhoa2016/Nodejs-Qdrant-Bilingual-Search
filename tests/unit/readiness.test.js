import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadinessCheck } from '../../src/runtime/readiness.js'

test('readiness combines a single Qdrant probe with embedding health', async () => {
  let qdrantProbes = 0
  let embeddingProbes = 0
  const readiness = createReadinessCheck({
    qdrantConnection: {
      async probe() {
        qdrantProbes += 1
        return { ready: false, provider: 'modal', status: 'unavailable', http_status: 503, transport_code: null, latency_ms: 12 }
      }
    },
    embeddingProvider: {
      async health() { embeddingProbes += 1; return true }
    }
  })

  assert.deepEqual(await readiness(), {
    ready: false,
    qdrant: { ready: false, provider: 'modal', status: 'unavailable', http_status: 503, transport_code: null, latency_ms: 12 },
    embedding: { ready: true, status: 'ready' }
  })
  assert.equal(qdrantProbes, 1)
  assert.equal(embeddingProbes, 1)
})

test('readiness converts embedding transport failures to unavailable without throwing', async () => {
  const readiness = createReadinessCheck({
    qdrantConnection: { probe: async () => ({ ready: true, provider: 'beam', status: 'ready', http_status: null, transport_code: null, latency_ms: 2 }) },
    embeddingProvider: { health: async () => { throw new Error('offline') } }
  })

  const state = await readiness()
  assert.equal(state.ready, false)
  assert.equal(state.qdrant.ready, true)
  assert.deepEqual(state.embedding, { ready: false, status: 'unavailable' })
})
