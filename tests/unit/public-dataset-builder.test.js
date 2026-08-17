import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePublicDatasetOptions, buildPublicDataset } from '../../src/dataset/public-builder.js'

const entity = (id, type, source = 'geonames', sourceId = id, facts = {}) => ({
  id, type, source, sourceId,
  name: { en: id, vi: null }, description: { en: null, vi: null }, aliases: { en: [], vi: [] },
  continent: null, region: null, countryCode: null, population: null, facts,
  sourceRefs: [{ source, sourceId: String(sourceId) }]
})

const noGeoNamesEnrichment = async (entities) => entities
const noWofEnrichment = async (entities) => ({
  entities,
  report: { status: 'ok', requested: entities.length, matched: 0, ambiguous: 0, invalid: 0 }
})

test('normalizePublicDatasetOptions defaults to GeoNames plus WOF for country and city', () => {
  assert.deepEqual(normalizePublicDatasetOptions(), {
    sources: ['geonames', 'wof'],
    types: ['country', 'city'],
    limit: null,
    geonamesDataset: 'cities15000',
    wofDataset: 'whosonfirst-locality-country'
  })
})

test('normalizePublicDatasetOptions rejects retired/unsupported sources, WOF-only builds, and unsafe limits', () => {
  assert.throws(() => normalizePublicDatasetOptions({ sources: 'natural-earth' }), /unsupported public dataset source/)
  assert.throws(() => normalizePublicDatasetOptions({ sources: 'wikidata' }), /unsupported public dataset source/)
  assert.throws(() => normalizePublicDatasetOptions({ sources: 'wof' }), /WOF enrichment requires GeoNames/i)
  assert.throws(() => normalizePublicDatasetOptions({ limit: '0' }), /positive integer/)
})

test('buildPublicDataset applies a representative deterministic limit instead of lowest entity IDs', async () => {
  const cities = [
    { ...entity('geonames:city:1', 'city', 'geonames', '1', { capital: false }), continent: 'Asia', population: 20_000 },
    { ...entity('geonames:city:2', 'city', 'geonames', '2', { capital: false }), continent: 'Europe', population: 30_000 },
    { ...entity('geonames:city:900', 'city', 'geonames', '900', { capital: true }), continent: 'North America', population: 500_000 },
    { ...entity('geonames:city:901', 'city', 'geonames', '901', { capital: false }), continent: 'South America', population: 9_000_000 },
    { ...entity('geonames:city:902', 'city', 'geonames', '902', { capital: false }), continent: 'Oceania', population: 2_000_000 }
  ]

  const build = async (input) => buildPublicDataset({
    sources: ['geonames'], types: ['city'], limit: 3,
    fetchGeoNames: async () => input,
    enrichGeoNames: noGeoNamesEnrichment
  })

  const first = await build(cities)
  const second = await build([...cities].reverse())

  assert.deepEqual(first.entities.map((item) => item.id), [
    'geonames:city:900',
    'geonames:city:901',
    'geonames:city:902'
  ])
  assert.deepEqual(second.entities.map((item) => item.id), first.entities.map((item) => item.id))
  assert.ok(first.entities.some((item) => item.continent === 'North America'))
  assert.ok(first.entities.some((item) => item.continent === 'South America'))
})

test('buildPublicDataset enriches only GeoNames entities that survive representative selection', async () => {
  const cities = [
    { ...entity('geonames:city:10', 'city', 'geonames', '10', { capital: false }), population: 10_000 },
    { ...entity('geonames:city:20', 'city', 'geonames', '20', { capital: true }), population: 100_000 },
    { ...entity('geonames:city:30', 'city', 'geonames', '30', { capital: false }), population: 9_000_000 }
  ]
  let selectedIds = null

  const result = await buildPublicDataset({
    sources: ['geonames'], types: ['city'], limit: 2,
    fetchGeoNames: async () => cities,
    enrichGeoNames: async (selected) => {
      selectedIds = selected.map((item) => item.sourceId)
      return selected.map((item) => item.id === 'geonames:city:20'
        ? { ...item, name: { ...item.name, vi: 'Thủ đô thử nghiệm' } }
        : item)
    }
  })

  assert.deepEqual(selectedIds, ['20', '30'])
  assert.equal(result.entities.find((item) => item.id === 'geonames:city:20').name.vi, 'Thủ đô thử nghiệm')
})

