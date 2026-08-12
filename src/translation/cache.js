import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex')

export function translationCacheIdentity({ provider, model, promptVersion, from = 'en', to = 'vi', text }) {
  if (!provider || !model || !promptVersion) throw new TypeError('provider, model and promptVersion are required for translation cache identity')
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('text is required for translation cache identity')
  const source = text.trim()
  const sourceSha256 = sha256(source)
  const key = sha256(JSON.stringify({ provider, model, promptVersion, from, to, sourceSha256 }))
  return { key, sourceSha256 }
}

export class JsonlTranslationCache {
  #loaded = false
  #records = new Map()
  #writeChain = Promise.resolve()

  constructor(path) {
    if (!path) throw new TypeError('translation cache path is required')
    this.path = path
  }

  async #load() {
    if (this.#loaded) return
    this.#loaded = true
    let raw
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const record = JSON.parse(line)
      if (record?.key && typeof record?.text === 'string' && record?.metadata) this.#records.set(record.key, record)
    }
  }

  async get(key) {
    await this.#load()
    const record = this.#records.get(key)
    return record ? structuredClone(record) : null
  }

  async set(key, { text, metadata }) {
    await this.#load()
    const record = { key, text, metadata }
    this.#records.set(key, structuredClone(record))
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    await this.#writeChain
  }
}
