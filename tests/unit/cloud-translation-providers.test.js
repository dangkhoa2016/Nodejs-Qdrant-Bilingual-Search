import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiKeyPool } from '../../src/translation/key-pool.js'
import { CloudTranslationExecutor } from '../../src/translation/cloud-executor.js'
import { OpenAIResponsesTranslationProvider } from '../../src/translation/providers/openai-responses.js'
import { GeminiTranslationProvider } from '../../src/translation/providers/gemini.js'
import { OpenAICompatibleChatTranslationProvider } from '../../src/translation/providers/openai-compatible-chat.js'

function harness(provider, responseBody) {
  const calls = []
  const pool = new ApiKeyPool({ provider, keys: [{ slot: `${provider.toUpperCase()}_KEY1`, secret: `${provider}-secret` }] })
  const executor = new CloudTranslationExecutor({
    provider,
    keyPool: pool,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) })
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    sleep: async () => {}
  })
  return { calls, executor }
}

test('OpenAI provider uses Responses REST API and parses output_text content', async () => {
  const { calls, executor } = harness('openai', {
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Xin chào' }] }]
  })
  const provider = new OpenAIResponsesTranslationProvider({ model: 'test-model', executor })
  const result = await provider.translate('Hello', { from: 'en', to: 'vi' })

  assert.equal(result, 'Xin chào')
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses')
  assert.equal(calls[0].init.headers.authorization, 'Bearer openai-secret')
  assert.equal(calls[0].body.model, 'test-model')
  assert.match(JSON.stringify(calls[0].body.input), /Hello/)
})

test('Gemini provider uses generateContent and x-goog-api-key header', async () => {
  const { calls, executor } = harness('gemini', {
    candidates: [{ content: { parts: [{ text: 'Xin chào' }] } }]
  })
  const provider = new GeminiTranslationProvider({ model: 'gemini-test', executor })
  const result = await provider.translate('Hello', { from: 'en', to: 'vi' })

  assert.equal(result, 'Xin chào')
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent')
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'gemini-secret')
  assert.match(JSON.stringify(calls[0].body), /Hello/)
})

test('Groq and NVIDIA providers share OpenAI-compatible chat transport with provider-specific base URLs', async () => {
  for (const [providerName, baseUrl] of [
    ['groq', 'https://api.groq.com/openai/v1'],
    ['nvidia', 'https://integrate.api.nvidia.com/v1']
  ]) {
    const { calls, executor } = harness(providerName, { choices: [{ message: { content: 'Xin chào' } }] })
    const provider = new OpenAICompatibleChatTranslationProvider({ provider: providerName, model: 'translation-model', baseUrl, executor })
    assert.equal(await provider.translate('Hello', { from: 'en', to: 'vi' }), 'Xin chào')
    assert.equal(calls[0].url, `${baseUrl}/chat/completions`)
    assert.equal(calls[0].body.model, 'translation-model')
    assert.match(JSON.stringify(calls[0].body.messages), /Hello/)
  }
})

test('cloud providers reject unsupported translation directions before consuming an API key', async () => {
  const { calls, executor } = harness('openai', { output: [] })
  const provider = new OpenAIResponsesTranslationProvider({ model: 'test-model', executor })
  await assert.rejects(provider.translate('Xin chào', { from: 'vi', to: 'en' }), /supports en -> vi/)
  assert.equal(calls.length, 0)
})

test('cloud provider response parsing fails safely when translation text is missing', async () => {
  const { executor } = harness('openai', { output: [{ type: 'message', content: [] }] })
  const provider = new OpenAIResponsesTranslationProvider({ model: 'test-model', executor })
  const error = await provider.translate('Hello', { from: 'en', to: 'vi' }).catch((value) => value)
  assert.match(String(error), /invalid translation response/)
  assert.doesNotMatch(String(error), /openai-secret/)
})
