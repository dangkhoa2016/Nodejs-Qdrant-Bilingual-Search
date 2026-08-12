import { translationCacheIdentity } from './cache.js'

export class TranslationService {
  #inflight = new Map()

  constructor({ provider, cache, translationVersion = 'v1' }) {
    if (!provider?.provider || !provider?.model || !provider?.promptVersion || typeof provider.translate !== 'function') {
      throw new TypeError('translation provider must expose provider, model, promptVersion and translate()')
    }
    if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') throw new TypeError('translation cache must expose get() and set()')
    this.translationProvider = provider
    this.cache = cache
    this.translationVersion = translationVersion
    this.provider = provider.provider
    this.model = provider.model
    this.promptVersion = provider.promptVersion
  }

  async translate(text, options = {}) {
    return (await this.translateDetailed(text, options)).text
  }

  async translateDetailed(text, { from = 'en', to = 'vi' } = {}) {
    const identity = translationCacheIdentity({
      provider: this.provider,
      model: this.model,
      promptVersion: this.promptVersion,
      from,
      to,
      text
    })
    const cached = await this.cache.get(identity.key)
    if (cached) return { text: cached.text, metadata: cached.metadata, cacheHit: true }

    if (this.#inflight.has(identity.key)) return this.#inflight.get(identity.key)
    const promise = this.#translateAndCache(text, { from, to, identity })
    this.#inflight.set(identity.key, promise)
    try {
      return await promise
    } finally {
      this.#inflight.delete(identity.key)
    }
  }

  async #translateAndCache(text, { from, to, identity }) {
    const translated = await this.translationProvider.translate(text, { from, to })
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('translation provider returned empty text')
    const metadata = {
      provider: this.provider,
      model: this.model,
      prompt_version: this.promptVersion,
      source_language: from,
      target_language: to,
      source_sha256: identity.sourceSha256,
      translation_version: this.translationVersion
    }
    const result = { text: translated.trim(), metadata, cacheHit: false }
    await this.cache.set(identity.key, { text: result.text, metadata })
    return result
  }
}
