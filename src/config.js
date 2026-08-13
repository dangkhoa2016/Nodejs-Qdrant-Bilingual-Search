import { CANONICAL_QWEN_PROFILE } from './canonical-profile.js'
if (process.env.NODE_ENV === 'development') {
  await import('dotenv').then(({ config }) => config())
}

const PROVIDERS = new Set(['local', 'beam', 'modal'])
const EMBEDDING_TRANSPORTS = new Set(['json', 'binary-f32'])
const EMBEDDING_TEXT_VERSIONS = new Set(['v1', 'v2.1'])

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const asFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}


const asBool = (name, value, fallback) => {
  if (value == null || String(value).trim() === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const optional = (value) => {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : undefined
}

function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

function assertNonNegativeInt(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
}

function qdrantProfile(env) {
  const provider = String(env.QDRANT_PROVIDER ?? 'local').trim().toLowerCase()
  if (!PROVIDERS.has(provider)) throw new Error('QDRANT_PROVIDER must be one of local, beam or modal')

  const upper = provider.toUpperCase()
  const providerUrl = optional(env[`QDRANT_${upper}_URL`])
  const providerApiKey = optional(env[`QDRANT_${upper}_API_KEY`])
  const genericUrl = optional(env.QDRANT_URL)
  const genericApiKey = optional(env.QDRANT_API_KEY)

  const url = providerUrl ?? genericUrl ?? (provider === 'local' ? 'http://127.0.0.1:6333' : undefined)
  const apiKey = providerApiKey ?? genericApiKey

  if (!url) throw new Error(`QDRANT_${upper}_URL or QDRANT_URL is required when QDRANT_PROVIDER=${provider}`)
  let parsedUrl
  try { parsedUrl = new URL(url) } catch { throw new Error(`QDRANT_${upper}_URL or QDRANT_URL must be a valid absolute URL`) }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`QDRANT_${upper}_URL or QDRANT_URL must use http or https`)
  }
  if (provider !== 'local' && !apiKey) {
    throw new Error(`QDRANT_${upper}_API_KEY or QDRANT_API_KEY is required when QDRANT_PROVIDER=${provider}`)
  }

  const requestTimeoutMs = asInt(env.QDRANT_REQUEST_TIMEOUT_MS, 10_000)
  const requestRetry = {
    maxAttempts: asInt(env.QDRANT_RETRY_MAX_ATTEMPTS, 3),
    baseDelayMs: asInt(env.QDRANT_RETRY_BASE_DELAY_MS, 250),
    maxDelayMs: asInt(env.QDRANT_RETRY_MAX_DELAY_MS, 2_000),
    jitterRatio: asFloat(env.QDRANT_RETRY_JITTER_RATIO, 0.2)
  }
  const startupRetry = {
    maxAttempts: asInt(env.QDRANT_STARTUP_MAX_ATTEMPTS, 8),
    baseDelayMs: asInt(env.QDRANT_STARTUP_BASE_DELAY_MS, 500),
    maxDelayMs: asInt(env.QDRANT_STARTUP_MAX_DELAY_MS, 5_000),
    jitterRatio: requestRetry.jitterRatio
  }

  assertPositiveInt('QDRANT_REQUEST_TIMEOUT_MS', requestTimeoutMs)
  assertPositiveInt('QDRANT_RETRY_MAX_ATTEMPTS', requestRetry.maxAttempts)
  assertNonNegativeInt('QDRANT_RETRY_BASE_DELAY_MS', requestRetry.baseDelayMs)
  assertNonNegativeInt('QDRANT_RETRY_MAX_DELAY_MS', requestRetry.maxDelayMs)
  assertPositiveInt('QDRANT_STARTUP_MAX_ATTEMPTS', startupRetry.maxAttempts)
  assertNonNegativeInt('QDRANT_STARTUP_BASE_DELAY_MS', startupRetry.baseDelayMs)
  assertNonNegativeInt('QDRANT_STARTUP_MAX_DELAY_MS', startupRetry.maxDelayMs)
  if (requestRetry.maxDelayMs < requestRetry.baseDelayMs) throw new Error('QDRANT_RETRY_MAX_DELAY_MS must be >= QDRANT_RETRY_BASE_DELAY_MS')
  if (startupRetry.maxDelayMs < startupRetry.baseDelayMs) throw new Error('QDRANT_STARTUP_MAX_DELAY_MS must be >= QDRANT_STARTUP_BASE_DELAY_MS')
  if (requestRetry.jitterRatio < 0 || requestRetry.jitterRatio > 1) throw new Error('QDRANT_RETRY_JITTER_RATIO must be between 0 and 1')

  return Object.freeze({
    provider,
    url,
    apiKey,
    requestTimeoutMs,
    requestRetry: Object.freeze(requestRetry),
    startupRetry: Object.freeze(startupRetry)
  })
}

