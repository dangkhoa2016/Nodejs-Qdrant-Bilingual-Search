const EMBEDDING_TRANSPORTS = new Set(['json', 'binary-f32'])
const FLOAT32_CONTENT_TYPE = 'application/x-float32'
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export class EmbeddingServiceError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'EmbeddingServiceError'
  }
}

export class HttpEmbeddingProvider {
  constructor({ baseUrl, model, dimension, fetchImpl = fetch, timeoutMs = 15000, transport = 'json', clock = () => performance.now() }) {
    if (!EMBEDDING_TRANSPORTS.has(transport)) throw new TypeError('transport must be json or binary-f32')
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.dimension = dimension
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
    this.transport = transport
    this.clock = clock
  }

  async #consumeResponse(path, body, consume, { accept } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = body ? { 'content-type': 'application/json' } : {}
      if (accept) headers.accept = accept
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: Object.keys(headers).length ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      })
      if (!response.ok) throw new EmbeddingServiceError(`Embedding service returned HTTP ${response.status}`)
      return await consume(response)
    } catch (error) {
      if (error instanceof EmbeddingServiceError) throw error
      throw new EmbeddingServiceError('Embedding service request failed', error)
    } finally {
      clearTimeout(timeout)
    }
  }

  async #request(path, body) {
    return this.#consumeResponse(path, body, async (response) => {
      try {
        return await response.json()
      } catch (error) {
        throw new EmbeddingServiceError('Embedding service returned invalid JSON', error)
      }
    })
  }

  #assertVector(vector) {
    if (!Array.isArray(vector) || vector.length !== this.dimension || vector.some((x) => !Number.isFinite(x))) {
      throw new EmbeddingServiceError(`Expected a numeric vector with dimension ${this.dimension}`)
    }
    return vector
  }

  #decodeBinaryVectors(arrayBuffer, response, expectedCount) {
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== FLOAT32_CONTENT_TYPE) {
      throw new EmbeddingServiceError(`Embedding service returned unexpected binary content type: ${contentType ?? 'unknown'}`)
    }

    const count = Number.parseInt(response.headers.get('x-embedding-count') ?? '', 10)
    const dimension = Number.parseInt(response.headers.get('x-embedding-dimension') ?? '', 10)
    const dtype = response.headers.get('x-embedding-dtype')?.trim().toLowerCase()
    if (count !== expectedCount) throw new EmbeddingServiceError('Embedding service returned an unexpected vector count')
    if (dimension !== this.dimension) {
      throw new EmbeddingServiceError(`Embedding service binary dimension mismatch: expected ${this.dimension}, got ${Number.isFinite(dimension) ? dimension : 'unknown'}`)
    }
    if (dtype !== 'float32') throw new EmbeddingServiceError(`Embedding service returned unexpected binary dtype: ${dtype ?? 'unknown'}`)

    const expectedBytes = count * dimension * 4
    if (arrayBuffer.byteLength !== expectedBytes) {
      throw new EmbeddingServiceError(`Embedding service returned ${arrayBuffer.byteLength} binary bytes; expected ${expectedBytes}`)
    }

    const rows = []
    if (HOST_LITTLE_ENDIAN) {
      const values = new Float32Array(arrayBuffer)
      for (let row = 0; row < count; row += 1) {
        rows.push(this.#assertVector(Array.from(values.subarray(row * dimension, (row + 1) * dimension))))
      }
      return rows
    }

    const view = new DataView(arrayBuffer)
    for (let row = 0; row < count; row += 1) {
      const vector = new Array(dimension)
      const offset = row * dimension
      for (let column = 0; column < dimension; column += 1) {
        vector[column] = view.getFloat32((offset + column) * 4, true)
      }
      rows.push(this.#assertVector(vector))
    }
    return rows
  }

  async health() {
    const state = await this.#request('/health')
    return Boolean(state?.ready ?? state?.status === 'ok')
  }

  async assertCompatible() {
    const state = await this.#request('/model')
    if (state?.model !== this.model) {
      throw new EmbeddingServiceError(`Embedding service model mismatch: expected ${this.model}, got ${state?.model ?? 'unknown'}`)
    }
    if (state?.dimension !== this.dimension) {
      throw new EmbeddingServiceError(`Embedding service dimension mismatch: expected ${this.dimension}, got ${state?.dimension ?? 'unknown'}`)
    }
    if (this.transport === 'binary-f32' && state?.transports?.float32_binary !== true) {
      throw new EmbeddingServiceError('Embedding service does not advertise binary-f32 transport capability')
    }
    const identity = { model: state.model, dimension: state.dimension }
    const backend = typeof state?.backend === 'string' ? state.backend.trim() : ''
    const implementation = typeof state?.implementation === 'string' ? state.implementation.trim() : ''
    if (backend) identity.backend = backend
    if (implementation) identity.implementation = implementation
    if (typeof state?.semantic === 'boolean') identity.semantic = state.semantic
    for (const key of [
      'accelerator', 'device', 'dtype', 'runtime', 'profile',
      'query_strategy', 'query_instruction_id', 'document_strategy'
    ]) {
      const value = typeof state?.[key] === 'string' ? state[key].trim() : ''
      if (value) identity[key] = value
    }
    return identity
  }

  async embedQuery(text) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('query text must be non-empty')
    const data = await this.#request('/embed/query', { text: text.trim() })
    return this.#assertVector(data.vector ?? data.vectors?.[0])
  }

  #documentMetrics({ started, finished, serverInferenceMs }) {
    const httpRoundTripMs = Math.max(0, Number(finished) - Number(started))
    const parsedServerMs = Number(serverInferenceMs)
    const hasServerTiming = Number.isFinite(parsedServerMs) && parsedServerMs >= 0
    return {
      transport: this.transport,
      serverInferenceMs: hasServerTiming ? parsedServerMs : null,
      httpRoundTripMs,
      transferOverheadMs: hasServerTiming ? Math.max(0, httpRoundTripMs - parsedServerMs) : null
    }
  }

  async embedDocumentsDetailed(texts) {
    if (!Array.isArray(texts) || !texts.length || texts.some((text) => typeof text !== 'string' || !text.trim())) {
      throw new TypeError('texts must be a non-empty array of strings')
    }
    const body = { texts: texts.map((text) => text.trim()) }
    const started = this.clock()

    if (this.transport === 'binary-f32') {
      const { response, arrayBuffer } = await this.#consumeResponse(
        '/embed/documents/binary',
        body,
        async (response) => ({ response, arrayBuffer: await response.arrayBuffer() }),
        { accept: FLOAT32_CONTENT_TYPE }
      )
      const vectors = this.#decodeBinaryVectors(arrayBuffer, response, texts.length)
      const finished = this.clock()
      return {
        vectors,
        metrics: this.#documentMetrics({
          started,
          finished,
          serverInferenceMs: response.headers.get('x-embedding-inference-ms')
        })
      }
    }

    const data = await this.#consumeResponse('/embed/documents', body, async (response) => {
      try {
        return await response.json()
      } catch (error) {
        throw new EmbeddingServiceError('Embedding service returned invalid JSON', error)
      }
    })
    const finished = this.clock()
    if (!Array.isArray(data.vectors) || data.vectors.length !== texts.length) {
      throw new EmbeddingServiceError('Embedding service returned an unexpected vector count')
    }
    return {
      vectors: data.vectors.map((vector) => this.#assertVector(vector)),
      metrics: this.#documentMetrics({ started, finished, serverInferenceMs: data.inference_ms })
    }
  }

  async embedDocuments(texts) {
    return (await this.embedDocumentsDetailed(texts)).vectors
  }
}

export class MockEmbeddingProvider {
  constructor({ dimension = 4, vectorFor = () => Array(dimension).fill(0) } = {}) {
    this.dimension = dimension
    this.vectorFor = vectorFor
  }
  async health() { return true }
  async assertCompatible() { return { model: 'mock', dimension: this.dimension, backend: 'mock-in-process', implementation: 'node-mock-provider', semantic: false } }
  async embedQuery(text) { return this.vectorFor(`query: ${text}`) }
  async embedDocuments(texts) { return texts.map((text) => this.vectorFor(`passage: ${text}`)) }
}
