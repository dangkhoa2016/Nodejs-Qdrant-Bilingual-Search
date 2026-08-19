import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../src/http/app.js'

test('GET /health reports process liveness independently of providers', async () => {
  const response = await createApp().request('/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', service: 'nodejs-qdrant-bilingual-search' })
})

test('GET /ready passes through structured dependency state and returns 503 when not ready', async () => {
  const state = {
    ready: false,
    qdrant: { ready: false, provider: 'modal', status: 'unavailable', http_status: 503, transport_code: null, latency_ms: 12.3 },
    embedding: { ready: true, status: 'ready' }
  }
  const app = createApp({ readiness: async () => state })
  const response = await app.request('/ready')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), state)
})
