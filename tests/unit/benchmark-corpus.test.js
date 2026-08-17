import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'

const entities = [
  { id: 'geonames:country:1605651', type: 'country' },
  { id: 'geonames:city:1850147', type: 'city' }
]

test('benchmark validator accepts current GeoNames country/city ground truth', () => {
  const cases = [
    { id: 'en-thailand', language: 'en', category: 'country-factual', query: 'country using baht', expected_ids: ['geonames:country:1605651'] },
    { id: 'vi-tokyo', language: 'vi', category: 'city-capital', query: 'thủ đô của Nhật Bản', expected_ids: ['geonames:city:1850147'] }
  ]
  assert.equal(validateBenchmarkCases(cases, entities).length, 2)
})

test('benchmark validator rejects stale Wikidata QIDs, absent entities and unsupported entity types', () => {
  assert.throws(() => validateBenchmarkCases([
    { id: 'stale', language: 'en', category: 'country-factual', query: 'Thailand', expected_ids: ['Q869'] }
  ], entities), /stale Wikidata QID/)

  assert.throws(() => validateBenchmarkCases([
    { id: 'missing', language: 'en', category: 'city-capital', query: 'missing', expected_ids: ['geonames:city:999'] }
  ], entities), /not present in benchmark dataset/)

  assert.throws(() => validateBenchmarkCases([
    { id: 'landmark', language: 'en', category: 'city-capital', query: 'tower', expected_ids: ['geonames:landmark:1'] }
  ], [...entities, { id: 'geonames:landmark:1', type: 'landmark' }]), /unsupported benchmark entity type/)
})

test('committed bilingual benchmark no longer contains Wikidata QIDs or Eiffel Tower cases', async () => {
  const cases = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual.json', import.meta.url), 'utf8'))
  assert.equal(cases.length >= 20 && cases.length <= 30, true)
  assert.equal(cases.some((item) => item.expected_ids.some((id) => /^Q\d+$/.test(id))), false)
  assert.equal(cases.some((item) => /eiffel/i.test(`${item.id} ${item.query}`)), false)
  assert.deepEqual(
    Object.fromEntries([...new Set(cases.map((item) => item.category))].sort().map((category) => [category, cases.filter((item) => item.category === category).length])),
    { 'city-alias': 2, 'city-capital': 14, 'country-factual': 14 }
  )
})

test('benchmark validator requires a supported analysis category compatible with expected entity type', () => {
  assert.throws(() => validateBenchmarkCases([
    { id: 'missing-category', language: 'en', query: 'Thailand', expected_ids: ['geonames:country:1605651'] }
  ], entities), /benchmark category is required/)

  assert.throws(() => validateBenchmarkCases([
    { id: 'bad-category', language: 'en', category: 'other', query: 'Thailand', expected_ids: ['geonames:country:1605651'] }
  ], entities), /unsupported benchmark category/)

  assert.throws(() => validateBenchmarkCases([
    { id: 'wrong-type', language: 'en', category: 'city-capital', query: 'Thailand', expected_ids: ['geonames:country:1605651'] }
  ], entities), /category city-capital requires city/)
})

test('benchmark validator accepts explicit no-answer cases without ground-truth entity IDs', () => {
  const cases = [
    { id: 'negative-en', language: 'en', category: 'no-answer', query: 'who wrote Pride and Prejudice?', expected_ids: [], answerable: false }
  ]
  const validated = validateBenchmarkCases(cases, entities)
  assert.equal(validated[0].answerable, false)
})

test('benchmark validator rejects inconsistent no-answer declarations', () => {
  assert.throws(() => validateBenchmarkCases([
    { id: 'negative-with-id', language: 'en', category: 'no-answer', query: 'irrelevant', expected_ids: ['geonames:country:1605651'], answerable: false }
  ], entities), /no-answer benchmark.*must not define expected_ids/)

  assert.throws(() => validateBenchmarkCases([
    { id: 'positive-without-id', language: 'en', category: 'country-factual', query: 'Thailand', expected_ids: [], answerable: true }
  ], entities), /expected_ids is required/)
})

test('committed hard benchmark v2 has balanced EN-VI coverage and explicit no-answer cases', async () => {
  const cases = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v2.json', import.meta.url), 'utf8'))
  assert.equal(cases.length, 100)
  assert.equal(cases.filter((item) => item.language === 'en').length, 50)
  assert.equal(cases.filter((item) => item.language === 'vi').length, 50)
  assert.equal(cases.filter((item) => item.answerable === false).length, 20)
  assert.equal(new Set(cases.map((item) => item.id)).size, 100)
})
