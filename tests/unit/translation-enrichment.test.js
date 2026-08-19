import test from 'node:test'
import assert from 'node:assert/strict'
import { translateMissingVietnamese, translateDataset } from '../../src/dataset/translation.js'

const base = {
  id: 'Q1', type: 'landmark',
  name: { en: 'Universe', vi: null },
  description: { en: 'totality of space and time', vi: null },
  source: 'wikidata', sourceId: 'Q1'
}

test('translation enrichment records provider model prompt and source hash from detailed translator', async () => {
  const translator = {
    provider: 'groq', model: 'model-x', promptVersion: 'translation-v1',
    async translateDetailed(text) {
      assert.equal(text, 'totality of space and time')
      return {
        text: 'toàn bộ không gian và thời gian',
        metadata: {
          provider: 'groq', model: 'model-x', prompt_version: 'translation-v1',
          source_language: 'en', target_language: 'vi', source_sha256: 'a'.repeat(64), translation_version: 'v2'
        }
      }
    }
  }

  const entity = await translateMissingVietnamese(base, { translator, fields: ['description'], translationVersion: 'v2' })
  assert.equal(entity.description.vi, 'toàn bộ không gian và thời gian')
  assert.equal(entity.languageProvenance.description_vi, 'machine_translation')
  assert.deepEqual(entity.translationMetadata.description_vi, {
    provider: 'groq', model: 'model-x', prompt_version: 'translation-v1',
    source_language: 'en', target_language: 'vi', source_sha256: 'a'.repeat(64), translation_version: 'v2'
  })
})

test('native Vietnamese still wins and cloud translator is not called', async () => {
  let calls = 0
  const entity = await translateMissingVietnamese({
    ...base,
    description: { en: 'country', vi: 'quốc gia' }
  }, {
    translator: { async translateDetailed() { calls += 1; return { text: 'WRONG', metadata: {} } } },
    fields: ['description']
  })
  assert.equal(entity.description.vi, 'quốc gia')
  assert.equal(calls, 0)
})

test('translateDataset respects bounded concurrency while preserving input order', async () => {
  let active = 0
  let maxActive = 0
  const translator = {
    async translateDetailed(text) {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, text.endsWith('1') ? 10 : 1))
      active -= 1
      return { text: `vi:${text}`, metadata: { provider: 'test', model: 'm', prompt_version: 'p', source_language: 'en', target_language: 'vi', source_sha256: 'b'.repeat(64), translation_version: 'v1' } }
    }
  }
  const entities = [1, 2, 3, 4].map((n) => ({
    id: `Q${n}`, type: 'landmark', name: { en: `Name ${n}` }, description: { en: `desc ${n}` }, source: 'wikidata', sourceId: `Q${n}`
  }))

  const translated = await translateDataset(entities, { translator, fields: ['description'], concurrency: 2 })
  assert.deepEqual(translated.map((entity) => entity.id), ['Q1', 'Q2', 'Q3', 'Q4'])
  assert.equal(maxActive, 2)
})
