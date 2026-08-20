import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../src/http/app.js'

test('GET /api/v1/info uses an injected sanitized environment snapshot', async () => {
  const app = createApp({ info: () => ({ runtime: { node: '24.0.0' }, config: { qdrantCollection: 'test' } }) })
  const response = await app.request('/api/v1/info')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { info: { runtime: { node: '24.0.0' }, config: { qdrantCollection: 'test' } } })
})
