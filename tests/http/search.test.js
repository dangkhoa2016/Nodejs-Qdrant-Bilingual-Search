import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../src/http/app.js'
import { QdrantConnectionError } from '../../src/qdrant/qdrant-connection.js'
import { SearchValidationError } from '../../src/search/search-service.js'

test('POST /api/v1/search returns stable application contract', async () => {
  const app = createApp({ searchService: { search: async () => ({ query: { text: 'hello' }, results: [], meta: { count: 0 } }) } })
  const response = await app.request('/api/v1/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'hello' }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).query.text, 'hello')
})

test('POST /api/v1/search maps domain validation to HTTP 400', async () => {
  const app = createApp({ searchService: { search: async () => { throw new SearchValidationError('query is required') } } })
  const response = await app.request('/api/v1/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: { code: 'VALIDATION_ERROR', message: 'query is required' } })
})

test('POST /api/v1/search maps exhausted Qdrant connection errors to safe HTTP 503', async () => {
  const cause = Object.assign(new Error('api-key=must-not-leak'), { status: 503 })
  const app = createApp({
    searchService: {
      search: async () => {
        throw new QdrantConnectionError({ provider: 'beam', operation: 'query', attempts: 3, retryable: true, cause })
      }
    }
  })
  const response = await app.request('/api/v1/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'hello' }) })
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.deepEqual(body, { error: { code: 'QDRANT_UNAVAILABLE', message: 'Qdrant is temporarily unavailable' } })
  assert.equal(JSON.stringify(body).includes('beam'), false)
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false)
})
