import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeEntityDatasets } from '../../src/dataset/merge.js'

const wikidata = {
  id: 'Q869', type: 'country',
  name: { en: 'Thailand', vi: 'Thái Lan' },
  description: { en: 'country in Southeast Asia', vi: null },
  aliases: { en: ['Kingdom of Thailand'], vi: [] },
  continent: 'Asia', region: null, countryCode: null, population: 70000000,
  facts: { capital: 'Bangkok' },
  source: 'wikidata', sourceId: 'Q869'
}

const geonames = {
  id: 'Q869', type: 'country',
  name: { en: 'Thailand', vi: 'Thái Lan' },
  description: { en: null, vi: null },
  aliases: { en: [], vi: [] },
  continent: 'Asia', region: 'South-Eastern Asia', countryCode: 'TH', population: 69625582,
  facts: {}, source: 'geonames', sourceId: '1605651'
}

test('mergeEntityDatasets deduplicates canonical IDs with deterministic source priority', () => {
  const [entity] = mergeEntityDatasets([
    { source: 'geonames', entities: [geonames] },
    { source: 'wikidata', entities: [wikidata] }
  ], { sourcePriority: ['wikidata', 'geonames'] })

  assert.equal(entity.id, 'Q869')
  assert.equal(entity.source, 'wikidata')
  assert.equal(entity.population, 70000000)
  assert.equal(entity.countryCode, 'TH')
  assert.equal(entity.region, 'South-Eastern Asia')
  assert.equal(entity.facts.capital, 'Bangkok')
  assert.deepEqual(entity.sourceRefs, [
    { source: 'wikidata', sourceId: 'Q869' },
    { source: 'geonames', sourceId: '1605651' }
  ])
})

test('mergeEntityDatasets rejects type conflicts for the same canonical ID', () => {
  assert.throws(
    () => mergeEntityDatasets([
      { source: 'wikidata', entities: [wikidata] },
      { source: 'geonames', entities: [{ ...geonames, type: 'city' }] }
    ]),
    /type conflict/
  )
})
