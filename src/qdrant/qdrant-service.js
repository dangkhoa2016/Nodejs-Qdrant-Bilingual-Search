const EMBEDDING_RUNTIME_PAYLOAD_FIELDS = {
  accelerator: 'embedding_accelerator',
  device: 'embedding_device',
  dtype: 'embedding_dtype',
  runtime: 'embedding_runtime',
  profile: 'embedding_profile',
  query_strategy: 'embedding_query_strategy',
  query_instruction_id: 'embedding_query_instruction_id',
  document_strategy: 'embedding_document_strategy'
}

const INDEXES = [
  ['type', 'keyword'], ['continent', 'keyword'], ['region', 'keyword'],
  ['country_code', 'keyword'], ['source', 'keyword'], ['population', 'integer'],
  ['index_fingerprint', 'keyword']
]

const DEFAULT_SEED_STATE_SCROLL_PAGE_SIZE = 256

function errorText(error) {
  const parts = []
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    parts.push(String(current?.message ?? current))
    const statusError = current?.data?.status?.error ?? current?.response?.data?.status?.error
    if (statusError) parts.push(String(statusError))
    current = current?.cause
  }
  return parts.join(' | ')
}

function isAlreadyExists(error) {
  return /already exists|already indexed|already created/i.test(errorText(error))
}

function isExactCountDisabled(error) {
  const text = errorText(error)
  return /exact\s+search\s+disabled/i.test(text) || /set\s+exact\s*=\s*false/i.test(text)
}

function vectorSchema(info) {
  const vectors = info?.config?.params?.vectors
  if (!vectors || typeof vectors !== 'object' || !Number.isFinite(vectors.size)) {
    throw new Error('existing Qdrant collection does not expose the expected unnamed vector schema')
  }
  return { size: Number(vectors.size), distance: String(vectors.distance ?? '') }
}

function validatePayloadIndexes(info) {
  const schema = info?.payload_schema ?? {}
  for (const [fieldName, expectedType] of INDEXES) {
    const actualType = String(schema?.[fieldName]?.data_type ?? '').toLowerCase()
    if (actualType !== expectedType) {
      throw new Error(`Qdrant payload index ${fieldName} type mismatch: expected ${expectedType}, got ${actualType || 'missing'}`)
    }
  }
}

function integerCount(value, name) {
  const count = Number(value ?? 0)
  if (!Number.isInteger(count) || count < 0) throw new Error(`Qdrant returned invalid ${name}`)
  return count
}

function strictModeState(info) {
  const strict = info?.config?.strict_mode_config
  if (!strict || strict.enabled !== true) return { exactCountAllowed: null, maxQueryLimit: null }
  const parsedLimit = Number(strict.max_query_limit)
  return {
    exactCountAllowed: strict.search_allow_exact === false ? false : strict.search_allow_exact === true ? true : null,
    maxQueryLimit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : null
  }
}

export class QdrantService {
  constructor({ connection, collection, dimension }) {
    if (!connection || typeof connection.execute !== 'function') throw new TypeError('connection is required')
    this.connection = connection
    this.collection = collection
    this.dimension = dimension
    this.seedStateScrollPageSize = DEFAULT_SEED_STATE_SCROLL_PAGE_SIZE
    this.exactCountAllowed = null
  }

  async health() {
    try { return Boolean((await this.connection.probe()).ready) } catch { return false }
  }

