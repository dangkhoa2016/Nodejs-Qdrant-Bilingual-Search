import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../src/http/app.js'

test('GET /openapi.json returns OpenAPI 3.1 metadata', async () => {
  const response = await createApp().request('/openapi.json')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.openapi, '3.1.0')
  assert.ok(body.paths['/api/v1/search'])
})

test('GET /docs returns a small dependency-free documentation page', async () => {
  const response = await createApp().request('/docs')
  assert.equal(response.status, 200)
  assert.match(await response.text(), /\/openapi\.json/)
})
