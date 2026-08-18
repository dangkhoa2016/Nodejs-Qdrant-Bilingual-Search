import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'

const loadStress = async () => import('../../src/evaluation/stress-text-ab.js').catch(() => ({}))

function entity(input) {
  return normalizeEntity({ source: 'geonames', ...input })
}

test('stress candidate builder keeps all countries, all capital cities, expected entities, and hard-report distractors', async () => {
  const module = await loadStress()
  assert.equal(typeof module.buildStressCandidateSet, 'function')

  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' }, countryCode: 'JP', continent: 'Asia', facts: { capital: 'Tokyo' } }),
    entity({ id: 'geonames:country:2', type: 'country', name: { en: 'France', vi: 'Pháp' }, countryCode: 'FR', continent: 'Europe', facts: { capital: 'Paris' } }),
    entity({ id: 'geonames:country:3', type: 'country', name: { en: 'Canada' }, countryCode: 'CA', continent: 'North America', facts: { capital: 'Ottawa' } }),
    entity({ id: 'geonames:city:10', type: 'city', name: { en: 'Tokyo' }, countryCode: 'JP', population: 14_000_000, facts: { country: 'Japan', capital: true } }),
    entity({ id: 'geonames:city:11', type: 'city', name: { en: 'Paris' }, countryCode: 'FR', population: 2_000_000, facts: { country: 'France', capital: true } }),
    entity({ id: 'geonames:city:12', type: 'city', name: { en: 'Ottawa' }, countryCode: 'CA', population: 1_000_000, facts: { country: 'Canada', capital: true } }),
    entity({ id: 'geonames:city:20', type: 'city', name: { en: 'Chiyoda City' }, region: 'Tokyo', countryCode: 'JP', population: 70_000, facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:21', type: 'city', name: { en: 'Osaka' }, countryCode: 'JP', population: 2_700_000, facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:22', type: 'city', name: { en: 'Lyon' }, countryCode: 'FR', population: 500_000, facts: { country: 'France', capital: false } }),
    entity({ id: 'geonames:landmark:30', type: 'landmark', name: { en: 'Tokyo Tower' }, facts: { country: 'Japan' } }),
    entity({ id: 'geonames:city:40', type: 'city', name: { en: 'Sydney' }, countryCode: 'AU', population: 5_000_000, facts: { country: 'Australia', capital: false } })
  ]
  const cases = [
    { id: 'q-country', answerable: true, expected_ids: ['geonames:country:1'] },
    { id: 'q-city', answerable: true, expected_ids: ['geonames:city:11'] }
  ]
  const hardReport = { rows: [
    { id: 'q-country', topResults: [{ id: 'geonames:city:20' }, { id: 'geonames:landmark:30' }] },
    { id: 'q-city', topResults: [{ id: 'geonames:country:2' }] }
  ] }

  const result = module.buildStressCandidateSet({ cases, hardReport, entities, targetSize: 10, maxSize: 12 })
  const ids = new Set(result.manifest.candidateIds)

  for (const id of ['geonames:country:1', 'geonames:country:2', 'geonames:country:3']) assert.ok(ids.has(id), `missing country ${id}`)
  for (const id of ['geonames:city:10', 'geonames:city:11', 'geonames:city:12']) assert.ok(ids.has(id), `missing capital ${id}`)
  for (const id of ['geonames:city:20', 'geonames:landmark:30']) assert.ok(ids.has(id), `missing hard distractor ${id}`)
  assert.equal(result.manifest.candidateCount, 10)
  assert.equal(result.manifest.selectionCounts.allCountries, 3)
  assert.equal(result.manifest.selectionCounts.allCapitalCities, 3)
  assert.equal(result.manifest.selectedTierCounts['all-country'], 3)
  assert.equal(result.manifest.selectedTierCounts['all-capital-city'], 3)
  assert.ok(result.manifest.selectedTierCounts['hard-report-distractor'] >= 2)
  assert.equal(Object.values(result.manifest.selectedTierCounts).reduce((sum, count) => sum + count, 0), result.manifest.candidateCount)
  assert.ok(result.manifest.candidateReasons['geonames:city:20'].includes('hard-report-distractor'))
  assert.ok(result.manifest.candidateReasons['geonames:city:20'].includes('capital-locality'))
})

test('stress candidate builder prefers related and high-population cities before deterministic fillers', async () => {
  const module = await loadStress()
  assert.equal(typeof module.buildStressCandidateSet, 'function')

  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan' }, countryCode: 'JP', continent: 'Asia', facts: { capital: 'Tokyo' } }),
    entity({ id: 'geonames:city:10', type: 'city', name: { en: 'Tokyo' }, countryCode: 'JP', population: 14_000_000, facts: { country: 'Japan', capital: true } }),
    entity({ id: 'geonames:city:11', type: 'city', name: { en: 'Osaka' }, countryCode: 'JP', population: 2_700_000, facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:12', type: 'city', name: { en: 'Yokohama' }, countryCode: 'JP', population: 3_700_000, facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:13', type: 'city', name: { en: 'Seoul' }, countryCode: 'KR', population: 9_000_000, facts: { country: 'South Korea', capital: true } }),
    entity({ id: 'geonames:city:14', type: 'city', name: { en: 'Smallville' }, countryCode: 'ZZ', population: 10, facts: { country: 'Elsewhere', capital: false } }),
    entity({ id: 'geonames:city:15', type: 'city', name: { en: 'Mega Asia City' }, continent: 'Asia', countryCode: 'IN', population: 20_000_000, facts: { country: 'India', capital: false } }),
    entity({ id: 'geonames:landmark:20', type: 'landmark', name: { en: 'A landmark' } })
  ]
  const cases = [{ id: 'q', answerable: true, expected_ids: ['geonames:country:1'] }]
  const hardReport = { rows: [{ id: 'q', topResults: [] }] }

  const result = module.buildStressCandidateSet({ cases, hardReport, entities, targetSize: 5, maxSize: 7 })
  assert.deepEqual(result.manifest.candidateIds, [
    'geonames:country:1',
    'geonames:city:10',
    'geonames:city:13',
    'geonames:city:12',
    'geonames:city:11'
  ])
  assert.ok(result.manifest.candidateReasons['geonames:city:12'].includes('related-major-city'))
  assert.ok(result.manifest.candidateReasons['geonames:city:11'].includes('related-major-city'))
})

test('stress candidate builder fails closed when mandatory adversarial candidates exceed maxSize', async () => {
  const module = await loadStress()
  assert.equal(typeof module.buildStressCandidateSet, 'function')
  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'A' }, facts: { capital: 'A City' } }),
    entity({ id: 'geonames:country:2', type: 'country', name: { en: 'B' }, facts: { capital: 'B City' } }),
    entity({ id: 'geonames:city:1', type: 'city', name: { en: 'A City' }, facts: { country: 'A', capital: true } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'B City' }, facts: { country: 'B', capital: true } })
  ]
  assert.throws(() => module.buildStressCandidateSet({
    cases: [{ id: 'q', expected_ids: ['geonames:country:1'] }],
    hardReport: { rows: [{ id: 'q', topResults: [] }] },
    entities,
    targetSize: 3,
    maxSize: 3
  }), /mandatory stress candidates \(4\) exceed maxSize \(3\)/i)
})
