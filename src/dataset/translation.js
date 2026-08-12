import { createHash } from 'node:crypto'
import { normalizeEntity } from '../domain/entity.js'

export class TranslationError extends Error {
  constructor(message, cause) { super(message, { cause }); this.name = 'TranslationError' }
}

const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex')

async function detailedTranslation(translator, text, { from, to, model, translationVersion }) {
  if (typeof translator.translateDetailed === 'function') {
    const result = await translator.translateDetailed(text, { from, to })
    if (!result?.metadata || typeof result.text !== 'string') throw new Error('detailed translator returned an invalid result')
    return result
  }
  const translated = await translator.translate(text, { from, to })
  return {
    text: translated,
    metadata: {
      provider: translator.provider ?? 'custom',
      model: model ?? translator.model ?? 'unspecified',
      prompt_version: translator.promptVersion ?? 'unspecified',
      source_language: from,
      target_language: to,
      source_sha256: sha256(text),
      translation_version: translationVersion
    }
  }
}

/**
 * Optional fallback translation. Native Vietnamese always wins.
 * Proper names are NOT translated by default; only descriptions are eligible.
 */
export async function translateMissingVietnamese(entity, {
  translator,
  fields = ['description'],
  model = 'unspecified',
  translationVersion = 'v1'
} = {}) {
  const next = structuredClone(entity)
  if (!translator) return normalizeEntity(next)

  for (const field of fields) {
    if (!['description', 'name'].includes(field)) throw new TranslationError(`unsupported translation field: ${field}`)
    if (next[field]?.vi || !next[field]?.en) continue
    try {
      const result = await detailedTranslation(translator, next[field].en, { from: 'en', to: 'vi', model, translationVersion })
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('empty translation')
      next[field].vi = result.text.trim()
      next.languageProvenance ??= {}
      next.languageProvenance[`${field}_vi`] = 'machine_translation'
      next.translationMetadata ??= {}
      next.translationMetadata[`${field}_vi`] = {
        ...result.metadata,
        translation_version: result.metadata.translation_version ?? translationVersion
      }
    } catch (error) {
      throw new TranslationError(`failed to translate ${field} for ${entity.id}`, error)
    }
  }
  return normalizeEntity(next)
}

export async function translateDataset(entities, options = {}) {
  if (!Array.isArray(entities)) throw new TypeError('entities must be an array')
  const concurrency = options.concurrency ?? 1
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('translation concurrency must be a positive integer')
  const output = new Array(entities.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= entities.length) return
      output[index] = await translateMissingVietnamese(entities[index], options)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, entities.length)) }, () => worker()))
  return output
}
