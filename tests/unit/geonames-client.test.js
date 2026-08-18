import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchGeoNamesEntities, GEONAMES_URLS } from '../../src/dataset/geonames-client.js'
import * as geoNamesModule from '../../src/dataset/geonames-client.js'

const cityText = [
  ['1581130','Hanoi','Hanoi','','21.0245','105.84117','P','PPLC','VN','','01','','','','8053663','20','16','Asia/Ho_Chi_Minh','2026-08-01'].join('\t'),
  ['1668341','Taipei','Taipei','','25.04776','121.53185','P','PPLC','TW','','03','','','','7871900','10','8','Asia/Taipei','2026-08-01'].join('\t')
].join('\n')
const countryText = [
  'VN\tVNM\t704\tVM\tVietnam\tHanoi\t329560\t97338579\tAS\t.vn\tVND\tDong\t84\t\t\tvi,en\t1562822\tCN,LA,KH\t',
  'TW\tTWN\t158\tTW\tTaiwan\tTaipei\t35980\t22894384\tAS\t.tw\tTWD\tDollar\t886\t\t\tzh-TW,zh,nan,hak\t1668284\t\t'
].join('\n')
const admin1Text = 'VN.01\tHanoi\tHanoi\t1903516\nTW.03\tTaipei\tTaipei\t1665148\n'

function response(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8')
  return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
}

test('GeoNames client uses cities15000 plus small country/admin reference files', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    if (url === GEONAMES_URLS.cities15000) return response(Buffer.from('fake zip'))
    if (url === GEONAMES_URLS.countryInfo) return response(countryText)
    if (url === GEONAMES_URLS.admin1Codes) return response(admin1Text)
    throw new Error(`unexpected URL ${url}`)
  }

  const entities = await fetchGeoNamesEntities({
    type: 'city', fetchImpl, extractCitiesText: async () => cityText
  })

  assert.deepEqual(seen.sort(), [GEONAMES_URLS.admin1Codes, GEONAMES_URLS.cities15000, GEONAMES_URLS.countryInfo].sort())
  assert.equal(entities.length, 2)
  assert.equal(entities[0].id, 'geonames:city:1581130')
  assert.equal(entities[0].region, 'Hanoi')
})

test('GeoNames country source is built from countryInfo without downloading cities15000', async () => {
  const seen = []
  const entities = await fetchGeoNamesEntities({
    type: 'country',
    fetchImpl: async (url) => { seen.push(String(url)); return response(countryText) }
  })
  assert.deepEqual(seen, [GEONAMES_URLS.countryInfo])
  assert.equal(entities.length, 2)
  assert.equal(entities[0].type, 'country')
})

test('GeoNames client rejects unsupported types and HTTP failures', async () => {
  await assert.rejects(() => fetchGeoNamesEntities({ type: 'landmark' }), /country or city/)
  await assert.rejects(
    () => fetchGeoNamesEntities({ type: 'country', fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/
  )
})


test('GeoNames alternate-name enrichment selects preferred EN/VI names and ignores unselected IDs', async () => {
  assert.equal(typeof geoNamesModule.enrichGeoNamesAlternateNames, 'function')

  const base = [
    {
      id: 'geonames:city:2886242', type: 'city', source: 'geonames', sourceId: '2886242',
      name: { en: 'Köln', vi: null }, description: { en: null, vi: null }, aliases: { en: [], vi: [] },
      continent: 'Europe', region: null, countryCode: 'DE', population: 1_000_000,
      facts: { localName: 'Köln', capital: false },
      languageProvenance: { name_en: 'geonames', name_vi: 'missing', description_en: 'missing', description_vi: 'missing' }
    }
  ]
  const lines = [
    '0\t2886242\t\tKöln local fallback\t\t\t\t\t\t',
    '1\t2886242\ten\tCologne\t1\t\t\t\t\t',
    '2\t2886242\ten\tKoeln\t\t\t\t\t\t',
    '3\t2886242\tvi\tKöln\t1\t\t\t\t\t',
    '4\t9999999\tvi\tKhông được giữ\t1\t\t\t\t\t'
  ]

  const result = await geoNamesModule.enrichGeoNamesAlternateNames(base, {
    streamLines: async function * () { for (const line of lines) yield line }
  })

  assert.deepEqual(result[0].name, { en: 'Cologne', vi: 'Köln' })
  assert.deepEqual(result[0].aliases.en, ['Koeln'])
  assert.equal(result[0].languageProvenance.name_en, 'geonames_alternate')
  assert.equal(result[0].languageProvenance.name_vi, 'geonames_alternate')
})


test('GeoNames alternate-name enrichment normalizes legacy Vietnamese D-stroke only for vi rows', async () => {
  const base = [
    {
      id: 'geonames:city:1584071', type: 'city', source: 'geonames', sourceId: '1584071',
      name: { en: 'Da Lat', vi: null }, description: { en: null, vi: null }, aliases: { en: [], vi: [] },
      continent: 'Asia', region: 'Lam Dong', countryCode: 'VN', population: 200_000,
      facts: { localName: 'Ðà Lạt', capital: false },
      languageProvenance: { name_en: 'geonames_fallback', name_vi: 'missing', description_en: 'missing', description_vi: 'missing' }
    }
  ]
  const lines = [
    '10\t1584071\ten\tÐà Lạt English-tagged\t1\t\t\t\t\t',
    '11\t1584071\tvi\tÐà Lạt\t1\t\t\t\t\t',
    '12\t1584071\tvi\tthành phố ðà lạt\t\t\t\t\t\t'
  ]

  const result = await geoNamesModule.enrichGeoNamesAlternateNames(base, {
    streamLines: async function * () { for (const line of lines) yield line }
  })

  assert.equal(result[0].name.en, 'Ðà Lạt English-tagged')
  assert.equal(result[0].name.vi, 'Đà Lạt')
  assert.deepEqual(result[0].aliases.vi, ['thành phố đà lạt'])
  assert.equal(result[0].facts.localName, 'Ðà Lạt')
})
