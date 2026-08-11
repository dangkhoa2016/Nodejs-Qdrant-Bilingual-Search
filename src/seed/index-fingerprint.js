import { createHash } from 'node:crypto'
import { buildEmbeddingTextByVersion } from '../domain/embedding-text.js'
import { normalizeEmbeddingRuntime } from '../embeddings/runtime-provenance.js'

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item))
  if (value && typeof value === 'object') {
    const output = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key])
    }
    return output
  }
  return value
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

function requiredMetadata(metadata) {
  const embeddingModel = String(metadata?.embeddingModel ?? '').trim()
  const embeddingVersion = String(metadata?.embeddingVersion ?? '').trim()
  const datasetVersion = String(metadata?.datasetVersion ?? '').trim()
  if (!embeddingModel) throw new TypeError('metadata.embeddingModel is required')
  if (!embeddingVersion) throw new TypeError('metadata.embeddingVersion is required')
  if (!datasetVersion) throw new TypeError('metadata.datasetVersion is required')
  const embeddingRuntime = normalizeEmbeddingRuntime(metadata?.embeddingRuntime)
  return embeddingRuntime
    ? { embeddingModel, embeddingVersion, datasetVersion, embeddingRuntime }
    : { embeddingModel, embeddingVersion, datasetVersion }
}

export function createIndexFingerprint(entities, metadata) {
  if (!Array.isArray(entities) || !entities.length) throw new TypeError('entities must be a non-empty array')
  const identity = requiredMetadata(metadata)
  const hash = createHash('sha256')
  hash.update('nodejs-qdrant-bilingual-search:index-fingerprint:v2\n')
  hash.update(stableStringify(identity))
  hash.update('\n')

  let embeddingTextVersion = null
  const requestedEmbeddingTextVersion = metadata?.embeddingTextVersion ?? 'v1'
  const ordered = [...entities].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  for (const entity of ordered) {
    const document = buildEmbeddingTextByVersion(entity, requestedEmbeddingTextVersion)
    if (embeddingTextVersion == null) embeddingTextVersion = document.version
    if (document.version !== embeddingTextVersion) throw new Error('embedding text version changed within one seed run')
    hash.update(stableStringify(entity))
    hash.update('\n')
    hash.update(document.version)
    hash.update('\n')
    hash.update(document.text)
    hash.update('\n')
  }

  return {
    value: `sha256:${hash.digest('hex')}`,
    embeddingTextVersion,
    entityCount: entities.length
  }
}
