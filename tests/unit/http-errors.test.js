import test from 'node:test'
import assert from 'node:assert/strict'
import { QdrantConnectionError } from '../../src/qdrant/qdrant-connection.js'
import { mapInfrastructureError } from '../../src/http/errors.js'

test('mapInfrastructureError returns stable 503 without provider or secret detail', () => {
  const cause = Object.assign(new Error('unauthorized api-key=secret'), { status: 401 })
  const error = new QdrantConnectionError({
    provider: 'modal', operation: 'query', attempts: 1, retryable: false, cause
  })

  assert.deepEqual(mapInfrastructureError(error), {
    status: 503,
    body: { error: { code: 'QDRANT_UNAVAILABLE', message: 'Qdrant is temporarily unavailable' } }
  })
  assert.equal(JSON.stringify(mapInfrastructureError(error)).includes('modal'), false)
  assert.equal(JSON.stringify(mapInfrastructureError(error)).includes('secret'), false)
})

test('mapInfrastructureError ignores non-Qdrant errors', () => {
  assert.equal(mapInfrastructureError(new Error('boom')), null)
})
