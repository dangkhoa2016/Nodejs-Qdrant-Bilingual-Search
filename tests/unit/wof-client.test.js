import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { normalizeEntity } from '../../src/domain/entity.js'
import { collectWofCandidatesFromTarStream } from '../../src/dataset/wof-tar.js'
import {
  collectWofCandidatesFromJsonStream,
  enrichGeoNamesWithWofCandidates
} from '../../src/dataset/wof-client.js'

function geo(id, { en = `Geo ${id}`, vi = null, enProv = 'geonames_alternate', viProv = 'missing' } = {}) {
  return normalizeEntity({
    id: `geonames:city:${id}`,
    type: 'city',
    name: { en, vi },
    description: { en: null, vi: null },
    aliases: { en: [], vi: [] },
    continent: 'Asia', region: null, countryCode: 'VN', population: 10,
    facts: { localName: en, latitude: 1, longitude: 2 },
    source: 'geonames', sourceId: String(id),
    languageProvenance: { name_en: enProv, name_vi: viProv, description_en: 'missing', description_vi: 'missing' }
  })
}

test('collectWofCandidatesFromJsonStream handles concatenated GeoJSON objects across arbitrary chunks', async () => {
  const a = JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 11, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten'], 'name:vie_x_preferred': ['Mười']
  }, geometry: { type: 'Point', coordinates: [1, 2] } })
  const b = JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 22, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '20' },
    'name:eng_x_preferred': ['Twenty']
  }, geometry: null })
  const joined = `${a}${b}`
  const chunks = [joined.slice(0, 17), joined.slice(17, 83), joined.slice(83, 151), joined.slice(151)]
  const result = await collectWofCandidatesFromJsonStream(Readable.from(chunks), {
    type: 'city', targetIds: new Set(['10'])
  })

  assert.equal(result.invalid, 0)
  assert.equal(result.candidates.size, 1)
  assert.equal(result.candidates.get('10')[0].wofId, '11')
})

test('enrichGeoNamesWithWofCandidates keeps explicit GeoNames VI while WOF still enriches EN and VI aliases', () => {
  const entity = geo('10', { en: 'Geo English', vi: 'Geo Vietnamese', viProv: 'geonames_alternate' })
  const candidates = new Map([['10', [{
    wofId: '101', placetype: 'locality', geonamesIds: ['10'],
    name: { en: 'WOF English', vi: 'WOF Vietnamese' },
    aliases: { en: ['WOF EN alias'], vi: ['WOF VI alias'] }
  }]]])
  const { entities, report } = enrichGeoNamesWithWofCandidates([entity], candidates)
  const enriched = entities[0]

  assert.equal(enriched.id, 'geonames:city:10')
  assert.deepEqual(enriched.name, { en: 'WOF English', vi: 'Geo Vietnamese' })
  assert.equal(enriched.languageProvenance.name_en, 'whosonfirst')
  assert.equal(enriched.languageProvenance.name_vi, 'geonames_alternate')
  assert.deepEqual(enriched.facts.latitude, 1)
  assert.deepEqual(enriched.facts.longitude, 2)
  assert.deepEqual(enriched.sourceRefs, [
    { source: 'geonames', sourceId: '10' },
    { source: 'whosonfirst', sourceId: '101' }
  ])
  assert.ok(enriched.aliases.en.includes('Geo English'))
  assert.ok(enriched.aliases.en.includes('WOF EN alias'))
  assert.ok(enriched.aliases.vi.includes('WOF Vietnamese'))
  assert.ok(enriched.aliases.vi.includes('WOF VI alias'))
  assert.equal(report.matched, 1)
  assert.equal(report.nameVi, 0)
})

test('enrichGeoNamesWithWofCandidates uses WOF VI when GeoNames has no explicit Vietnamese name', () => {
  const entity = geo('10', { vi: null, viProv: 'missing' })
  const candidates = new Map([['10', [{
    wofId: '101', placetype: 'locality', geonamesIds: ['10'],
    name: { en: null, vi: 'WOF Vietnamese' },
    aliases: { en: [], vi: [] }
  }]]])

  const { entities, report } = enrichGeoNamesWithWofCandidates([entity], candidates)

  assert.equal(entities[0].name.vi, 'WOF Vietnamese')
  assert.equal(entities[0].languageProvenance.name_vi, 'whosonfirst')
  assert.equal(report.nameVi, 1)
})

