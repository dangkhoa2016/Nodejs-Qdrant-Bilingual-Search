import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTranslationConfig } from '../../src/translation/config.js'
import { createTranslationProvider } from '../../src/translation/create-provider.js'

test('createTranslationProvider returns null for none and local provider without cloud keys', () => {
  assert.equal(createTranslationProvider({ config: loadTranslationConfig({}) }), null)
  const local = createTranslationProvider({ config: loadTranslationConfig({ TRANSLATION_PROVIDER: 'local' }) })
  assert.equal(local.provider, 'local')
  assert.equal(local.model, 'Helsinki-NLP/opus-mt-en-vi')
})

test('createTranslationProvider requires API keys only for selected cloud provider', () => {
  const config = loadTranslationConfig({ TRANSLATION_PROVIDER: 'groq', TRANSLATION_MODEL: 'model' })
  assert.throws(
    () => createTranslationProvider({ config, env: { NVIDIA_KEY1: 'nvidia-only' } }),
    /no API keys configured for groq/
  )

  const provider = createTranslationProvider({ config, env: { GROQ_KEY3: 'groq-secret', NVIDIA_KEY1: 'nvidia-secret' } })
  assert.equal(provider.provider, 'groq')
  assert.equal(provider.model, 'model')
})

test('createTranslationProvider wires selected cloud key pool into actual request without consuming another provider key', async () => {
  const calls = []
  const config = loadTranslationConfig({ TRANSLATION_PROVIDER: 'groq', TRANSLATION_MODEL: 'model' })
  const provider = createTranslationProvider({
    config,
    env: { GROQ_KEY2: 'groq-secret', NVIDIA_KEY1: 'nvidia-secret' },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), authorization: init.headers.authorization })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Xin chào' } }] }), { status: 200 })
    },
    sleep: async () => {}
  })

  assert.equal(await provider.translate('Hello'), 'Xin chào')
  assert.equal(calls[0].authorization, 'Bearer groq-secret')
  assert.doesNotMatch(JSON.stringify(calls), /nvidia-secret/)
})
