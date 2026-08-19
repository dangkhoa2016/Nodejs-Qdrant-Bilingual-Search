import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity, bilingualState } from '../../src/domain/entity.js'
import { translateMissingVietnamese } from '../../src/dataset/translation.js'

const englishOnly = normalizeEntity({
  id: 'Q999', type: 'landmark', name: { en: 'Example Place' },
  description: { en: 'historic landmark in northern Thailand' }
})

test('translation fallback translates only missing fields and records provenance', async () => {
  const calls = []
  const translated = await translateMissingVietnamese(englishOnly, {
    translator: { translate: async (text, options) => { calls.push({ text, options }); return 'địa danh lịch sử ở miền bắc Thái Lan' } },
    model: 'example-translator', translationVersion: 'v1'
  })
  assert.equal(translated.name.vi, null, 'proper name remains untouched by default')
  assert.equal(translated.description.vi, 'địa danh lịch sử ở miền bắc Thái Lan')
  assert.equal(translated.languageProvenance.description_vi, 'machine_translation')
  assert.equal(translated.translationMetadata.description_vi.model, 'example-translator')
  assert.equal(bilingualState(translated), 'translated_bilingual')
  assert.equal(calls.length, 1)
})

test('native Vietnamese is never overwritten by fallback translator', async () => {
  const native = normalizeEntity({ id: 'Q869', type: 'country', name: { en: 'Thailand', vi: 'Thái Lan' }, description: { en: 'country', vi: 'quốc gia' } })
  const translated = await translateMissingVietnamese(native, { translator: { translate: async () => 'SAI' } })
  assert.equal(translated.description.vi, 'quốc gia')
  assert.equal(translated.languageProvenance.description_vi, 'wikidata')
})

test('translation can be disabled by omitting translator', async () => {
  const result = await translateMissingVietnamese(englishOnly, {})
  assert.equal(result.description.vi, null)
})