test('one WOF identity cannot enrich multiple GeoNames entities', () => {
  const first = geo('10')
  const second = geo('20')
  const shared = {
    wofId: '85923799', placetype: 'locality',
    name: { en: 'South Gate', vi: null }, aliases: { en: [], vi: [] }
  }
  const candidates = new Map([
    ['10', [{ ...shared, geonamesIds: ['10'] }]],
    ['20', [{ ...shared, geonamesIds: ['20'] }]]
  ])

  const { entities, report } = enrichGeoNamesWithWofCandidates([first, second], candidates)

  assert.deepEqual(entities, [first, second])
  assert.equal(report.matched, 0)
  assert.equal(report.ambiguous, 2)
  assert.equal(entities.some((entity) => entity.sourceRefs.some((ref) => ref.source === 'whosonfirst')), false)
})

test('ambiguous WOF concordances are quarantined instead of failing or choosing a record', () => {
  const entity = geo('10')
  const candidates = new Map([['10', [
    { wofId: '101', placetype: 'locality', geonamesIds: ['10'], name: { en: 'A', vi: null }, aliases: { en: [], vi: [] } },
    { wofId: '202', placetype: 'locality', geonamesIds: ['10'], name: { en: 'B', vi: null }, aliases: { en: [], vi: [] } }
  ]]])
  const { entities, report } = enrichGeoNamesWithWofCandidates([entity], candidates)

  assert.deepEqual(entities[0], entity)
  assert.equal(report.matched, 0)
  assert.equal(report.ambiguous, 1)
  assert.deepEqual(report.ambiguitySamples, [{ type: 'city', geonamesId: '10', wofIds: ['101', '202'] }])
})

import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn as spawnProcess } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ensureWofArchive,
  scanWofArchive,
  enrichGeoNamesWithWof,
  WOF_URLS
} from '../../src/dataset/wof-client.js'

const execFileAsync = promisify(execFile)

test('ensureWofArchive downloads atomically, hashes content, and reuses cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'wof-cache-test-'))
  const payload = Buffer.from('archive-bytes')
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(payload, { status: 200 })
  }

  const first = await ensureWofArchive({ type: 'city', cacheDir, fetchImpl, urls: { city: 'https://example.test/locality.tar.bz2' } })
  const second = await ensureWofArchive({ type: 'city', cacheDir, fetchImpl, urls: { city: 'https://example.test/locality.tar.bz2' } })

  assert.equal(calls, 1)
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.downloaded, true)
  assert.equal(second.downloaded, false)
  assert.deepEqual(await readFile(first.path), payload)
})

test('bounded TAR collector requires an explicit selected GeoNames ID set', async () => {
  await assert.rejects(
    () => collectWofCandidatesFromTarStream(Readable.from([]), { type: 'city' }),
    /targetIds must be a Set/
  )
})

test('bounded TAR collector drains trailing archive blocks after the end marker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-tar-drain-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  await writeFile(join(inputDir, '10.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 101, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten']
  }, geometry: null }))
  const tarPath = join(directory, 'locality.tar')
  await execFileAsync('tar', ['-cf', tarPath, '-C', inputDir, '.'])
  const tarBytes = await readFile(tarPath)
  const blocks = []
  for (let offset = 0; offset < tarBytes.length; offset += 512) blocks.push(tarBytes.subarray(offset, offset + 512))
  let consumed = 0
  const readable = {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index >= blocks.length) return { done: true, value: undefined }
          consumed += 1
          return { done: false, value: blocks[index++] }
        }
      }
    }
  }

  const result = await collectWofCandidatesFromTarStream(readable, {
    type: 'city', targetIds: new Set(['10'])
  })

  assert.equal(result.candidates.get('10')[0].wofId, '101')
  assert.equal(consumed, blocks.length)
})

