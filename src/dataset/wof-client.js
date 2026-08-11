import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { normalizeEntity } from '../domain/entity.js'
import { normalizeWofFeature } from './wof-normalizer.js'
import { collectWofCandidatesFromTarStream } from './wof-tar.js'

export const WOF_URLS = Object.freeze({
  city: 'https://data.geocode.earth/wof/dist/legacy/whosonfirst-data-locality-latest.tar.bz2',
  country: 'https://data.geocode.earth/wof/dist/legacy/whosonfirst-data-country-latest.tar.bz2'
})

function geoNamesIdForEntity(entity) {
  const ref = entity.sourceRefs?.find((item) => item.source === 'geonames')
  const value = ref?.sourceId ?? (entity.source === 'geonames' ? entity.sourceId : null)
  return value != null && /^\d+$/.test(String(value)) ? String(value) : null
}

async function * jsonObjects(readable) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let parts = []
  let depth = 0
  let inString = false
  let escaped = false

  const consume = function * (text) {
    let segmentStart = 0
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]
      if (depth === 0) {
        if (/\s/u.test(char)) continue
        if (char !== '{') throw new TypeError('WOF archive stream must contain concatenated GeoJSON objects')
        parts = ['{']
        depth = 1
        inString = false
        escaped = false
        segmentStart = index + 1
        continue
      }

      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
      } else if (char === '"') inString = true
      else if (char === '{' || char === '[') depth += 1
      else if (char === '}' || char === ']') depth -= 1

      if (depth === 0) {
        parts.push(text.slice(segmentStart, index + 1))
        yield parts.join('')
        parts = []
        segmentStart = index + 1
      }
    }
    if (depth > 0 && segmentStart < text.length) parts.push(text.slice(segmentStart))
  }

  for await (const chunk of readable) {
    yield * consume(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))
  }
  yield * consume(decoder.decode())
  if (depth !== 0 || parts.length) throw new TypeError('WOF archive stream ended with incomplete GeoJSON')
}

export async function collectWofCandidatesFromJsonStream(readable, { type, targetIds } = {}) {
  if (!(targetIds instanceof Set)) throw new TypeError('targetIds must be a Set')
  const candidates = new Map()
  let invalid = 0
  for await (const raw of jsonObjects(readable)) {
    let candidate
    try {
      candidate = normalizeWofFeature(JSON.parse(raw), { type })
    } catch {
      invalid += 1
      continue
    }
    if (!candidate) continue
    for (const geonamesId of candidate.geonamesIds) {
      if (!targetIds.has(geonamesId)) continue
      const bucket = candidates.get(geonamesId) ?? []
      if (!bucket.some((item) => item.wofId === candidate.wofId)) bucket.push(candidate)
      candidates.set(geonamesId, bucket)
    }
  }
  for (const bucket of candidates.values()) {
    bucket.sort((a, b) => Number(a.wofId) - Number(b.wofId) || a.wofId.localeCompare(b.wofId))
  }
  return { candidates, invalid }
}

