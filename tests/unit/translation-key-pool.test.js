import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiKeyPool, ApiKeyPoolExhaustedError, ApiKeyPoolCoolingError } from '../../src/translation/key-pool.js'

const keys = [
  { slot: 'GROQ_KEY1', secret: 'secret-one' },
  { slot: 'GROQ_KEY3', secret: 'secret-three' },
  { slot: 'GROQ_KEY8', secret: 'secret-eight' }
]

test('ApiKeyPool rotates ready keys round-robin without exposing secrets in snapshots', async () => {
  const pool = new ApiKeyPool({ provider: 'groq', keys, clock: () => 1000 })
  const a = await pool.acquire({ allowWait: false })
  const b = await pool.acquire({ allowWait: false })
  const c = await pool.acquire({ allowWait: false })
  const d = await pool.acquire({ allowWait: false })

  assert.deepEqual([a.slot, b.slot, c.slot, d.slot], ['GROQ_KEY1', 'GROQ_KEY3', 'GROQ_KEY8', 'GROQ_KEY1'])
  assert.equal(a.secret(), 'secret-one')
  const serialized = JSON.stringify(pool.snapshot())
  assert.doesNotMatch(serialized, /secret-one|secret-three|secret-eight/)
})

test('ApiKeyPool disables only the key that fails authentication', async () => {
  const pool = new ApiKeyPool({ provider: 'groq', keys, clock: () => 1000 })
  const first = await pool.acquire({ allowWait: false })
  pool.disable(first, 'authentication_failed')

  const second = await pool.acquire({ allowWait: false })
  assert.equal(second.slot, 'GROQ_KEY3')
  assert.equal(pool.snapshot().find((entry) => entry.slot === 'GROQ_KEY1').status, 'disabled')
})

test('ApiKeyPool cools rate-limited key and uses another ready key', async () => {
  let now = 1000
  const pool = new ApiKeyPool({ provider: 'nvidia', keys, clock: () => now, defaultCooldownMs: 5000 })
  const first = await pool.acquire({ allowWait: false })
  pool.cooldown(first, 7000)

  const second = await pool.acquire({ allowWait: false })
  assert.equal(second.slot, 'GROQ_KEY3')
  assert.equal(pool.snapshot().find((entry) => entry.slot === first.slot).cooldown_remaining_ms, 7000)

  now = 8000
  assert.equal(pool.snapshot().find((entry) => entry.slot === first.slot).status, 'ready')
})

test('ApiKeyPool can wait for earliest cooldown with an injected deterministic sleep', async () => {
  let now = 1000
  const sleeps = []
  const pool = new ApiKeyPool({
    provider: 'gemini',
    keys: [keys[0]],
    clock: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms },
    maxWaitMs: 10000
  })
  const lease = await pool.acquire({ allowWait: false })
  pool.cooldown(lease, 2500)

  const next = await pool.acquire({ allowWait: true })
  assert.equal(next.slot, 'GROQ_KEY1')
  assert.deepEqual(sleeps, [2500])
})

test('ApiKeyPool reports all-disabled and over-budget cooling states safely', async () => {
  const pool = new ApiKeyPool({ provider: 'openai', keys: [keys[0]], clock: () => 1000, maxWaitMs: 100 })
  const lease = await pool.acquire({ allowWait: false })
  pool.cooldown(lease, 1000)
  await assert.rejects(pool.acquire({ allowWait: true }), ApiKeyPoolCoolingError)

  pool.disable(lease, 'authentication_failed')
  await assert.rejects(pool.acquire({ allowWait: false }), ApiKeyPoolExhaustedError)
  const error = await pool.acquire({ allowWait: false }).catch((value) => value)
  assert.doesNotMatch(JSON.stringify(error), /secret-one/)
})
