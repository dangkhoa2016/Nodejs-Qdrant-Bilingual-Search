export const TRANSLATION_PROMPT_VERSION = 'translation-v1'

export const TRANSLATION_SYSTEM_PROMPT = `You are a professional translation engine. Translate the user's English text into natural Vietnamese. Preserve factual meaning, numbers, identifiers, and proper nouns unless a standard Vietnamese form is well established. Return only the Vietnamese translation with no quotation marks, commentary, markdown, or preamble.`

export function assertTranslationInput(text, { from = 'en', to = 'vi' } = {}) {
  if (from !== 'en' || to !== 'vi') throw new TypeError('translation provider currently supports en -> vi only')
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('translation text must be a non-empty string')
  return text.trim()
}

export function normalizedTranslation(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('translation provider returned an invalid translation response')
  return value.trim()
}
