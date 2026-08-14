import { requireVerifiedSemanticEmbeddingRuntime } from '../embeddings/runtime-provenance.js'

async function fetchJson(fetchImpl, url, label, { allowHttpError = false } = {}) {
  let response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new Error(`${label} request failed: ${error.message}`, { cause: error })
  }

  let body
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error })
  }

  if (!response.ok && !allowHttpError) {
    throw new Error(`${label} returned HTTP ${response.status}`)
  }
  return { response, body }
}

export async function collectBenchmarkPreflight({
  apiUrl,
  embeddingUrlOverride,
  expectedBackend = 'sentence-transformers',
  expectedImplementation = 'python-fastapi',
  fetchImpl = fetch
} = {}) {
  if (typeof apiUrl !== 'string' || !apiUrl.trim()) throw new TypeError('apiUrl is required')
  const baseApiUrl = apiUrl.replace(/\/$/, '')

  const readyResult = await fetchJson(fetchImpl, `${baseApiUrl}/ready`, 'benchmark readiness', { allowHttpError: true })
  if (!readyResult.response.ok || readyResult.body?.ready !== true) {
    throw new Error(`benchmark API is not ready (HTTP ${readyResult.response.status})`)
  }

  const { body: infoEnvelope } = await fetchJson(fetchImpl, `${baseApiUrl}/api/v1/info`, 'benchmark info')
  const { body: statsEnvelope } = await fetchJson(fetchImpl, `${baseApiUrl}/api/v1/stats`, 'benchmark stats')
  const info = infoEnvelope?.info ?? infoEnvelope
  const stats = statsEnvelope?.stats ?? statsEnvelope
  const config = info?.config ?? {}
  const embeddingUrl = String(embeddingUrlOverride ?? config.embeddingUrl ?? '').trim().replace(/\/$/, '')
  if (!embeddingUrl) throw new Error('benchmark embedding URL is unavailable from API info')

  const { body: embedding } = await fetchJson(fetchImpl, `${embeddingUrl}/model`, 'embedding model')
  if (config.embeddingModel && embedding?.model !== config.embeddingModel) {
    throw new Error(`benchmark embedding model mismatch: expected ${config.embeddingModel}, got ${embedding?.model ?? 'unknown'}`)
  }
  if (config.embeddingDimension && embedding?.dimension !== config.embeddingDimension) {
    throw new Error(`benchmark embedding dimension mismatch: expected ${config.embeddingDimension}, got ${embedding?.dimension ?? 'unknown'}`)
  }
  const runtime = requireVerifiedSemanticEmbeddingRuntime(embedding)
  if (expectedBackend && runtime.backend !== expectedBackend) {
    throw new Error(`benchmark embedding backend mismatch: expected ${expectedBackend}, got ${runtime.backend}`)
  }
  if (expectedImplementation && runtime.implementation !== expectedImplementation) {
    throw new Error(`benchmark embedding implementation mismatch: expected ${expectedImplementation}, got ${runtime.implementation}`)
  }

  return { ready: readyResult.body, info, stats, embedding }
}
