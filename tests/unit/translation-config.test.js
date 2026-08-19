import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTranslationConfig } from '../../src/translation/config.js'

test('loadTranslationConfig defaults to disabled translation without requiring credentials', () => {
  const config = loadTranslationConfig({})
  assert.equal(config.provider, 'none')
  assert.equal(config.model, undefined)
  assert.equal(config.concurrency, 4)
  assert.equal(config.cachePath, 'data/generated/translation-cache.jsonl')
})

test('loadTranslationConfig configures local HTTP translation with deterministic defaults', () => {
  const config = loadTranslationConfig({ TRANSLATION_PROVIDER: 'local' })
  assert.equal(config.provider, 'local')
  assert.equal(config.model, 'Helsinki-NLP/opus-mt-en-vi')
  assert.equal(config.baseUrl, 'http://127.0.0.1:8001')
})

test('loadTranslationConfig requires explicit model for cloud providers and selects safe default base URL', () => {
  assert.throws(() => loadTranslationConfig({ TRANSLATION_PROVIDER: 'groq' }), /TRANSLATION_MODEL/)
  const groq = loadTranslationConfig({ TRANSLATION_PROVIDER: 'groq', TRANSLATION_MODEL: 'model-a' })
  assert.equal(groq.baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(groq.model, 'model-a')

  const nvidia = loadTranslationConfig({ TRANSLATION_PROVIDER: 'nvidia', TRANSLATION_MODEL: 'model-b' })
  assert.equal(nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1')
})

test('loadTranslationConfig validates provider retry concurrency and URLs', () => {
  assert.throws(() => loadTranslationConfig({ TRANSLATION_PROVIDER: 'other' }), /TRANSLATION_PROVIDER/)
  assert.throws(() => loadTranslationConfig({ TRANSLATION_PROVIDER: 'local', TRANSLATION_CONCURRENCY: '0' }), /TRANSLATION_CONCURRENCY/)
  assert.throws(() => loadTranslationConfig({ TRANSLATION_PROVIDER: 'local', TRANSLATION_URL: 'file:///tmp/x' }), /http or https/)
  assert.throws(() => loadTranslationConfig({ TRANSLATION_PROVIDER: 'local', TRANSLATION_RETRY_MAX_ATTEMPTS: '0' }), /TRANSLATION_RETRY_MAX_ATTEMPTS/)
})