  async ensureCollection() {
    const { collections = [] } = await this.connection.execute('getCollections', (client) => client.getCollections())
    if (!collections.some((item) => item.name === this.collection)) {
      try {
        await this.connection.execute('createCollection', (client) => client.createCollection(this.collection, {
          vectors: { size: this.dimension, distance: 'Cosine' }
        }))
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
    }

    const schemaInfo = await this.connection.execute('getCollection:schema', (client) => client.getCollection(this.collection))
    const schema = vectorSchema(schemaInfo)
    if (schema.size !== this.dimension) {
      throw new Error(`Qdrant collection vector size mismatch: expected ${this.dimension}, got ${schema.size}`)
    }
    if (schema.distance.toLowerCase() !== 'cosine') {
      throw new Error(`Qdrant collection distance mismatch: expected Cosine, got ${schema.distance || 'unknown'}`)
    }

    for (const [field_name, field_schema] of INDEXES) {
      try {
        await this.connection.execute(`createPayloadIndex:${field_name}`, (client) => client.createPayloadIndex(
          this.collection,
          { field_name, field_schema, wait: true }
        ))
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
    }

    const indexInfo = await this.connection.execute('getCollection:indexes', (client) => client.getCollection(this.collection))
    validatePayloadIndexes(indexInfo)
    const strict = strictModeState(indexInfo)
    this.exactCountAllowed = strict.exactCountAllowed
    this.seedStateScrollPageSize = Math.min(
      DEFAULT_SEED_STATE_SCROLL_PAGE_SIZE,
      strict.maxQueryLimit ?? DEFAULT_SEED_STATE_SCROLL_PAGE_SIZE
    )
  }

  async #exactSeedCounts(indexFingerprint) {
    const total = await this.connection.execute('count:all', (client) => client.count(this.collection, { exact: true }))
    const pointsCount = integerCount(total?.count ?? total, 'point count')
    if (pointsCount === 0) return { pointsCount: 0, matchingCount: 0 }
    const matched = await this.connection.execute('count:index_fingerprint', (client) => client.count(this.collection, {
      exact: true,
      filter: { must: [{ key: 'index_fingerprint', match: { value: indexFingerprint } }] }
    }))
    return { pointsCount, matchingCount: integerCount(matched?.count ?? matched, 'matching point count') }
  }

  async #scrollSeedCounts(indexFingerprint) {
    let pointsCount = 0
    let matchingCount = 0
    let offset

    while (true) {
      const request = {
        limit: this.seedStateScrollPageSize,
        with_payload: ['index_fingerprint'],
        with_vector: false
      }
      if (offset != null) request.offset = offset

      const page = await this.connection.execute('scroll:seed-state', (client) => client.scroll(this.collection, request))
      const points = page?.points ?? page?.result?.points
      if (!Array.isArray(points)) throw new Error('Qdrant scroll returned an invalid seed-state page')

      pointsCount += points.length
      for (const point of points) {
        if (point?.payload?.index_fingerprint === indexFingerprint) matchingCount += 1
      }

      const nextOffset = page?.next_page_offset ?? page?.result?.next_page_offset ?? null
      if (nextOffset == null) break
      offset = nextOffset
    }

    return { pointsCount, matchingCount }
  }

