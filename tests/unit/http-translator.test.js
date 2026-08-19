import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpTranslator, TranslationServiceError } from '../../src/dataset/http-translator.js'

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

test('HttpTranslator sends an explicit en -> vi translation contract', async () => {
  let request
  const translator = new HttpTranslator({
    baseUrl: 'http://127.0.0.1:8001/',
    model: 'Helsinki-NLP/opus-mt-en-vi',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return fakeResponse({ model: 'Helsinki-NLP/opus-mt-en-vi', translation: 'quốc gia ở Đông Nam Á' })
    }
  })
  const result = await translator.translate('country in Southeast Asia')
  assert.equal(result, 'quốc gia ở Đông Nam Á')
  assert.equal(request.url, 'http://127.0.0.1:8001/translate')
  assert.deepEqual(JSON.parse(request.options.body), { text: 'country in Southeast Asia', from: 'en', to: 'vi' })
})

test('HttpTranslator refuses unsupported language directions before making a request', async () => {
  let calls = 0
  const translator = new HttpTranslator({ baseUrl: 'http://x', model: 'm', fetchImpl: async () => { calls++; return fakeResponse({}) } })
  await assert.rejects(() => translator.translate('xin chào', { from: 'vi', to: 'en' }), TranslationServiceError)
  assert.equal(calls, 0)
})

test('HttpTranslator detects model mismatches to protect dataset provenance', async () => {
  const translator = new HttpTranslator({
    baseUrl: 'http://x', model: 'expected',
    fetchImpl: async () => fakeResponse({ model: 'unexpected', translation: 'x' })
  })
  await assert.rejects(() => translator.translate('hello'), /model mismatch/)
})

test('HttpTranslator wraps transport and HTTP failures', async () => {
  const down = new HttpTranslator({ baseUrl: 'http://x', model: 'm', fetchImpl: async () => { throw new Error('network') } })
  await assert.rejects(() => down.translate('hello'), /request failed/)
  const bad = new HttpTranslator({ baseUrl: 'http://x', model: 'm', fetchImpl: async () => fakeResponse({}, { ok: false, status: 503 }) })
  await assert.rejects(() => bad.translate('hello'), /HTTP 503/)
})
