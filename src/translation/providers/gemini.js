import { assertTranslationInput, normalizedTranslation, TRANSLATION_PROMPT_VERSION, TRANSLATION_SYSTEM_PROMPT } from './common.js'

function outputText(body) {
  const parts = body?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  return parts.map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n')
}

export class GeminiTranslationProvider {
  constructor({ model, executor, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' }) {
    if (!model) throw new TypeError('translation model is required')
    if (!executor) throw new TypeError('executor is required')
    this.provider = 'gemini'
    this.model = model.replace(/^models\//, '')
    this.promptVersion = TRANSLATION_PROMPT_VERSION
    this.executor = executor
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async translate(text, options = {}) {
    const source = assertTranslationInput(text, options)
    const result = await this.executor.execute({
      makeRequest: (lease) => ({
        url: `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': lease.secret()
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: TRANSLATION_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: source }] }]
          })
        }
      }),
      parse: async (response) => normalizedTranslation(outputText(await response.json()))
    })
    return result.text
  }
}
