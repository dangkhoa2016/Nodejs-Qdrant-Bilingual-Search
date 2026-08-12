import { assertTranslationInput, normalizedTranslation, TRANSLATION_PROMPT_VERSION, TRANSLATION_SYSTEM_PROMPT } from './common.js'

function outputText(body) {
  if (typeof body?.output_text === 'string') return body.output_text
  for (const item of body?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text
    }
  }
  return null
}

export class OpenAIResponsesTranslationProvider {
  constructor({ model, executor, baseUrl = 'https://api.openai.com/v1' }) {
    if (!model) throw new TypeError('translation model is required')
    if (!executor) throw new TypeError('executor is required')
    this.provider = 'openai'
    this.model = model
    this.promptVersion = TRANSLATION_PROMPT_VERSION
    this.executor = executor
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async translate(text, options = {}) {
    const source = assertTranslationInput(text, options)
    const result = await this.executor.execute({
      makeRequest: (lease) => ({
        url: `${this.baseUrl}/responses`,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${lease.secret()}`
          },
          body: JSON.stringify({
            model: this.model,
            input: [
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
