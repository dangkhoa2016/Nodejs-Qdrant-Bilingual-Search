import test from 'node:test'
import assert from 'node:assert/strict'
import {
  QdrantConnection,
  QdrantConnectionError,
  isRetryableQdrantError,
  retryDelayMs
} from '../../src/qdrant/qdrant-connection.js'

const retry = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0 }
const startupRetry = { maxAttempts: 4, baseDelayMs: 200, maxDelayMs: 1_000, jitterRatio: 0 }
const quietLogger = { warn() {}, info() {}, error() {} }

function connection(client, overrides = {}) {
  return new QdrantConnection({
    client,
    provider: 'modal',
    url: 'https://modal.example.test',
    requestRetry: retry,
    startupRetry,
    sleep: async () => {},
    random: () => 0.5,
    clock: () => 10,
    logger: quietLogger,
    ...overrides
  })
}

test('isRetryableQdrantError distinguishes transient provider/network failures from auth', () => {
  assert.equal(isRetryableQdrantError({ status: 503 }), true)
  assert.equal(isRetryableQdrantError({ response: { status: 429 } }), true)
  assert.equal(isRetryableQdrantError({ cause: { code: 'ECONNRESET' } }), true)
  assert.equal(isRetryableQdrantError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), true)
  assert.equal(isRetryableQdrantError({ name: 'QdrantClientTimeoutError', message: 'Request timed out' }), true)
  assert.equal(isRetryableQdrantError({ name: 'QdrantClientResourceExhaustedError', message: 'rate limited' }), true)
  assert.equal(isRetryableQdrantError({ status: 401 }), false)
  assert.equal(isRetryableQdrantError({ status: 403 }), false)
  assert.equal(isRetryableQdrantError({ status: 400 }), false)
})

test('retryDelayMs applies capped exponential backoff deterministically', () => {
  assert.equal(retryDelayMs(1, retry, () => 0.5), 100)
  assert.equal(retryDelayMs(2, retry, () => 0.5), 200)
  assert.equal(retryDelayMs(4, retry, () => 0.5), 500)
  assert.equal(retryDelayMs(1, { ...retry, jitterRatio: 0.2 }, () => 0), 80)
  assert.equal(retryDelayMs(1, { ...retry, jitterRatio: 0.2 }, () => 1), 120)
})

test('execute retries transient 503 against the selected provider and then succeeds', async () => {
  let calls = 0
  const delays = []
  const selectedClient = { marker: 'selected-modal-client' }
  const qdrant = connection(selectedClient, { sleep: async (ms) => delays.push(ms) })

  const result = await qdrant.execute('query', async (client) => {
    assert.equal(client, selectedClient)
    calls += 1
    if (calls < 3) throw Object.assign(new Error('cold start'), { status: 503 })
    return 'ok'
  })

  assert.equal(result, 'ok')
  assert.equal(calls, 3)
  assert.deepEqual(delays, [100, 200])
})

test('execute stops immediately on 401 instead of retrying credentials', async () => {
  let calls = 0
  const qdrant = connection({})

  await assert.rejects(
    qdrant.execute('getCollections', async () => {
      calls += 1
      throw Object.assign(new Error('unauthorized'), { status: 401 })
    }),
    (error) => {
      assert.ok(error instanceof QdrantConnectionError)
      assert.equal(error.code, 'QDRANT_UNAVAILABLE')
      assert.equal(error.provider, 'modal')
      assert.equal(error.httpStatus, 401)
      assert.equal(error.attempts, 1)
      assert.equal(error.retryable, false)
      return true
    }
  )
  assert.equal(calls, 1)
})

test('execute reports exhausted transient retry budget without leaking endpoint credentials', async () => {
  const delays = []
  const qdrant = connection({}, { sleep: async (ms) => delays.push(ms) })

  await assert.rejects(
    qdrant.execute('query', async () => { throw Object.assign(new Error('router unavailable'), { status: 503 }) }),
    (error) => {
      assert.ok(error instanceof QdrantConnectionError)
      assert.equal(error.attempts, 3)
      assert.equal(error.httpStatus, 503)
      assert.equal(error.retryable, true)
      assert.equal(error.operation, 'query')
      assert.equal(String(error).includes('apiKey'), false)
      return true
    }
  )
  assert.deepEqual(delays, [100, 200])
})

test('probe maps authenticated readiness, transient unavailability and auth failures without retry sleep', async () => {
  let mode = 'ready'
  const qdrant = connection({
    async getCollections() {
      if (mode === '503') throw Object.assign(new Error('cold'), { status: 503 })
      if (mode === '401') throw Object.assign(new Error('auth'), { status: 401 })
      return { collections: [] }
    }
  })

  assert.deepEqual(await qdrant.probe(), {
    ready: true, provider: 'modal', status: 'ready', http_status: null, transport_code: null, latency_ms: 0
  })
  mode = '503'
  assert.deepEqual(await qdrant.probe(), {
    ready: false, provider: 'modal', status: 'unavailable', http_status: 503, transport_code: null, latency_ms: 0
  })
  mode = '401'
  assert.deepEqual(await qdrant.probe(), {
    ready: false, provider: 'modal', status: 'unauthorized', http_status: 401, transport_code: null, latency_ms: 0
  })
})

test('waitUntilReady uses startup retry policy but never changes provider', async () => {
  let calls = 0
  const delays = []
  const selectedClient = {
    async getCollections() {
      calls += 1
      if (calls < 4) throw Object.assign(new Error('warming'), { status: 503 })
      return { collections: [] }
    }
  }
  const qdrant = connection(selectedClient, { sleep: async (ms) => delays.push(ms) })

  const state = await qdrant.waitUntilReady()
  assert.equal(state.ready, true)
  assert.equal(state.provider, 'modal')
  assert.equal(calls, 4)
  assert.deepEqual(delays, [200, 400, 800])
})