test('scanWofArchive consumes decompressed TAR entries across arbitrary binary chunk boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-tar-chunks-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  await writeFile(join(inputDir, '10.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 101, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten']
  }, geometry: { type: 'Point', coordinates: [1, 2] } }))
  await writeFile(join(inputDir, '20.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 202, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '20' },
    'name:eng_x_preferred': ['Twenty']
  }, geometry: null }))
  const tarPath = join(directory, 'locality.tar')
  await execFileAsync('tar', ['-cf', tarPath, '-C', inputDir, '.'])

  const invocations = []
  const spawnImpl = (command, args, options) => {
    invocations.push({ command, args })
    return spawnProcess('cat', [tarPath], options)
  }
  const result = await scanWofArchive({
    archivePath: '/fake/locality.tar.bz2', type: 'city', targetIds: new Set(['10']), spawnImpl
  })

  assert.equal(invocations[0].command, 'bzip2')
  assert.deepEqual(invocations[0].args, ['-dc', '/fake/locality.tar.bz2'])
  assert.equal(result.invalid, 0)
  assert.equal(result.scanned, 2)
  assert.equal(result.candidates.get('10')[0].wofId, '101')
  assert.equal(result.candidates.has('20'), false)
})

test('scanWofArchive rejects unmatched records before JSON parsing and never retains their geometry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-prefilter-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  await writeFile(join(inputDir, 'unmatched.geojson'), '{"type":"Feature","properties":{"wof:id":999,"wof:placetype":"locality","wof:concordances":{"gn:id":"999"}},"geometry":INVALID}')
  await writeFile(join(inputDir, 'matched.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 101, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten']
  }, geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [1, 2]]] } }))
  const archivePath = join(directory, 'locality.tar.bz2')
  await execFileAsync('tar', ['-cjf', archivePath, '-C', inputDir, '.'])

  const result = await scanWofArchive({ archivePath, type: 'city', targetIds: new Set(['10']) })

  assert.equal(result.invalid, 0)
  assert.equal(result.scanned, 2)
  assert.equal(result.skippedUnmatched, 1)
  assert.equal(result.candidates.get('10')[0].wofId, '101')
  assert.equal('geometry' in result.candidates.get('10')[0], false)
})

test('scanWofArchive decodes only properties so matched records never materialize geometry text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-geometry-isolation-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  const properties = JSON.stringify({
    'wof:id': 101,
    'wof:placetype': 'locality',
    'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten']
  })
  const raw = Buffer.concat([
    Buffer.from(`{"type":"Feature","properties":${properties},"geometry":{"blob":"`),
    Buffer.from([0xff]),
    Buffer.from('"}}')
  ])
  await writeFile(join(inputDir, '10.geojson'), raw)
  const archivePath = join(directory, 'locality.tar.bz2')
  await execFileAsync('tar', ['-cjf', archivePath, '-C', inputDir, '.'])

  const result = await scanWofArchive({ archivePath, type: 'city', targetIds: new Set(['10']) })

  assert.equal(result.invalid, 0)
  assert.equal(result.candidates.get('10')[0].wofId, '101')
})

test('scanWofArchive stress path retains only selected candidates across many large unmatched records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-stress-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  const geometryBlob = 'x'.repeat(8192)
  const writes = []
  for (let id = 1; id <= 200; id += 1) {
    writes.push(writeFile(join(inputDir, `${id}.geojson`), JSON.stringify({
      type: 'Feature',
      properties: {
        'wof:id': 100000 + id,
        'wof:placetype': 'locality',
        'wof:concordances': { 'gn:id': String(id) },
        'name:eng_x_preferred': [`City ${id}`]
      },
      geometry: { blob: geometryBlob }
    })))
  }
  await Promise.all(writes)
  const archivePath = join(directory, 'locality.tar.bz2')
  await execFileAsync('tar', ['-cjf', archivePath, '-C', inputDir, '.'])

  const result = await scanWofArchive({
    archivePath,
    type: 'city',
    targetIds: new Set(['1', '200'])
  })

  assert.equal(result.scanned, 200)
  assert.equal(result.skippedUnmatched, 198)
  assert.equal(result.invalid, 0)
  assert.equal(result.candidates.size, 2)
  assert.equal(result.candidates.get('1')[0].wofId, '100001')
  assert.equal(result.candidates.get('200')[0].wofId, '100200')
})

test('scanWofArchive reports bounded progress with heap and RSS telemetry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-progress-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  await writeFile(join(inputDir, '10.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 101, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten']
  }, geometry: null }))
  const archivePath = join(directory, 'locality.tar.bz2')
  await execFileAsync('tar', ['-cjf', archivePath, '-C', inputDir, '.'])
  const logs = []

  await scanWofArchive({
    archivePath,
    type: 'city',
    targetIds: new Set(['10']),
    progressEvery: 1,
    memoryUsage: () => ({ heapUsed: 64 * 1024 * 1024, rss: 128 * 1024 * 1024 }),
    log: (line) => logs.push(line)
  })

  assert.ok(logs.some((line) => line.includes('[wof] city scan started') && line.includes('targets=1')))
  assert.ok(logs.some((line) => line.includes('scanned=1') && line.includes('heap=64MB') && line.includes('rss=128MB')))
  assert.ok(logs.some((line) => line.includes('[wof] city scan completed') && line.includes('matchedTargets=1')))
})

