import { normalizeEntity } from '../domain/entity.js'

const CONTINENTS = new Map([
  ['AF', 'Africa'],
  ['AN', 'Antarctica'],
  ['AS', 'Asia'],
  ['EU', 'Europe'],
  ['NA', 'North America'],
  ['OC', 'Oceania'],
  ['SA', 'South America']
])

function text(value) {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function finiteNumber(value, field, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const normalized = text(value)
  if (normalized == null) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    throw new TypeError(`GeoNames ${field} is invalid`)
  }
  return parsed
}

function assertCleanText(value, context) {
  if (String(value).includes('\uFFFD')) throw new TypeError(`GeoNames ${context} contains a Unicode replacement character`)
}

export function parseGeoNamesCityLine(line) {
  assertCleanText(line, 'city row')
  const columns = String(line).replace(/\r$/, '').split('\t')
  if (columns.length !== 19) throw new TypeError('GeoNames city row must contain 19 tab-delimited columns')

  const [
    geonameId, name, asciiName, alternateNames, latitude, longitude, featureClass, featureCode,
    countryCode, alternateCountryCodes, admin1Code, admin2Code, admin3Code, admin4Code,
    population, elevation, dem, timezone, modificationDate
  ] = columns

  if (!/^\d+$/.test(geonameId)) throw new TypeError('GeoNames geonameId is invalid')
  if (!text(name)) throw new TypeError('GeoNames city name is required')
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new TypeError('GeoNames country code is invalid')

  return {
    geonameId,
    name: text(name),
    asciiName: text(asciiName),
    alternateNames: text(alternateNames),
    latitude: finiteNumber(latitude, 'latitude', { min: -90, max: 90 }),
    longitude: finiteNumber(longitude, 'longitude', { min: -180, max: 180 }),
    featureClass: text(featureClass),
    featureCode: text(featureCode),
    countryCode,
    alternateCountryCodes: text(alternateCountryCodes),
    admin1Code: text(admin1Code),
    admin2Code: text(admin2Code),
    admin3Code: text(admin3Code),
    admin4Code: text(admin4Code),
    population: finiteNumber(population, 'population', { integer: true, min: 0 }),
    elevation: finiteNumber(elevation, 'elevation', { integer: true }),
    dem: finiteNumber(dem, 'dem', { integer: true }),
    timezone: text(timezone),
    modificationDate: text(modificationDate)
  }
}

export function parseGeoNamesCountryInfo(contents) {
  assertCleanText(contents, 'countryInfo')
  const countries = new Map()
  for (const rawLine of String(contents).split(/\n/)) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith('#')) continue
    const columns = line.split('\t')
    if (columns.length < 17) throw new TypeError('GeoNames countryInfo row is malformed')
    const [
      iso2, iso3, isoNumeric, fips, countryName, capital, areaKm2, population, continentCode,
      tld, currencyCode, currencyName, phone, postalCodeFormat, postalCodeRegex, languages,
      geonameId, neighbours = '', equivalentFipsCode = ''
    ] = columns
    if (!/^[A-Z]{2}$/.test(iso2) || !/^\d+$/.test(geonameId)) {
      throw new TypeError('GeoNames countryInfo identity is invalid')
    }
    countries.set(iso2, {
      iso2,
      iso3: text(iso3),
      isoNumeric: text(isoNumeric),
      fips: text(fips),
      countryName: text(countryName),
      capital: text(capital),
      areaKm2: finiteNumber(areaKm2, 'country area', { min: 0 }),
      population: finiteNumber(population, 'country population', { integer: true, min: 0 }),
      continentCode: text(continentCode),
      tld: text(tld),
      currencyCode: text(currencyCode),
      currencyName: text(currencyName),
      phone: text(phone),
      postalCodeFormat: text(postalCodeFormat),
      postalCodeRegex: text(postalCodeRegex),
      languages: String(languages ?? '').split(',').map((item) => item.trim()).filter(Boolean),
      geonameId,
      neighbours: String(neighbours ?? '').split(',').map((item) => item.trim()).filter(Boolean),
      equivalentFipsCode: text(equivalentFipsCode)
    })
  }
  return countries
}

export function parseGeoNamesAdmin1Codes(contents) {
  assertCleanText(contents, 'admin1CodesASCII')
  const admin1 = new Map()
  for (const rawLine of String(contents).split(/\n/)) {
    const line = rawLine.replace(/\r$/, '')
    if (!line) continue
    const columns = line.split('\t')
    if (columns.length !== 4) throw new TypeError('GeoNames admin1 row must contain 4 tab-delimited columns')
    const [code, name, asciiName, geonameId] = columns
    if (!code || !/^\d+$/.test(geonameId)) throw new TypeError('GeoNames admin1 identity is invalid')
    admin1.set(code, { code, name: text(name), asciiName: text(asciiName), geonameId })
  }
  return admin1
}

export function normalizeGeoNamesCity(record, { countries = new Map(), admin1 = new Map() } = {}) {
  if (!record || typeof record !== 'object' || !/^\d+$/.test(String(record.geonameId ?? ''))) {
    throw new TypeError('GeoNames city requires a stable geonameId')
  }
  const country = countries.get(record.countryCode)
  const admin1Record = record.admin1Code ? admin1.get(`${record.countryCode}.${record.admin1Code}`) : null
  return normalizeEntity({
    id: `geonames:city:${record.geonameId}`,
    type: 'city',
    name: { en: record.name, vi: null },
    aliases: { en: [], vi: [] },
    languageProvenance: { name_en: 'geonames_fallback' },
    continent: CONTINENTS.get(country?.continentCode) ?? null,
    region: admin1Record?.name ?? null,
    countryCode: record.countryCode,
    population: record.population,
    facts: {
      country: country?.countryName ?? null,
      localName: record.name,
      ...(record.asciiName && record.asciiName !== record.name ? { asciiName: record.asciiName } : {}),
      capital: record.featureCode === 'PPLC',
      latitude: record.latitude,
      longitude: record.longitude,
      timezone: record.timezone,
      featureCode: record.featureCode,
      admin1Code: record.admin1Code,
      admin2Code: record.admin2Code,
      admin3Code: record.admin3Code,
      admin4Code: record.admin4Code,
      elevation: record.elevation,
      dem: record.dem,
      modificationDate: record.modificationDate
    },
    source: 'geonames',
    sourceId: String(record.geonameId)
  })
}

export function normalizeGeoNamesCountry(record) {
  if (!record || typeof record !== 'object' || !/^\d+$/.test(String(record.geonameId ?? ''))) {
    throw new TypeError('GeoNames country requires a stable geonameId')
  }
  return normalizeEntity({
    id: `geonames:country:${record.geonameId}`,
    type: 'country',
    name: { en: record.countryName, vi: null },
    continent: CONTINENTS.get(record.continentCode) ?? null,
    countryCode: record.iso2,
    population: record.population,
    facts: {
      capital: record.capital,
      currency: record.currencyName,
      languages: record.languages,
      iso3: record.iso3
    },
    source: 'geonames',
    sourceId: String(record.geonameId)
  })
}
