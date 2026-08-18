import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiKeyPool } from '../../src/translation/key-pool.js'
import { CloudTranslationExecutor, CloudTranslationHttpError, parseRetryAfterMs } from '../../src/translation/cloud-executor.js'

const makePool = (options = {}) => new ApiKeyPool({
  provider: 'groq',
  keys: [
    { slot: 'GROQ_KEY1', secret: 'secret-one' },
    { slot: 'GROQ_KEY2', secret: 'secret-two' }
  ],
  clock: options.clock ?? (() => 1000),
  sleep: options.poolSleep ?? (async () => {}),
  defaultCooldownMs: 5000,
  maxWaitMs: 10000
})

const response = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers }
})

function requestFor(lease) {
  return {
    url: 'https://example.test/translate',
    init: { method: 'POST', headers: { authorization: `Bearer ${lease.secret()}` }, body: '{}' }
  }
}

test('CloudTranslationExecutor retries transient HTTP failures on the same API key', async () => {
  const auth = []
  const sleeps = []
  const fetchImpl = async (_url, init) => {
    auth.push(init.headers.authorization)
    return auth.length === 1 ? response(503) : response(200, { translation: 'xin chào' })
  }
  const executor = new CloudTranslationExecutor({
    provider: 'groq', keyPool: makePool(), fetchImpl,
    maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 100,
    sleep: async (ms) => sleeps.push(ms), random: () => 0.5
  })

  const result = await executor.execute({ makeRequest: requestFor, parse: async (r) => (await r.json()).translation })
  assert.equal(result.text, 'xin chào')
  assert.deepEqual(auth, ['Bearer secret-one', 'Bearer secret-one'])
  assert.deepEqual(sleeps, [100])
  assert.equal(result.keySlot, 'GROQ_KEY1')
})

test('CloudTranslationExecutor disables 401 key and rotates to the next key', async () => {
  const auth = []
  const pool = makePool()
  const executor = new CloudTranslationExecutor({
    provider: 'groq', keyPool: pool,
    fetchImpl: async (_url, init) => {
      auth.push(init.headers.authorization)
      return auth.length === 1 ? response(401) : response(200, { translation: 'ok' })
    },
    sleep: async () => {}
  })

  const result = await executor.execute({ makeRequest: requestFor, parse: async (r) => (await r.json()).translation })
  assert.equal(result.keySlot, 'GROQ_KEY2')
  assert.deepEqual(auth, ['Bearer secret-one', 'Bearer secret-two'])
  assert.equal(pool.snapshot()[0].status, 'disabled')
})

test('CloudTranslationExecutor cools 429 key using Retry-After and rotates immediately', async () => {
  let now = 1000
  const auth = []
  const pool = makePool({ clock: () => now })
  const executor = new CloudTranslationExecutor({
    provider: 'groq', keyPool: pool,
    fetchImpl: async (_url, init) => {
      auth.push(init.headers.authorization)
      return auth.length === 1 ? response(429, {}, { 'retry-after': '7' }) : response(200, { translation: 'ok' })
    },
    clock: () => now,
    sleep: async (ms) => { now += ms }
  })

  const result = await executor.execute({ makeRequest: requestFor, parse: async (r) => (await r.json()).translation })
  assert.equal(result.keySlot, 'GROQ_KEY2')
  assert.deepEqual(auth, ['Bearer secret-one', 'Bearer secret-two'])
  assert.equal(pool.snapshot()[0].cooldown_remaining_ms, 7000)
})

test('CloudTranslationExecutor fails fast on request/model errors without rotating keys', async () => {
  const auth = []
  const executor = new CloudTranslationExecutor({
    provider: 'groq', keyPool: makePool(),
    fetchImpl: async (_url, init) => { auth.push(init.headers.authorization); return response(400, { error: { message: 'bad request' } }) },
    sleep: async () => {}
  })

  await assert.rejects(
    executor.execute({ makeRequest: requestFor, parse: async () => 'never' }),
    (error) => error instanceof CloudTranslationHttpError && error.status === 400
  )
  assert.deepEqual(auth, ['Bearer secret-one'])
})

test('CloudTranslationExecutor retries network errors with the same key and redacts secrets from errors', async () => {
  let calls = 0
  const auth = []
  const executor = new CloudTranslationExecutor({
    provider: 'groq', keyPool: makePool(), maxAttempts: 2,
    fetchImpl: async (_url, init) => {
      calls += 1
      auth.push(init.headers.authorization)
      const error = new Error(`socket failed for ${init.headers.authorization}`)
      error.code = 'ECONNRESET'
      throw error
    },
    sleep: async () => {}
  })

  const error = await executor.execute({ makeRequest: requestFor, parse: async () => 'never' }).catch((value) => value)
  assert.equal(calls, 2)
  assert.deepEqual(auth, ['Bearer secret-one', 'Bearer secret-one'])
  assert.doesNotMatch(String(error), /secret-one|secret-two/)
  assert.doesNotMatch(JSON.stringify(error), /secret-one|secret-two/)
})

test('parseRetryAfterMs supports delta-seconds and HTTP-date values', () => {
  assert.equal(parseRetryAfterMs('2', 1000), 2000)
  assert.equal(parseRetryAfterMs(new Date(6000).toUTCString(), 1000), 5000)
  assert.equal(parseRetryAfterMs('invalid', 1000), null)
})