function appendAliases(existing, values, primary) {
  const output = [...existing]
  const seen = new Set(output)
  for (const value of values) {
    if (!value || value === primary || seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

function appendRef(refs, sourceId) {
  const output = [...(refs ?? [])]
  if (!output.some((ref) => ref.source === 'whosonfirst' && String(ref.sourceId) === String(sourceId))) {
    output.push({ source: 'whosonfirst', sourceId: String(sourceId) })
  }
  return output
}

function ambiguousWofIds(candidates) {
  const claims = new Map()
  for (const [geonamesId, bucket] of candidates) {
    for (const candidate of bucket) {
      const ids = claims.get(candidate.wofId) ?? new Set()
      ids.add(String(geonamesId))
      claims.set(candidate.wofId, ids)
    }
  }
  return new Set([...claims].filter(([, ids]) => ids.size > 1).map(([wofId]) => wofId))
}

function hasExplicitGeoNamesVietnamese(entity) {
  return Boolean(entity.name.vi) && ['geonames', 'geonames_alternate'].includes(entity.languageProvenance?.name_vi)
}

export function enrichGeoNamesWithWofCandidates(entities, candidates) {
  const reverseAmbiguousWofIds = ambiguousWofIds(candidates)
  const report = {
    status: 'ok', requested: 0, matched: 0, ambiguous: 0, invalid: 0,
    nameEn: 0, nameVi: 0, ambiguitySamples: [], ambiguitySamplesTruncated: false
  }
  const output = entities.map((entity) => {
    const geonamesId = geoNamesIdForEntity(entity)
    if (!geonamesId || !['city', 'country'].includes(entity.type)) return entity
    report.requested += 1
    const bucket = candidates.get(geonamesId) ?? []
    if (!bucket.length) return entity
    const hasReverseAmbiguity = bucket.some((candidate) => reverseAmbiguousWofIds.has(candidate.wofId))
    if (bucket.length > 1 || hasReverseAmbiguity) {
      report.ambiguous += 1
      if (report.ambiguitySamples.length < 100) {
        report.ambiguitySamples.push({
          type: entity.type,
          geonamesId,
          wofIds: bucket.map((item) => item.wofId)
        })
      } else report.ambiguitySamplesTruncated = true
      return entity
    }

    const candidate = bucket[0]
    report.matched += 1
    const previousEn = entity.name.en
    const previousVi = entity.name.vi
    const nameEn = candidate.name.en ?? previousEn
    const useWofVi = Boolean(candidate.name.vi) && !hasExplicitGeoNamesVietnamese(entity)
    const nameVi = useWofVi ? candidate.name.vi : previousVi
    if (candidate.name.en) report.nameEn += 1
    if (useWofVi) report.nameVi += 1
    return normalizeEntity({
      ...entity,
      name: { en: nameEn, vi: nameVi },
      aliases: {
        en: appendAliases(entity.aliases.en, [previousEn, ...candidate.aliases.en], nameEn),
        vi: appendAliases(entity.aliases.vi, [previousVi, candidate.name.vi, ...candidate.aliases.vi], nameVi)
      },
      facts: { ...entity.facts, wofId: candidate.wofId, wofPlacetype: candidate.placetype },
      sourceRefs: appendRef(entity.sourceRefs, candidate.wofId),
      languageProvenance: {
        ...entity.languageProvenance,
        ...(candidate.name.en ? { name_en: 'whosonfirst' } : {}),
        ...(useWofVi ? { name_vi: 'whosonfirst' } : {})
      }
    })
  })
  return { entities: output, report }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function archiveName(url) {
  try {
    return basename(new URL(url).pathname) || 'whosonfirst.tar.bz2'
  } catch {
    throw new TypeError('WOF archive URL must be an absolute URL')
  }
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function ensureWofArchive({
  type,
  cacheDir = 'data/cache/wof',
  fetchImpl = fetch,
  refresh = false,
  urls = WOF_URLS
} = {}) {
  const url = urls[type]
  if (!url) throw new TypeError(`unsupported WOF archive type: ${type}`)
  await mkdir(cacheDir, { recursive: true })
  const path = join(cacheDir, archiveName(url))
  if (!refresh && await fileExists(path)) {
    return { path, url, sha256: await sha256File(path), downloaded: false }
  }

  const response = await fetchImpl(url, { headers: { accept: 'application/x-bzip2, application/octet-stream' } })
  if (!response.ok) throw new Error(`WOF download returned HTTP ${response.status}`)
  const tempPath = `${path}.part-${process.pid}-${Date.now()}`
  try {
    if (response.body) await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath))
    else await pipeline(Readable.from(Buffer.from(await response.arrayBuffer())), createWriteStream(tempPath))
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
  return { path, url, sha256: await sha256File(path), downloaded: true }
}


function memoryMegabytes(bytes) {
  return Math.round((bytes ?? 0) / 1024 / 1024)
}

function matchedTargetCount(candidates) {
  return candidates.size
}

export async function scanWofArchive({
  archivePath,
  type,
  targetIds,
  spawnImpl = spawn,
  progressEvery = 100_000,
  memoryUsage = process.memoryUsage,
  log = null,
  now = Date.now
} = {}) {
  if (!archivePath) throw new TypeError('archivePath is required')
  if (!(targetIds instanceof Set)) throw new TypeError('targetIds must be a Set')
  if (!Number.isInteger(progressEvery) || progressEvery < 1) throw new TypeError('progressEvery must be a positive integer')
  if (log != null && typeof log !== 'function') throw new TypeError('log must be a function when provided')

  const startedAt = now()
  const emit = (message) => log?.(message)
  emit(`[wof] ${type} scan started archive=${basename(archivePath)} targets=${targetIds.size}`)

  const child = spawnImpl('bzip2', ['-dc', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`Unable to decompress WOF archive with bzip2${stderr.trim() ? `: ${stderr.trim()}` : ''}`)))
  })

  const progress = ({ scanned, invalid, skippedUnmatched, candidates }) => {
    if (!log || scanned % progressEvery !== 0) return
    const memory = memoryUsage()
    emit(`[wof] ${type} scanned=${scanned} matchedTargets=${matchedTargetCount(candidates)} skipped=${skippedUnmatched} invalid=${invalid} heap=${memoryMegabytes(memory.heapUsed)}MB rss=${memoryMegabytes(memory.rss)}MB elapsed=${Math.max(0, now() - startedAt)}ms`)
  }

  try {
    const [result] = await Promise.all([
      collectWofCandidatesFromTarStream(child.stdout, { type, targetIds, onProgress: progress }),
      exit
    ])
    const memory = memoryUsage()
    emit(`[wof] ${type} scan completed scanned=${result.scanned} matchedTargets=${matchedTargetCount(result.candidates)} skipped=${result.skippedUnmatched} invalid=${result.invalid} heap=${memoryMegabytes(memory.heapUsed)}MB rss=${memoryMegabytes(memory.rss)}MB elapsed=${Math.max(0, now() - startedAt)}ms`)
    return result
  } catch (error) {
    if (!child.killed) child.kill()
    throw error
  }
}

function emptyReport() {
  return {
    status: 'ok', requested: 0, matched: 0, ambiguous: 0, invalid: 0,
    scanned: 0, skippedUnmatched: 0, nameEn: 0, nameVi: 0,
    ambiguitySamples: [], ambiguitySamplesTruncated: false,
    byType: {}, archives: []
  }
}

function mergeReport(target, source) {
  for (const key of ['requested', 'matched', 'ambiguous', 'invalid', 'scanned', 'skippedUnmatched', 'nameEn', 'nameVi']) target[key] += source[key] ?? 0
  for (const sample of source.ambiguitySamples ?? []) {
    if (target.ambiguitySamples.length < 100) target.ambiguitySamples.push(sample)
    else target.ambiguitySamplesTruncated = true
  }
  if (source.ambiguitySamplesTruncated) target.ambiguitySamplesTruncated = true
}

export async function enrichGeoNamesWithWof(entities, {
  cacheDir = 'data/cache/wof',
  fetchImpl = fetch,
  refresh = false,
  urls = WOF_URLS,
  ensureArchive = ensureWofArchive,
  scanArchive = scanWofArchive,
  log = console.error,
  progressEvery = 100_000
} = {}) {
  let output = entities
  const report = emptyReport()
  let attemptedTypes = 0
  let successfulTypes = 0

  for (const type of ['country', 'city']) {
    const typed = output.filter((entity) => entity.type === type && geoNamesIdForEntity(entity))
    if (!typed.length) continue
    attemptedTypes += 1
    const targetIds = new Set(typed.map((entity) => geoNamesIdForEntity(entity)))
    try {
      const archive = await ensureArchive({ type, cacheDir, fetchImpl, refresh, urls })
      const scanned = await scanArchive({ archivePath: archive.path, type, targetIds, log, progressEvery })
      const enriched = enrichGeoNamesWithWofCandidates(typed, scanned.candidates)
      enriched.report.invalid += scanned.invalid ?? 0
      enriched.report.scanned = scanned.scanned ?? 0
      enriched.report.skippedUnmatched = scanned.skippedUnmatched ?? 0
      const replacements = new Map(enriched.entities.map((entity) => [entity.id, entity]))
      output = output.map((entity) => entity.type === type && replacements.has(entity.id) ? replacements.get(entity.id) : entity)
      successfulTypes += 1
      mergeReport(report, enriched.report)
      report.byType[type] = { ...enriched.report, status: 'ok' }
      report.archives.push({
        type,
        file: basename(archive.path),
        url: archive.url,
        sha256: archive.sha256,
        downloaded: Boolean(archive.downloaded)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.requested += typed.length
      report.byType[type] = {
        status: 'unavailable', requested: typed.length, matched: 0, ambiguous: 0, invalid: 0,
        scanned: 0, skippedUnmatched: 0, nameEn: 0, nameVi: 0, error: message
      }
    }
  }

  if (attemptedTypes === 0) report.status = 'disabled'
  else if (successfulTypes === attemptedTypes) report.status = 'ok'
  else if (successfulTypes === 0) report.status = 'unavailable'
  else report.status = 'partial'
  return { entities: output, report }
}
