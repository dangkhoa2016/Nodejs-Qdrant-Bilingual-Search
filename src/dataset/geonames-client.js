import { execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline'
import { normalizeEntity } from '../domain/entity.js'
import {
  normalizeGeoNamesCity,
  normalizeGeoNamesCountry,
  parseGeoNamesAdmin1Codes,
  parseGeoNamesCityLine,
  parseGeoNamesCountryInfo
} from './geonames-normalizer.js'

const BASE_URL = 'https://download.geonames.org/export/dump'

export const GEONAMES_URLS = Object.freeze({
  cities15000: `${BASE_URL}/cities15000.zip`,
  alternateNamesV2: `${BASE_URL}/alternateNamesV2.zip`,
  countryInfo: `${BASE_URL}/countryInfo.txt`,
  admin1Codes: `${BASE_URL}/admin1CodesASCII.txt`
})

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new TypeError(`GeoNames ${label} is not valid UTF-8`, { cause: error })
  }
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/octet-stream, text/plain;q=0.9' } })
  if (!response.ok) throw new Error(`GeoNames download returned HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function extractCities15000Text(archiveBytes) {
  const directory = await mkdtemp(join(tmpdir(), 'geonames-cities15000-'))
  const archivePath = join(directory, 'cities15000.zip')
  try {
    await writeFile(archivePath, archiveBytes)
    const stdout = await new Promise((resolve, reject) => {
      execFile('unzip', ['-p', archivePath, 'cities15000.txt'], { encoding: null, maxBuffer: 64 * 1024 * 1024 }, (error, output, stderr) => {
        if (error) {
          const detail = Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : String(stderr ?? '').trim()
          reject(new Error(`Unable to extract GeoNames cities15000.zip with unzip${detail ? `: ${detail}` : ''}`, { cause: error }))
          return
        }
        resolve(output)
      })
    })
    return decodeUtf8(stdout, 'cities15000.txt')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function fetchGeoNamesEntities({
  type,
  fetchImpl = fetch,
  extractCitiesText = extractCities15000Text,
  urls = GEONAMES_URLS
}) {
  if (!['country', 'city'].includes(type)) throw new TypeError('GeoNames type must be country or city')

  if (type === 'country') {
    const countryBytes = await fetchBytes(urls.countryInfo, fetchImpl)
    const countries = parseGeoNamesCountryInfo(decodeUtf8(countryBytes, 'countryInfo.txt'))
    return [...countries.values()].map((record) => normalizeGeoNamesCountry(record))
  }

  const [archiveBytes, countryBytes, admin1Bytes] = await Promise.all([
    fetchBytes(urls.cities15000, fetchImpl),
    fetchBytes(urls.countryInfo, fetchImpl),
    fetchBytes(urls.admin1Codes, fetchImpl)
  ])
  const [citiesText, countries, admin1] = await Promise.all([
    extractCitiesText(archiveBytes),
    Promise.resolve(parseGeoNamesCountryInfo(decodeUtf8(countryBytes, 'countryInfo.txt'))),
    Promise.resolve(parseGeoNamesAdmin1Codes(decodeUtf8(admin1Bytes, 'admin1CodesASCII.txt')))
  ])

  const entities = []
  for (const rawLine of String(citiesText).split(/\n/)) {
    const line = rawLine.replace(/\r$/, '')
    if (!line) continue
    const record = parseGeoNamesCityLine(line)
    entities.push(normalizeGeoNamesCity(record, { countries, admin1 }))
  }
  return entities
}

function geoNamesIdForEntity(entity) {
  const ref = entity.sourceRefs?.find((item) => item.source === 'geonames')
  const value = ref?.sourceId ?? (entity.source === 'geonames' ? entity.sourceId : null)
  return value != null && /^\d+$/.test(String(value)) ? String(value) : null
}

function normalizeGeoNamesAlternateName(language, value) {
  const text = String(value).trim()
  if (language !== 'vi') return text
  return text.replaceAll('Ð', 'Đ').replaceAll('ð', 'đ')
}

function parseAlternateNameLine(line) {
  if (String(line).includes('\uFFFD')) throw new TypeError('GeoNames alternateNamesV2 row contains a Unicode replacement character')
  const columns = String(line).replace(/\r$/, '').split('\t')
  if (columns.length !== 10) throw new TypeError('GeoNames alternateNamesV2 row must contain 10 tab-delimited columns')
  const [alternateNameId, geonameId, language, name, preferred, shortName, colloquial, historic, from, to] = columns
  if (!/^\d+$/.test(alternateNameId) || !/^\d+$/.test(geonameId)) throw new TypeError('GeoNames alternate name identity is invalid')
  if (!['', '1'].includes(preferred) || !['', '1'].includes(shortName) || !['', '1'].includes(colloquial) || !['', '1'].includes(historic)) {
    throw new TypeError('GeoNames alternate name flags are invalid')
  }
  if (!language || !name.trim()) throw new TypeError('GeoNames alternate name language and text are required')
  return {
    alternateNameId,
    geonameId,
    language,
    name: normalizeGeoNamesAlternateName(language, name),
    preferred: preferred === '1',
    shortName: shortName === '1',
    colloquial: colloquial === '1',
    historic: historic === '1',
    from: from || null,
    to: to || null
  }
}

async function downloadAlternateNamesArchive(url, archivePath, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/zip, application/octet-stream' } })
  if (!response.ok) throw new Error(`GeoNames download returned HTTP ${response.status}`)
  if (response.body) {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath))
    return
  }
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()))
}

export async function * streamGeoNamesAlternateNamesV2({
  fetchImpl = fetch,
  url = GEONAMES_URLS.alternateNamesV2
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'geonames-alternate-names-'))
  const archivePath = join(directory, 'alternateNamesV2.zip')
  try {
    await downloadAlternateNamesArchive(url, archivePath, fetchImpl)
    const child = spawn('unzip', ['-p', archivePath, 'alternateNamesV2.txt'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => code === 0
        ? resolve()
        : reject(new Error(`Unable to extract GeoNames alternateNamesV2.zip with unzip${stderr.trim() ? `: ${stderr.trim()}` : ''}`)))
    })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    for await (const line of lines) yield line
    await exit
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function bestCurrentName(entries) {
  const current = entries.filter((entry) => !entry.historic)
  if (!current.length) return null
  return [...current].sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
    if (a.shortName !== b.shortName) return a.shortName ? -1 : 1
    return Number(a.alternateNameId) - Number(b.alternateNameId)
  })[0]
}

function mergeLanguageAliases(existing, entries, primary) {
  const values = [...existing]
  for (const entry of entries) {
    if (entry.historic || entry.name === primary || values.includes(entry.name)) continue
    values.push(entry.name)
  }
  return values
}

export async function enrichGeoNamesAlternateNames(entities, {
  streamLines = streamGeoNamesAlternateNamesV2
} = {}) {
  const selected = new Map()
  for (const entity of entities) {
    const geonameId = geoNamesIdForEntity(entity)
    if (geonameId) selected.set(geonameId, { en: [], vi: [] })
  }
  if (!selected.size) return entities

  for await (const line of streamLines()) {
    const firstTab = line.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : line.indexOf('\t', firstTab + 1)
    if (secondTab < 0) continue
    const geonameId = line.slice(firstTab + 1, secondTab)
    const bucket = selected.get(geonameId)
    if (!bucket) continue
    const thirdTab = line.indexOf('\t', secondTab + 1)
    if (thirdTab < 0) continue
    const language = line.slice(secondTab + 1, thirdTab)
    if (language !== 'en' && language !== 'vi') continue
    const record = parseAlternateNameLine(line)
    bucket[record.language].push(record)
  }

  return entities.map((entity) => {
    const geonameId = geoNamesIdForEntity(entity)
    const bucket = geonameId ? selected.get(geonameId) : null
    if (!bucket) return entity

    const en = bestCurrentName(bucket.en)
    const vi = bestCurrentName(bucket.vi)
    const canReplaceEn = ['geonames', 'geonames_fallback', 'missing'].includes(entity.languageProvenance?.name_en)
    const canReplaceVi = ['geonames', 'geonames_fallback', 'missing'].includes(entity.languageProvenance?.name_vi)
    const nameEn = en && canReplaceEn ? en.name : entity.name.en
    const nameVi = vi && canReplaceVi ? vi.name : entity.name.vi
    return normalizeEntity({
      ...entity,
      name: { en: nameEn, vi: nameVi },
      aliases: {
        en: mergeLanguageAliases(entity.aliases.en, bucket.en, nameEn),
        vi: mergeLanguageAliases(entity.aliases.vi, bucket.vi, nameVi)
      },
      languageProvenance: {
        ...entity.languageProvenance,
        ...(en && canReplaceEn ? { name_en: 'geonames_alternate' } : {}),
        ...(vi && canReplaceVi ? { name_vi: 'geonames_alternate' } : {})
      }
    })
  })
}