  async #seedCounts(indexFingerprint) {
    if (this.exactCountAllowed === false) return this.#scrollSeedCounts(indexFingerprint)
    try {
      return await this.#exactSeedCounts(indexFingerprint)
    } catch (error) {
      if (!isExactCountDisabled(error)) throw error
      this.exactCountAllowed = false
      return this.#scrollSeedCounts(indexFingerprint)
    }
  }

  async preflightSeed({ indexFingerprint, expectedPoints }) {
    if (typeof indexFingerprint !== 'string' || !indexFingerprint) throw new TypeError('indexFingerprint is required')
    if (!Number.isInteger(expectedPoints) || expectedPoints < 1) throw new TypeError('expectedPoints must be a positive integer')
    const state = await this.#seedCounts(indexFingerprint)
    if (state.pointsCount > expectedPoints) {
      throw new Error(`Qdrant collection contains ${state.pointsCount} points but this seed expects ${expectedPoints}; use a new collection or explicitly reset it`)
    }
    if (state.matchingCount !== state.pointsCount) {
      throw new Error('Qdrant collection contains points from a different dataset or embedding configuration; use a new collection or explicitly reset it')
    }
    return {
      ...state,
      mode: state.pointsCount === 0 ? 'fresh' : state.pointsCount === expectedPoints ? 'idempotent' : 'resume'
    }
  }

  async verifySeed({ indexFingerprint, expectedPoints }) {
    const state = await this.#seedCounts(indexFingerprint)
    if (state.pointsCount !== expectedPoints || state.matchingCount !== expectedPoints) {
      throw new Error(`Qdrant seed verification failed: expected exactly ${expectedPoints} points with the current index fingerprint, got total=${state.pointsCount}, matching=${state.matchingCount}`)
    }
    return state
  }

  async verifyEmbeddingRuntime({ expectedPoints, runtime, embeddingModel, embeddingTextVersion }) {
    if (!Number.isInteger(expectedPoints) || expectedPoints < 1) throw new TypeError('expectedPoints must be a positive integer')
    const backend = String(runtime?.backend ?? '').trim()
    const implementation = String(runtime?.implementation ?? '').trim()
    const semantic = runtime?.semantic === true
    if (!backend || !implementation || !semantic) throw new TypeError('verified semantic runtime is required')
    const expectedRuntime = { backend, implementation, semantic: true }
    const expectedEmbeddingModel = String(embeddingModel ?? '').trim()
    const expectedEmbeddingTextVersion = String(embeddingTextVersion ?? '').trim()
    for (const key of Object.keys(EMBEDDING_RUNTIME_PAYLOAD_FIELDS)) {
      const value = String(runtime?.[key] ?? '').trim()
      if (value) expectedRuntime[key] = value
    }

    const info = await this.connection.execute('getCollection:embedding-runtime-audit', (client) => client.getCollection(this.collection))
    const strict = strictModeState(info)
    const pageSize = Math.min(DEFAULT_SEED_STATE_SCROLL_PAGE_SIZE, strict.maxQueryLimit ?? DEFAULT_SEED_STATE_SCROLL_PAGE_SIZE)

    let pointsCount = 0
    let matchingCount = 0
    let offset
    while (true) {
      const requestedPayloadFields = ['embedding_backend', 'embedding_implementation', 'embedding_semantic']
      if (expectedEmbeddingModel) requestedPayloadFields.push('embedding_model')
      if (expectedEmbeddingTextVersion) requestedPayloadFields.push('embedding_text_version')
      for (const [key, payloadField] of Object.entries(EMBEDDING_RUNTIME_PAYLOAD_FIELDS)) {
        if (expectedRuntime[key]) requestedPayloadFields.push(payloadField)
      }
      const request = {
        limit: pageSize,
        with_payload: requestedPayloadFields,
        with_vector: false
      }
      if (offset != null) request.offset = offset

      const page = await this.connection.execute('scroll:embedding-runtime', (client) => client.scroll(this.collection, request))
      const points = page?.points ?? page?.result?.points
      if (!Array.isArray(points)) throw new Error('Qdrant scroll returned an invalid embedding-runtime page')

      pointsCount += points.length
      for (const point of points) {
        const payload = point?.payload ?? {}
        let matches = payload.embedding_backend === backend &&
          payload.embedding_implementation === implementation &&
          payload.embedding_semantic === true
        if (matches && expectedEmbeddingModel && payload.embedding_model !== expectedEmbeddingModel) matches = false
        if (matches && expectedEmbeddingTextVersion && payload.embedding_text_version !== expectedEmbeddingTextVersion) matches = false
        if (matches) {
          for (const [key, payloadField] of Object.entries(EMBEDDING_RUNTIME_PAYLOAD_FIELDS)) {
            if (expectedRuntime[key] && payload[payloadField] !== expectedRuntime[key]) {
              matches = false
              break
            }
          }
        }
        if (matches) matchingCount += 1
      }

      const nextOffset = page?.next_page_offset ?? page?.result?.next_page_offset ?? null
      if (nextOffset == null) break
      offset = nextOffset
    }

    if (pointsCount !== expectedPoints || matchingCount !== expectedPoints) {
      throw new Error(`Qdrant embedding runtime provenance verification failed: expected exactly ${expectedPoints} points from ${backend}/${implementation}, got total=${pointsCount}, matching=${matchingCount}`)
    }
    return {
      pointsCount, matchingCount, runtime: expectedRuntime,
      ...(expectedEmbeddingModel ? { embeddingModel: expectedEmbeddingModel } : {}),
      ...(expectedEmbeddingTextVersion ? { embeddingTextVersion: expectedEmbeddingTextVersion } : {})
    }
  }

  async upsertPoints(points) {
    if (!Array.isArray(points) || !points.length) return
    await this.connection.execute('upsert', (client) => client.upsert(this.collection, { wait: true, points }))
  }

  async querySemantic({ vector, filter, limit, scoreThreshold }) {
    const result = await this.connection.execute('query', (client) => client.query(this.collection, {
      query: vector,
      filter,
      limit,
      score_threshold: scoreThreshold,
      with_payload: true,
      with_vector: false
    }))
    return result.points ?? result
  }

  async getByPointId(id) {
    const points = await this.connection.execute('retrieve', (client) => client.retrieve(
      this.collection,
      { ids: [id], with_payload: true, with_vector: false }
    ))
    return points[0] ?? null
  }

  async stats() {
    return this.connection.execute('getCollection', (client) => client.getCollection(this.collection))
  }
}