test('buildPublicDataset reports geographic and explicit bilingual coverage in the manifest', async () => {
  const cities = [
    {
      ...entity('geonames:city:1', 'city', 'geonames', '1'),
      continent: 'North America', countryCode: 'US',
      languageProvenance: { name_en: 'geonames_fallback' }
    },
    {
      ...entity('geonames:city:2', 'city', 'geonames', '2'),
      name: { en: 'São Paulo', vi: 'São Paulo' }, continent: 'South America', countryCode: 'BR',
      languageProvenance: { name_en: 'geonames_alternate', name_vi: 'geonames_alternate' }
    },
    {
      ...entity('geonames:city:3', 'city', 'geonames', '3'),
      name: { en: 'Tokyo', vi: 'Tokyo' }, description: { en: 'capital city', vi: null },
      continent: 'Asia', countryCode: 'JP',
      languageProvenance: { name_en: 'whosonfirst', name_vi: 'whosonfirst', description_en: 'geonames' }
    }
  ]

  const result = await buildPublicDataset({
    sources: ['geonames'], types: ['city'],
    fetchGeoNames: async () => cities,
    enrichGeoNames: noGeoNamesEnrichment
  })

  assert.deepEqual(result.manifest.coverage.continents, {
    Africa: 0, Antarctica: 0, Asia: 1, Europe: 0,
    'North America': 1, Oceania: 0, 'South America': 1
  })
  assert.deepEqual(result.manifest.coverage.countries, { BR: 1, JP: 1, US: 1 })
  assert.deepEqual(result.manifest.coverage.languages, {
    name_en: 2,
    name_en_present: 3,
    name_en_fallback: 1,
    name_vi: 2,
    description_en: 1,
    description_vi: 0,
    vi_legacy_texts: 0
  })
})

test('buildPublicDataset reports remaining legacy Vietnamese D-stroke text for QA', async () => {
  const cities = [
    {
      ...entity('geonames:city:1', 'city', 'geonames', '1'),
      name: { en: 'Da Lat', vi: 'Ðà Lạt' }, aliases: { en: [], vi: ['thành phố ðà lạt'] },
      continent: 'Asia', countryCode: 'VN',
      languageProvenance: { name_en: 'geonames_fallback', name_vi: 'geonames_alternate' }
    }
  ]

  const result = await buildPublicDataset({
    sources: ['geonames'], types: ['city'],
    fetchGeoNames: async () => cities,
    enrichGeoNames: noGeoNamesEnrichment
  })

  assert.equal(result.manifest.coverage.languages.vi_legacy_texts, 2)
})

test('buildPublicDataset fails fast when a large city dataset loses an American continent', async () => {
  const cities = Array.from({ length: 5_000 }, (_, index) => ({
    ...entity(`geonames:city:${index + 1}`, 'city', 'geonames', String(index + 1), { capital: false }),
    continent: 'Asia', countryCode: 'ZZ', population: 50_000 + index
  }))

  await assert.rejects(
    () => buildPublicDataset({
      sources: ['geonames'], types: ['city'],
      fetchGeoNames: async () => cities,
      enrichGeoNames: noGeoNamesEnrichment
    }),
    /coverage check failed.*North America/i
  )
})

test('GeoNames skips unsupported landmark type but reports it in manifest', async () => {
  let calls = 0
  const result = await buildPublicDataset({
    sources: ['geonames'], types: ['landmark'],
    fetchGeoNames: async () => { calls += 1; return [] }
  })
  assert.equal(calls, 0)
  assert.deepEqual(result.manifest.skipped, [{ source: 'geonames', type: 'landmark', reason: 'unsupported_type' }])
})

test('GeoNames remains fail-fast while WOF is explicitly best-effort in dataQuality policy', async () => {
  const result = await buildPublicDataset({
    sources: ['geonames'], types: ['city'],
    fetchGeoNames: async () => [entity('geonames:city:1', 'city', 'geonames', '1')],
    enrichGeoNames: noGeoNamesEnrichment
  })
  assert.deepEqual(result.manifest.dataQuality, {
    policy: 'geonames_fail_fast_wof_best_effort',
    issueCount: 0, issues: [], truncated: false,
    checks: { duplicateEntityIds: 0, duplicateSourceRefs: 0, viLegacyTexts: 0 }
  })
  assert.equal(result.manifest.version, 6)
})

