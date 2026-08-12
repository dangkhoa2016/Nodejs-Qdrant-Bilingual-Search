const ALLOWED_TRANSPORTS = new Set(['json', 'binary-f32'])

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits))
}

function rate(count, elapsedMs) {
  return elapsedMs > 0 ? round(count / (elapsedMs / 1000)) : 0
}

function assertTimingMetrics(metrics, transport) {
  if (!metrics || metrics.transport !== transport) throw new Error(`missing timing metrics for ${transport}`)
  for (const key of ['serverInferenceMs', 'httpRoundTripMs', 'transferOverheadMs']) {
    if (!Number.isFinite(metrics[key]) || metrics[key] < 0) {
      throw new Error(`missing timing metrics for ${transport}: ${key}`)
    }
  }
}

export async function benchmarkEmbeddingTransports({
  documents,
  batchSize = 64,
  transports = ['json', 'binary-f32'],
  providerFactory,
  clock = () => performance.now()
}) {
  if (!Array.isArray(documents) || !documents.length || documents.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new TypeError('documents must be a non-empty array of strings')
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) {
    throw new TypeError('batchSize must be between 1 and 256')
  }
  if (!Array.isArray(transports) || !transports.length || transports.some((transport) => !ALLOWED_TRANSPORTS.has(transport))) {
    throw new TypeError('transports must contain json and/or binary-f32')
  }
  if (typeof providerFactory !== 'function') throw new TypeError('providerFactory is required')

  const entries = []
  let expectedIdentity = null

  for (const transport of transports) {
    const provider = providerFactory(transport)
    if (!provider || typeof provider.assertCompatible !== 'function' || typeof provider.embedDocumentsDetailed !== 'function') {
      throw new TypeError('providerFactory must return a compatible detailed embedding provider')
    }
    const identity = await provider.assertCompatible()
    const comparableIdentity = { model: identity?.model, dimension: identity?.dimension }
    if (!expectedIdentity) expectedIdentity = comparableIdentity
    if (comparableIdentity.model !== expectedIdentity.model || comparableIdentity.dimension !== expectedIdentity.dimension) {
      throw new Error('embedding identity changed between transport benchmark runs')
    }

    let serverInferenceMs = 0
    let httpRoundTripMs = 0
    let transferOverheadMs = 0
    let requests = 0
    const started = clock()

    for (let offset = 0; offset < documents.length; offset += batchSize) {
      const batch = documents.slice(offset, offset + batchSize)
      const result = await provider.embedDocumentsDetailed(batch)
      if (!Array.isArray(result?.vectors) || result.vectors.length !== batch.length) {
        throw new Error(`${transport} returned an unexpected vector count`)
      }
      assertTimingMetrics(result.metrics, transport)
      serverInferenceMs += result.metrics.serverInferenceMs
      httpRoundTripMs += result.metrics.httpRoundTripMs
      transferOverheadMs += result.metrics.transferOverheadMs
      requests += 1
    }

    const wallMs = Math.max(0, clock() - started)
    entries.push({
      transport,
      requests,
      documents: documents.length,
      serverInferenceMs: round(serverInferenceMs),
      httpRoundTripMs: round(httpRoundTripMs),
      transferOverheadMs: round(transferOverheadMs),
      wallMs: round(wallMs),
      serverInferenceDocsPerSecond: rate(documents.length, serverInferenceMs),
      httpDocsPerSecond: rate(documents.length, httpRoundTripMs),
      endToEndDocsPerSecond: rate(documents.length, wallMs)
    })
  }

  return {
    model: expectedIdentity?.model ?? null,
    dimension: expectedIdentity?.dimension ?? null,
    documents: documents.length,
    batchSize,
    transports: entries
  }
}
