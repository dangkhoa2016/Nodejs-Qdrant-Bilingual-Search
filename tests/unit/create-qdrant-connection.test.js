import test from 'node:test'
import assert from 'node:assert/strict'
import { createQdrantConnection } from '../../src/qdrant/create-qdrant-connection.js'

const quietLogger = { warn() {}, info() {}, error() {} }

function config(provider = 'beam') {
  return {
    qdrant: {
      provider,
      url: `https://${provider}.example.test`,
      apiKey: `${provider}-secret`,
      requestTimeoutMs: 12_345,
      requestRetry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20, jitterRatio: 0 },
      startupRetry: { maxAttempts: 5, baseDelayMs: 20, maxDelayMs: 40, jitterRatio: 0 }
    }
  }
}

test('createQdrantConnection constructs SDK client only for the selected provider profile', () => {
  const calls = []
  class FakeClient {
    constructor(options) {
      calls.push(options)
      this.options = options
    }
  }

  const connection = createQdrantConnection({ config: config('beam'), ClientClass: FakeClient, logger: quietLogger })

  assert.equal(connection.provider, 'beam')
  assert.equal(connection.url, 'https://beam.example.test')
  assert.equal(connection.client, undefined)
  assert.deepEqual(calls, [{ url: 'https://beam.example.test', apiKey: 'beam-secret', timeout: 12_345 }])
})

test('createQdrantConnection does not retain alternative provider endpoints or credentials', () => {
  class FakeClient { constructor(options) { this.options = options } }
  const selected = config('modal')
  selected.qdrant.beamUrl = 'https://beam-should-never-be-used.example.test'
  selected.qdrant.beamApiKey = 'other-secret'

  const connection = createQdrantConnection({ config: selected, ClientClass: FakeClient, logger: quietLogger })

  assert.deepEqual(connection.metadata(), { provider: 'modal', url: 'https://modal.example.test' })
  assert.equal(JSON.stringify(connection).includes('beam-should-never-be-used'), false)
  assert.equal(JSON.stringify(connection).includes('other-secret'), false)
})

test('createQdrantConnection validates required construction inputs', () => {
  class FakeClient {}
  assert.throws(() => createQdrantConnection({ config: {}, ClientClass: FakeClient }), /config\.qdrant/)
  assert.throws(() => createQdrantConnection({ config: config(), ClientClass: null }), /ClientClass/)
})