export function loadConfig(env = process.env) {
  const config = {
    port: asInt(env.PORT, 3000),
    qdrant: qdrantProfile(env),
    qdrantCollection: env.QDRANT_COLLECTION ?? CANONICAL_QWEN_PROFILE.collection,
    embeddingUrl: env.EMBEDDING_URL ?? 'http://127.0.0.1:8001',
    embeddingModel: env.EMBEDDING_MODEL ?? CANONICAL_QWEN_PROFILE.embeddingModel,
    embeddingDimension: asInt(env.EMBEDDING_DIMENSION, CANONICAL_QWEN_PROFILE.embeddingDimension),
    embeddingTimeoutMs: asInt(env.EMBEDDING_REQUEST_TIMEOUT_MS, CANONICAL_QWEN_PROFILE.embeddingTimeoutMs),
    embeddingTransport: String(env.EMBEDDING_TRANSPORT ?? CANONICAL_QWEN_PROFILE.embeddingTransport).trim().toLowerCase(),
    embeddingTextVersion: String(env.EMBEDDING_TEXT_VERSION ?? CANONICAL_QWEN_PROFILE.embeddingTextVersion).trim(),
    seedProgressPath: env.SEED_PROGRESS_PATH ?? 'reports/seed-progress.json',
    seedProgressEventsPath: env.SEED_PROGRESS_EVENTS_PATH ?? 'reports/seed-progress.jsonl',
    seedProgressEveryBatches: asInt(env.SEED_PROGRESS_EVERY_BATCHES, 0),
    searchDefaultLimit: asInt(env.SEARCH_DEFAULT_LIMIT, 10),
    searchMaxLimit: asInt(env.SEARCH_MAX_LIMIT, 100),
    searchDefaultScoreThreshold: asFloat(env.SEARCH_DEFAULT_SCORE_THRESHOLD, CANONICAL_QWEN_PROFILE.searchDefaultScoreThreshold),
    searchConsistencyVerificationEnabled: asBool('SEARCH_CONSISTENCY_VERIFICATION_ENABLED', env.SEARCH_CONSISTENCY_VERIFICATION_ENABLED, CANONICAL_QWEN_PROFILE.searchConsistencyVerificationEnabled),
    searchConsistencyCandidateMultiplier: asInt(env.SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER, CANONICAL_QWEN_PROFILE.searchConsistencyCandidateMultiplier),
    searchDomainEntityIntentGateEnabled: asBool('SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED', env.SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED, CANONICAL_QWEN_PROFILE.searchDomainEntityIntentGateEnabled)
  }

  if (config.port < 1 || config.port > 65535) throw new Error('PORT must be between 1 and 65535')
  if (config.embeddingDimension < 1) throw new Error('EMBEDDING_DIMENSION must be positive')
  assertPositiveInt('EMBEDDING_REQUEST_TIMEOUT_MS', config.embeddingTimeoutMs)
  if (!EMBEDDING_TRANSPORTS.has(config.embeddingTransport)) throw new Error('EMBEDDING_TRANSPORT must be json or binary-f32')
  if (!EMBEDDING_TEXT_VERSIONS.has(config.embeddingTextVersion)) throw new Error('EMBEDDING_TEXT_VERSION must be v1 or v2.1')
  assertNonNegativeInt('SEED_PROGRESS_EVERY_BATCHES', config.seedProgressEveryBatches)
  if (config.searchDefaultLimit < 1 || config.searchMaxLimit < config.searchDefaultLimit) {
    throw new Error('Search limit configuration is invalid')
  }
  if (config.searchDefaultScoreThreshold < 0 || config.searchDefaultScoreThreshold > 1) {
    throw new Error('SEARCH_DEFAULT_SCORE_THRESHOLD must be between 0 and 1')
  }
  assertPositiveInt('SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER', config.searchConsistencyCandidateMultiplier)

  return Object.freeze(config)
}