test('buildPublicDataset reports identity and Vietnamese legacy invariant violations in dataQuality', async () => {
  const first = { ...entity('geonames:city:1', 'city', 'geonames', '1'), continent: 'Asia', countryCode: 'VN' }
  const second = {
    ...entity('geonames:city:2', 'city', 'geonames', '2'), continent: 'Asia', countryCode: 'VN',
    name: { en: 'Da Lat', vi: 'Ðà Lạt' },
    languageProvenance: { name_en: 'geonames_fallback', name_vi: 'whosonfirst' }
  }

  const result = await buildPublicDataset({
    sources: ['geonames', 'wof'], types: ['city'],
    fetchGeoNames: async () => [first, second],
    enrichGeoNames: noGeoNamesEnrichment,
    enrichWof: async (entities) => ({
      entities: entities.map((item) => ({
        ...item,
        sourceRefs: [...item.sourceRefs, { source: 'whosonfirst', sourceId: '85923799' }]
      })),
      report: { status: 'ok', requested: 2, matched: 2, ambiguous: 0, invalid: 0 }
    })
  })

  assert.deepEqual(result.manifest.dataQuality.checks, {
    duplicateEntityIds: 0,
    duplicateSourceRefs: 1,
    viLegacyTexts: 1
  })
  assert.equal(result.manifest.dataQuality.issueCount, 2)
  assert.deepEqual(result.manifest.dataQuality.issues.map((issue) => issue.code).sort(), [
    'duplicate_source_ref', 'vi_legacy_text'
  ])
})

test('buildPublicDataset applies WOF only after representative GeoNames language enrichment', async () => {
  const cities = [
    { ...entity('geonames:city:10', 'city', 'geonames', '10', { capital: false }), population: 10_000 },
    { ...entity('geonames:city:20', 'city', 'geonames', '20', { capital: true }), population: 100_000 },
    { ...entity('geonames:city:30', 'city', 'geonames', '30', { capital: false }), population: 9_000_000 }
  ]
  const calls = []

  const result = await buildPublicDataset({
    sources: ['geonames', 'wof'], types: ['city'], limit: 2,
    fetchGeoNames: async () => cities,
    enrichGeoNames: async (selected) => {
      calls.push(['geonames', selected.map((item) => item.sourceId)])
      return selected.map((item) => item.id === 'geonames:city:20'
        ? { ...item, name: { ...item.name, vi: 'GeoNames VI' } }
        : item)
    },
    enrichWof: async (selected) => {
      calls.push(['wof', selected.map((item) => item.sourceId), selected.find((item) => item.sourceId === '20')?.name.vi])
      return {
        entities: selected.map((item) => item.id === 'geonames:city:20'
          ? { ...item, name: { en: 'WOF English', vi: 'WOF Vietnamese' } }
          : item),
        report: { status: 'ok', requested: selected.length, matched: 1, ambiguous: 0, invalid: 0 }
      }
    }
  })

  assert.deepEqual(calls, [
    ['geonames', ['20', '30']],
    ['wof', ['20', '30'], 'GeoNames VI']
  ])
  assert.equal(result.entities.find((item) => item.sourceId === '20').name.vi, 'WOF Vietnamese')
  assert.equal(result.manifest.wofEnrichment.status, 'ok')
  assert.equal(result.manifest.wofEnrichment.matched, 1)
  assert.equal(result.manifest.sourceCounts.wof, 1)
})

test('WOF source failure is quarantined and preserves the GeoNames build', async () => {
  const cities = [{ ...entity('geonames:city:1', 'city', 'geonames', '1'), continent: 'Asia', countryCode: 'VN' }]
  const result = await buildPublicDataset({
    sources: ['geonames', 'wof'], types: ['city'],
    fetchGeoNames: async () => cities,
    enrichGeoNames: noGeoNamesEnrichment,
    enrichWof: async () => { throw new Error('archive unavailable') }
  })

  assert.equal(result.entities.length, 1)
  assert.equal(result.entities[0].id, 'geonames:city:1')
  assert.equal(result.manifest.wofEnrichment.status, 'unavailable')
  assert.equal(result.manifest.wofEnrichment.scanned, 0)
  assert.equal(result.manifest.wofEnrichment.skippedUnmatched, 0)
  assert.match(result.manifest.wofEnrichment.error, /archive unavailable/)
})

test('GeoNames-only build keeps WOF disabled in manifest', async () => {
  const result = await buildPublicDataset({
    sources: ['geonames'], types: ['city'],
    fetchGeoNames: async () => [entity('geonames:city:1', 'city', 'geonames', '1')],
    enrichGeoNames: noGeoNamesEnrichment,
    enrichWof: noWofEnrichment
  })
  assert.equal(result.manifest.wofEnrichment.status, 'disabled')
  assert.equal(result.manifest.wofEnrichment.scanned, 0)
  assert.equal(result.manifest.wofEnrichment.skippedUnmatched, 0)
  assert.equal(result.manifest.sourceCounts.wof, 0)
})