test('scanWofArchive streams GeoJSON entries from a tar.bz2 archive without extracting them to disk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wof-tar-test-'))
  const inputDir = join(directory, 'input')
  await mkdir(inputDir)
  await writeFile(join(inputDir, '10.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 101, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '10' },
    'name:eng_x_preferred': ['Ten'], 'name:vie_x_preferred': ['Mười']
  }, geometry: null }))
  await writeFile(join(inputDir, '20.geojson'), JSON.stringify({ type: 'Feature', properties: {
    'wof:id': 202, 'wof:placetype': 'locality', 'wof:concordances': { 'gn:id': '20' },
    'name:eng_x_preferred': ['Twenty']
  }, geometry: null }))
  const archivePath = join(directory, 'locality.tar.bz2')
  await execFileAsync('tar', ['-cjf', archivePath, '-C', inputDir, '.'])

  const result = await scanWofArchive({ archivePath, type: 'city', targetIds: new Set(['10']) })
  assert.equal(result.invalid, 0)
  assert.equal(result.candidates.get('10')[0].wofId, '101')
  assert.equal(result.candidates.has('20'), false)
})

test('enrichGeoNamesWithWof forwards progress logging and preserves archive scan counters in its report', async () => {
  const city = geo('10')
  const log = () => {}
  const scanCalls = []

  const result = await enrichGeoNamesWithWof([city], {
    log,
    progressEvery: 123,
    ensureArchive: async () => ({
      path: '/fake/locality.tar.bz2', url: WOF_URLS.city, sha256: 'abc', downloaded: false
    }),
    scanArchive: async (options) => {
      scanCalls.push(options)
      return {
        invalid: 2,
        scanned: 456,
        skippedUnmatched: 400,
        candidates: new Map([['10', [{
          wofId: '101', placetype: 'locality', geonamesIds: ['10'],
          name: { en: 'WOF City', vi: null }, aliases: { en: [], vi: [] }
        }]]])
      }
    }
  })

  assert.equal(scanCalls[0].log, log)
  assert.equal(scanCalls[0].progressEvery, 123)
  assert.equal(result.report.scanned, 456)
  assert.equal(result.report.skippedUnmatched, 400)
  assert.equal(result.report.byType.city.scanned, 456)
  assert.equal(result.report.byType.city.skippedUnmatched, 400)
  assert.equal(result.report.invalid, 2)
})

test('enrichGeoNamesWithWof quarantines one archive failure while enriching another type', async () => {
  const city = geo('10')
  const country = normalizeEntity({
    id: 'geonames:country:20', type: 'country', name: { en: 'Geo Country', vi: null },
    description: { en: null, vi: null }, aliases: { en: [], vi: [] }, continent: 'Asia', region: null,
    countryCode: 'ZZ', population: 100, facts: {}, source: 'geonames', sourceId: '20'
  })

  const result = await enrichGeoNamesWithWof([city, country], {
    ensureArchive: async ({ type }) => {
      if (type === 'country') throw new Error('country archive unavailable')
      return { path: '/fake/locality.tar.bz2', url: WOF_URLS.city, sha256: 'abc', downloaded: false }
    },
    scanArchive: async ({ type }) => ({
      invalid: 0,
      candidates: type === 'city'
        ? new Map([['10', [{ wofId: '101', placetype: 'locality', geonamesIds: ['10'], name: { en: 'WOF City', vi: 'Thành phố WOF' }, aliases: { en: [], vi: [] } }]]])
        : new Map()
    })
  })

  assert.equal(result.entities.find((item) => item.type === 'city').name.en, 'WOF City')
  assert.equal(result.entities.find((item) => item.type === 'country').name.en, 'Geo Country')
  assert.equal(result.report.status, 'partial')
  assert.equal(result.report.matched, 1)
  assert.equal(result.report.byType.city.status, 'ok')
  assert.equal(result.report.byType.country.status, 'unavailable')
})
