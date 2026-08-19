import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlTranslationCache, translationCacheIdentity } from '../../src/translation/cache.js'
import { TranslationService } from '../../src/translation/service.js'

test('translationCacheIdentity is deterministic and excludes API-key slots', () => {
  const a = translationCacheIdentity({ provider: 'groq', model: 'm', promptVersion: 'p1', from: 'en', to: 'vi', text: 'Hello' })
  const b = translationCacheIdentity({ provider: 'groq', model: 'm', promptVersion: 'p1', from: 'en', to: 'vi', text: 'Hello' })
  const c = translationCacheIdentity({ provider: 'groq', model: 'm2', promptVersion: 'p1', from: 'en', to: 'vi', text: 'Hello' })
  assert.equal(a.key, b.key)
  assert.notEqual(a.key, c.key)
  assert.equal(a.sourceSha256.length, 64)
  assert.doesNotMatch(JSON.stringify(a), /KEY1|KEY2|secret/i)
})

test('TranslationService persists successful translation and reuses it after provider key rotation or process restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'translation-cache-'))
  const path = join(dir, 'cache.jsonl')
  let calls = 0
  const provider = {
    provider: 'groq', model: 'model', promptVersion: 'translation-v1',
    async translate() { calls += 1; return 'Xin chào' }
  }
  const service = new TranslationService({ provider, cache: new JsonlTranslationCache(path), translationVersion: 'v7' })

  const first = await service.translateDetailed('Hello')
  assert.equal(first.text, 'Xin chào')
  assert.equal(first.cacheHit, false)
  assert.equal(first.metadata.provider, 'groq')
  assert.equal(first.metadata.translation_version, 'v7')
  assert.equal(first.metadata.source_sha256.length, 64)

  const restartedProvider = {
    provider: 'groq', model: 'model', promptVersion: 'translation-v1',
    async translate() { calls += 1; return 'SHOULD NOT RUN' }
  }
  const restarted = new TranslationService({ provider: restartedProvider, cache: new JsonlTranslationCache(path), translationVersion: 'v7' })
  const second = await restarted.translateDetailed('Hello')
  assert.equal(second.text, 'Xin chào')
  assert.equal(second.cacheHit, true)
  assert.equal(calls, 1)

  const raw = await readFile(path, 'utf8')
  assert.doesNotMatch(raw, /API_KEY|secret|KEY\d+/i)
})

test('TranslationService deduplicates concurrent requests for the same cache identity', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const provider = {
    provider: 'gemini', model: 'model', promptVersion: 'translation-v1',
    async translate() { calls += 1; await gate; return 'Xin chào' }
  }
  const cache = { async get() { return null }, async set() {} }
  const service = new TranslationService({ provider, cache })

  const a = service.translateDetailed('Hello')
  const b = service.translateDetailed('Hello')
  release()
  const [one, two] = await Promise.all([a, b])
  assert.equal(one.text, 'Xin chào')
  assert.equal(two.text, 'Xin chào')
  assert.equal(calls, 1)
})
