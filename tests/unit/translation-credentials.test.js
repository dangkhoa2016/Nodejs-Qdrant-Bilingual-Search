import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverProviderApiKeys } from '../../src/translation/credentials.js'

test('discoverProviderApiKeys supports numbered keys with gaps and deterministic numeric ordering', () => {
  const keys = discoverProviderApiKeys({
    GROQ_KEY8: ' eight ',
    GROQ_KEY1: 'one',
    GROQ_KEY3: 'three'
  }, 'groq')

  assert.deepEqual(keys.map(({ slot, secret }) => ({ slot, secret })), [
    { slot: 'GROQ_KEY1', secret: 'one' },
    { slot: 'GROQ_KEY3', secret: 'three' },
    { slot: 'GROQ_KEY8', secret: 'eight' }
  ])
})

test('discoverProviderApiKeys deduplicates secrets and appends conventional API key fallback', () => {
  const keys = discoverProviderApiKeys({
    NVIDIA_KEY2: 'same',
    NVIDIA_KEY5: 'unique',
    NVIDIA_API_KEY: 'same'
  }, 'nvidia')

  assert.deepEqual(keys.map((entry) => entry.slot), ['NVIDIA_KEY2', 'NVIDIA_KEY5'])
})

test('discoverProviderApiKeys supports a single conventional API key and isolates provider prefixes', () => {
  const env = { OPENAI_API_KEY: 'openai', GEMINI_KEY1: 'gemini', GROQ_KEY1: 'groq' }
  assert.deepEqual(discoverProviderApiKeys(env, 'openai').map((entry) => entry.secret), ['openai'])
  assert.deepEqual(discoverProviderApiKeys(env, 'gemini').map((entry) => entry.secret), ['gemini'])
  assert.deepEqual(discoverProviderApiKeys(env, 'nvidia'), [])
})

test('discoverProviderApiKeys rejects unsupported providers', () => {
  assert.throws(() => discoverProviderApiKeys({}, 'unknown'), /unsupported cloud translation provider/)
})
