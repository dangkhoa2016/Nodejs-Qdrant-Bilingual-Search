import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGeoNamesCityLine,
  parseGeoNamesCountryInfo,
  parseGeoNamesAdmin1Codes,
  normalizeGeoNamesCity,
  normalizeGeoNamesCountry
} from '../../src/dataset/geonames-normalizer.js'

const cityLine = [
  '1581130', 'Hanoi', 'Hanoi', 'Ha Noi,Hà Nội', '21.0245', '105.84117', 'P', 'PPLC', 'VN', '',
  '01', '', '', '', '8053663', '20', '16', 'Asia/Ho_Chi_Minh', '2026-08-01'
].join('\t')

const countryInfoText = [
  '#ISO\tISO3\tISO-Numeric\tfips\tCountry\tCapital\tArea(in sq km)\tPopulation\tContinent\ttld\tCurrencyCode\tCurrencyName\tPhone\tPostal Code Format\tPostal Code Regex\tLanguages\tgeonameid\tneighbours\tEquivalentFipsCode',
  'VN\tVNM\t704\tVM\tVietnam\tHanoi\t329560\t97338579\tAS\t.vn\tVND\tDong\t84\t######\t^(\\d{6})$\tvi,en,fr,zh,km\t1562822\tCN,LA,KH\t'
].join('\n')

const admin1Text = 'VN.01\tHanoi\tHanoi\t1903516\n'

test('GeoNames cities15000 row normalizes into a stable canonical city with geographic facts', () => {
  const city = parseGeoNamesCityLine(cityLine)
  const countries = parseGeoNamesCountryInfo(countryInfoText)
  const admin1 = parseGeoNamesAdmin1Codes(admin1Text)
  const entity = normalizeGeoNamesCity(city, { countries, admin1 })

  assert.equal(entity.id, 'geonames:city:1581130')
  assert.equal(entity.source, 'geonames')
  assert.equal(entity.sourceId, '1581130')
  assert.deepEqual(entity.name, { en: 'Hanoi', vi: null })
  assert.equal(entity.region, 'Hanoi')
  assert.equal(entity.continent, 'Asia')
  assert.equal(entity.countryCode, 'VN')
  assert.equal(entity.population, 8053663)
  assert.deepEqual(entity.aliases.en, [])
  assert.deepEqual(entity.facts, {
    country: 'Vietnam', localName: 'Hanoi', capital: true, latitude: 21.0245, longitude: 105.84117,
    timezone: 'Asia/Ho_Chi_Minh', featureCode: 'PPLC', admin1Code: '01', admin2Code: null,
    admin3Code: null, admin4Code: null, elevation: 20, dem: 16, modificationDate: '2026-08-01'
  })
  assert.equal(entity.languageProvenance.name_en, 'geonames_fallback')
  assert.equal(entity.languageProvenance.name_vi, 'missing')
})

test('GeoNames countryInfo produces country entities and expands continent codes', () => {
  const countries = parseGeoNamesCountryInfo(countryInfoText)
  const entity = normalizeGeoNamesCountry(countries.get('VN'))

  assert.equal(entity.id, 'geonames:country:1562822')
  assert.equal(entity.name.en, 'Vietnam')
  assert.equal(entity.continent, 'Asia')
  assert.equal(entity.countryCode, 'VN')
  assert.equal(entity.population, 97338579)
  assert.equal(entity.facts.capital, 'Hanoi')
  assert.equal(entity.facts.currency, 'Dong')
  assert.deepEqual(entity.facts.languages, ['vi', 'en', 'fr', 'zh', 'km'])
  assert.equal(entity.facts.iso3, 'VNM')
})

test('GeoNames parser fails fast on malformed city rows instead of repairing source data', () => {
  assert.throws(() => parseGeoNamesCityLine('1581130\tHanoi'), /19 tab-delimited columns/)
  const badUtf8Replacement = cityLine.replace('Hanoi', 'Ha�noi')
  assert.throws(() => parseGeoNamesCityLine(badUtf8Replacement), /replacement character/)
})

test('GeoNames asciiname is preserved as source metadata, not mislabeled as an English alias', () => {
  const accented = parseGeoNamesCityLine([
    '3448439', 'São Paulo', 'Sao Paulo', 'Sampa', '-23.5475', '-46.63611', 'P', 'PPLA', 'BR', '',
    '27', '', '', '', '12400232', '760', '769', 'America/Sao_Paulo', '2026-08-01'
  ].join('\t'))
  const countries = parseGeoNamesCountryInfo([
    'BR\tBRA\t076\tBR\tBrazil\tBrasilia\t8511965\t212559417\tSA\t.br\tBRL\tReal\t55\t\t\tpt-BR\t3469034\t\t'
  ].join('\n'))
  const admin1 = parseGeoNamesAdmin1Codes('BR.27\tSão Paulo\tSao Paulo\t3448433\n')

  const entity = normalizeGeoNamesCity(accented, { countries, admin1 })

  assert.deepEqual(entity.aliases.en, [])
  assert.equal(entity.facts.asciiName, 'Sao Paulo')
})
