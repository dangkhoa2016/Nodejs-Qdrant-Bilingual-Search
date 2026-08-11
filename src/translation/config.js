const PROVIDERS = new Set(['none', 'local', 'openai', 'gemini', 'nvidia', 'groq'])
const CLOUD = new Set(['openai', 'gemini', 'nvidia', 'groq'])

const DEFAULT_BASE_URLS = Object.freeze({
  local: 'http://127.0.0.1:8001',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  groq: 'https://api.groq.com/openai/v1'
})

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const asFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function positive(name, value) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

function nonNegative(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
}

function baseUrlFor(env, provider) {
  if (provider === 'none') return undefined
  const names = {
    local: ['TRANSLATION_URL'],
    openai: ['OPENAI_BASE_URL'],
    gemini: ['GEMINI_BASE_URL'],
    nvidia: ['NVIDIA_BASE_URL'],
    groq: ['GROQ_BASE_URL']
  }[provider]
  const candidate = names.map((name) => String(env[name] ?? '').trim()).find(Boolean) ?? DEFAULT_BASE_URLS[provider]
  let parsed
  try { parsed = new URL(candidate) } catch { throw new Error('translation base URL must be a valid absolute URL') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('translation base URL must use http or https')
  return candidate.replace(/\/$/, '')
}

export function loadTranslationConfig(env = process.env) {
  const provider = String(env.TRANSLATION_PROVIDER ?? 'none').trim().toLowerCase()
  if (!PROVIDERS.has(provider)) throw new Error('TRANSLATION_PROVIDER must be one of none, local, openai, gemini, nvidia or groq')

  const configuredModel = String(env.TRANSLATION_MODEL ?? '').trim() || undefined
  const model = provider === 'local' ? (configuredModel ?? 'Helsinki-NLP/opus-mt-en-vi') : configuredModel
  if (CLOUD.has(provider) && !model) throw new Error(`TRANSLATION_MODEL is required when TRANSLATION_PROVIDER=${provider}`)

  const config = {
    provider,
    model,
    baseUrl: baseUrlFor(env, provider),
    timeoutMs: asInt(env.TRANSLATION_TIMEOUT_MS, 30_000),
    concurrency: asInt(env.TRANSLATION_CONCURRENCY, 4),
    retry: {
      maxAttempts: asInt(env.TRANSLATION_RETRY_MAX_ATTEMPTS, 3),
      baseDelayMs: asInt(env.TRANSLATION_RETRY_BASE_DELAY_MS, 250),
      maxDelayMs: asInt(env.TRANSLATION_RETRY_MAX_DELAY_MS, 2_000),
      jitterRatio: asFloat(env.TRANSLATION_RETRY_JITTER_RATIO, 0.2)
    },
    keyPool: {
      defaultCooldownMs: asInt(env.TRANSLATION_KEY_COOLDOWN_MS, 60_000),
      maxWaitMs: asInt(env.TRANSLATION_KEY_MAX_WAIT_MS, 60_000),
      strategy: String(env.TRANSLATION_KEY_STRATEGY ?? 'round-robin').trim().toLowerCase()
    },
    cachePath: String(env.TRANSLATION_CACHE_PATH ?? 'data/generated/translation-cache.jsonl').trim(),
    version: String(env.TRANSLATION_VERSION ?? 'v1').trim() || 'v1'
  }

  positive('TRANSLATION_TIMEOUT_MS', config.timeoutMs)
  positive('TRANSLATION_CONCURRENCY', config.concurrency)
  positive('TRANSLATION_RETRY_MAX_ATTEMPTS', config.retry.maxAttempts)
  nonNegative('TRANSLATION_RETRY_BASE_DELAY_MS', config.retry.baseDelayMs)
  nonNegative('TRANSLATION_RETRY_MAX_DELAY_MS', config.retry.maxDelayMs)
  if (config.retry.maxDelayMs < config.retry.baseDelayMs) throw new Error('TRANSLATION_RETRY_MAX_DELAY_MS must be >= TRANSLATION_RETRY_BASE_DELAY_MS')
  if (config.retry.jitterRatio < 0 || config.retry.jitterRatio > 1) throw new Error('TRANSLATION_RETRY_JITTER_RATIO must be between 0 and 1')
  nonNegative('TRANSLATION_KEY_COOLDOWN_MS', config.keyPool.defaultCooldownMs)
  nonNegative('TRANSLATION_KEY_MAX_WAIT_MS', config.keyPool.maxWaitMs)
  if (config.keyPool.strategy !== 'round-robin') throw new Error('TRANSLATION_KEY_STRATEGY currently supports round-robin only')
  if (!config.cachePath) throw new Error('TRANSLATION_CACHE_PATH must not be empty')

  return Object.freeze({
    ...config,
    retry: Object.freeze(config.retry),
    keyPool: Object.freeze(config.keyPool)
  })
}
