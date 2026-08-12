import { assertTranslationInput, normalizedTranslation, TRANSLATION_PROMPT_VERSION, TRANSLATION_SYSTEM_PROMPT } from './common.js'

function outputText(body) {
  const content = body?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((item) => typeof item?.text === 'string' ? item.text : typeof item === 'string' ? item : '').filter(Boolean).join('\n')
  }
  return null
}

export class OpenAICompatibleChatTranslationProvider {
  constructor({ provider, model, executor, baseUrl }) {
    if (!['groq', 'nvidia'].includes(provider)) throw new TypeError('OpenAI-compatible translation provider must be groq or nvidia')
    if (!model) throw new TypeError('translation model is required')
    if (!executor) throw new TypeError('executor is required')
    if (!baseUrl) throw new TypeError('baseUrl is required')
    this.provider = provider
    this.model = model
    this.promptVersion = TRANSLATION_PROMPT_VERSION
    this.executor = executor
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async translate(text, options = {}) {
    const source = assertTranslationInput(text, options)
    const result = await this.executor.execute({
      makeRequest: (lease) => ({
        url: `${this.baseUrl}/chat/completions`,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${lease.secret()}`
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
              { role: 'user', content: source }
            ]
          })
        }
      }),
      parse: async (response) => normalizedTranslation(outputText(await response.json()))
    })
    return result.text
  }
}
