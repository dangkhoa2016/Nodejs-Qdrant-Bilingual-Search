export class TranslationServiceError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'TranslationServiceError'
  }
}

export class HttpTranslator {
  constructor({ baseUrl, model, timeoutMs = 30_000, fetchImpl = fetch }) {
    if (!baseUrl) throw new TypeError('baseUrl is required')
    if (!model) throw new TypeError('model is required')
    this.provider = 'local'
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.promptVersion = 'translation-v1'
    this.timeoutMs = timeoutMs
    this.fetch = fetchImpl
  }

  async translate(text, { from = 'en', to = 'vi' } = {}) {
    if (from !== 'en' || to !== 'vi') throw new TranslationServiceError('local translator currently supports en -> vi only')
    if (typeof text !== 'string' || !text.trim()) throw new TranslationServiceError('translation text must be a non-empty string')

    let response
    try {
      response = await this.fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), from, to }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      throw new TranslationServiceError('translation service request failed', error)
    }

    if (!response.ok) throw new TranslationServiceError(`translation service returned HTTP ${response.status}`)
    const body = await response.json()
    if (body.model && body.model !== this.model) {
      throw new TranslationServiceError(`translation model mismatch: expected ${this.model}, received ${body.model}`)
    }
    if (typeof body.translation !== 'string' || !body.translation.trim()) {
      throw new TranslationServiceError('translation service returned an invalid translation')
    }
    return body.translation.trim()
  }
}
