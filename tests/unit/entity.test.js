import test from 'node:test'
import assert from 'node:assert/strict'
import { bilingualState, normalizeEntity } from '../../src/domain/entity.js'

const thailand = {
  id: 'Q869', type: 'country',
  name: { en: ' Thailand ', vi: 'Thái Lan' },
  description: { en: 'country in Southeast Asia', vi: 'quốc gia ở Đông Nam Á' },
  aliases: { en: ['Kingdom of Thailand', 'Kingdom of Thailand'], vi: [] },
  population: 65889213
}

test('normalizeEntity trims text, deduplicates aliases and derives provenance', () => {
  const entity = normalizeEntity(thailand)
  assert.equal(entity.name.en, 'Thailand')
  assert.deepEqual(entity.aliases.en, ['Kingdom of Thailand'])
  assert.equal(entity.languageProvenance.description_vi, 'wikidata')
  assert.equal(bilingualState(entity), 'native_bilingual')
})

test('normalizeEntity accepts missing Vietnamese without fabricating it', () => {
  const entity = normalizeEntity({ id: 'Q1', type: 'landmark', name: { en: 'Universe' } })
  assert.equal(entity.name.vi, null)
  assert.equal(entity.languageProvenance.name_vi, 'missing')
  assert.equal(bilingualState(entity), 'english_only')
})

test('normalizeEntity accepts deterministic namespaced IDs from non-Wikidata public sources', () => {
  const entity = normalizeEntity({
    id: 'geonames:city:1581130',
    type: 'city',
    name: { en: 'Bangkok' },
    source: 'geonames',
    sourceId: '1581130'
  })

  assert.equal(entity.id, 'geonames:city:1581130')
  assert.equal(entity.languageProvenance.name_en, 'geonames')
  assert.equal(entity.languageProvenance.name_vi, 'missing')
})

test('normalizeEntity rejects unsafe identifiers and negative population', () => {
  assert.throws(() => normalizeEntity({ id: '869', type: 'country', name: { en: 'Thailand' } }), /canonical entity ID/)
  assert.throws(() => normalizeEntity({ id: 'geonames:city:../passwd', type: 'city', name: { en: 'Unsafe' }, source: 'geonames' }), /canonical entity ID/)
  assert.throws(() => normalizeEntity({ id: 'Q869', type: 'country', name: { en: 'Thailand' }, population: -1 }), /population/)
})
