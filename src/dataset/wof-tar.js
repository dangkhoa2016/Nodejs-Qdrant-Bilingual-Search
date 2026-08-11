import { normalizeWofFeature } from './wof-normalizer.js'

class AsyncByteReader {
  constructor(readable) {
    this.iterator = readable[Symbol.asyncIterator]()
    this.pending = Buffer.alloc(0)
    this.done = false
  }

  async #fill() {
    if (this.done) return false
    const next = await this.iterator.next()
    if (next.done) {
      this.done = true
      return false
    }
    this.pending = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value)
    return true
  }

  async readExactly(size, { allowEof = false } = {}) {
    if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('TAR read size must be a non-negative safe integer')
    if (size === 0) return Buffer.alloc(0)
    const chunks = []
    let total = 0
    while (total < size) {
      if (this.pending.length === 0 && !await this.#fill()) {
        if (allowEof && total === 0) return null
        throw new TypeError('WOF TAR stream ended unexpectedly')
      }
      const take = Math.min(size - total, this.pending.length)
      chunks.push(this.pending.subarray(0, take))
      this.pending = this.pending.subarray(take)
      total += take
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size)
  }

  async discard(size) {
    if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('TAR discard size must be a non-negative safe integer')
    let remaining = size
    while (remaining > 0) {
      if (this.pending.length === 0 && !await this.#fill()) throw new TypeError('WOF TAR stream ended unexpectedly')
      const take = Math.min(remaining, this.pending.length)
      this.pending = this.pending.subarray(take)
      remaining -= take
    }
  }

  async drain() {
    this.pending = Buffer.alloc(0)
    while (!this.done) {
      const next = await this.iterator.next()
      if (next.done) this.done = true
    }
  }
}

function tarText(header, offset, length) {
  const end = header.indexOf(0, offset)
  const upper = offset + length
  return header.subarray(offset, end >= offset && end < upper ? end : upper).toString('utf8').trim()
}

function tarSize(header) {
  const field = header.subarray(124, 136)
  if (field[0] & 0x80) {
    let value = BigInt(field[0] & 0x7f)
    for (let index = 1; index < field.length; index += 1) value = (value << 8n) | BigInt(field[index])
    const size = Number(value)
    if (!Number.isSafeInteger(size)) throw new TypeError('WOF TAR entry is too large')
    return size
  }
  const raw = field.toString('ascii').replace(/\0.*$/u, '').trim()
  if (!raw) return 0
  if (!/^[0-7]+$/u.test(raw)) throw new TypeError('WOF TAR entry has an invalid size')
  const size = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(size)) throw new TypeError('WOF TAR entry is too large')
  return size
}

function zeroTarBlock(header) {
  for (const byte of header) if (byte !== 0) return false
  return true
}

async function * tarGeoJsonEntries(readable) {
  const reader = new AsyncByteReader(readable)
  while (true) {
    const header = await reader.readExactly(512, { allowEof: true })
    if (header == null) return
    if (zeroTarBlock(header)) {
      await reader.drain()
      return
    }

    const name = tarText(header, 0, 100)
    const prefix = tarText(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = tarSize(header)
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const isRegular = typeFlag === '0' || typeFlag === '\0'
    const isGeoJson = isRegular && path.toLowerCase().endsWith('.geojson')
    const data = isGeoJson ? await reader.readExactly(size) : null
    if (!isGeoJson) await reader.discard(size)
    const padding = (512 - (size % 512)) % 512
    if (padding) await reader.discard(padding)
    if (isGeoJson) yield { path, data }
  }
}

const GEO_NAMES_VALUE = /"(?:gn:id|gn:geonameid)"\s*:\s*(\[[^\]]*\]|"\d+"|\d+)/gu
const NUMERIC_ID = /\d+/gu

function mentionsTargetGeoNamesId(text, targetIds) {
  GEO_NAMES_VALUE.lastIndex = 0
  let sawRecognizedValue = false
  let match
  while ((match = GEO_NAMES_VALUE.exec(text)) != null) {
    const ids = match[1].match(NUMERIC_ID) ?? []
    if (!ids.length) continue
    sawRecognizedValue = true
    for (const id of ids) if (targetIds.has(id)) return true
  }
  if (sawRecognizedValue) return false
  return text.includes('"gn:id"') || text.includes('"gn:geonameid"')
}

const PROPERTIES_KEY = Buffer.from('"properties"')

function jsonWhitespace(byte) {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
}

function propertiesBufferFromGeoJson(data) {
  const keyStart = data.indexOf(PROPERTIES_KEY)
  if (keyStart < 0) throw new TypeError('WOF GeoJSON record requires properties')
  let start = keyStart + PROPERTIES_KEY.length
  while (jsonWhitespace(data[start])) start += 1
  if (data[start] !== 0x3a) throw new TypeError('WOF GeoJSON properties key must be followed by a colon')
  start += 1
  while (jsonWhitespace(data[start])) start += 1
  if (data[start] !== 0x7b) throw new TypeError('WOF GeoJSON properties must be an object')

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < data.length; index += 1) {
    const byte = data[index]
    if (inString) {
      if (escaped) escaped = false
      else if (byte === 0x5c) escaped = true
      else if (byte === 0x22) inString = false
      continue
    }
    if (byte === 0x22) {
      inString = true
      continue
    }
    if (byte === 0x7b) depth += 1
    else if (byte === 0x7d) {
      depth -= 1
      if (depth === 0) return data.subarray(start, index + 1)
    }
  }
  throw new TypeError('WOF GeoJSON properties object is incomplete')
}

function appendCandidate(candidates, candidate, targetIds) {
  for (const geonamesId of candidate.geonamesIds) {
    if (!targetIds.has(geonamesId)) continue
    const bucket = candidates.get(geonamesId) ?? []
    if (!bucket.some((item) => item.wofId === candidate.wofId)) bucket.push(candidate)
    candidates.set(geonamesId, bucket)
  }
}

export async function collectWofCandidatesFromTarStream(readable, { type, targetIds, onProgress } = {}) {
  if (!(targetIds instanceof Set)) throw new TypeError('targetIds must be a Set')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const candidates = new Map()
  let invalid = 0
  let scanned = 0
  let skippedUnmatched = 0

  for await (const entry of tarGeoJsonEntries(readable)) {
    scanned += 1
    let propertiesText
    try {
      propertiesText = decoder.decode(propertiesBufferFromGeoJson(entry.data))
    } catch {
      invalid += 1
      onProgress?.({ scanned, invalid, skippedUnmatched, candidates })
      continue
    }

    if (!mentionsTargetGeoNamesId(propertiesText, targetIds)) {
      skippedUnmatched += 1
      onProgress?.({ scanned, invalid, skippedUnmatched, candidates })
      continue
    }

    try {
      const candidate = normalizeWofFeature({ properties: JSON.parse(propertiesText) }, { type })
      if (candidate) appendCandidate(candidates, candidate, targetIds)
    } catch {
      invalid += 1
    }
    onProgress?.({ scanned, invalid, skippedUnmatched, candidates })
  }

  for (const bucket of candidates.values()) {
    bucket.sort((a, b) => Number(a.wofId) - Number(b.wofId) || a.wofId.localeCompare(b.wofId))
  }
  return { candidates, invalid, scanned, skippedUnmatched }
}
