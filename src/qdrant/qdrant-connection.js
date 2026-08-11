const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET'
])

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const noopLogger = { warn() {}, info() {}, error() {} }

function numericStatus(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode,
    error?.cause?.response?.status
  ]
  for (const value of candidates) {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed
  }
  const message = String(error?.message ?? '')
  const match = message.match(/\bHTTP\s+(\d{3})\b/i) ?? message.match(/\bstatus(?:Code)?[:= ]+(\d{3})\b/i)
  return match ? Number(match[1]) : null
}

function transportCode(error) {
  const candidates = [error?.code, error?.cause?.code, error?.errno, error?.cause?.errno]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase()
  }
  return null
}

export function isRetryableQdrantError(error) {
  const status = numericStatus(error)
  if (status === 401 || status === 403) return false
  if (status !== null) return RETRYABLE_HTTP_STATUS.has(status)
  const errorName = String(error?.name ?? '')
  if (errorName === 'QdrantClientTimeoutError' || errorName === 'QdrantClientResourceExhaustedError') return true
  const code = transportCode(error)
  if (code && RETRYABLE_TRANSPORT_CODES.has(code)) return true
  const message = String(error?.message ?? error ?? '').toLowerCase()
  return message.includes('fetch failed') || message.includes('socket hang up') || message.includes('network error')
}

export function retryDelayMs(attempt, policy, random = Math.random) {
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)))
  const jitterRatio = Number(policy.jitterRatio ?? 0)
  const jitter = base * jitterRatio * ((random() * 2) - 1)
  return Math.max(0, Math.round(base + jitter))
}

export class QdrantConnectionError extends Error {
  constructor({ provider, operation, attempts, retryable, cause }) {
    const httpStatus = numericStatus(cause)
    const code = transportCode(cause)
    super(`Qdrant operation ${operation} failed for provider ${provider} after ${attempts} attempt${attempts === 1 ? '' : 's'}`)
    this.name = 'QdrantConnectionError'
    this.code = 'QDRANT_UNAVAILABLE'
    this.provider = provider
    this.operation = operation
    this.attempts = attempts
    this.retryable = retryable
    this.httpStatus = httpStatus
    this.transportCode = code
    this.cause = cause
  }
}

export class QdrantConnection {
  #client

  constructor({
    client,
    provider,
    url,
    requestRetry,
    startupRetry,
    sleep = defaultSleep,
    random = Math.random,
    clock = () => performance.now(),
    logger = noopLogger
  }) {
    if (!client) throw new TypeError('client is required')
    if (!provider) throw new TypeError('provider is required')
    if (!requestRetry || !startupRetry) throw new TypeError('retry policies are required')
    this.#client = client
    this.provider = provider
    this.url = url
    this.requestRetry = requestRetry
    this.startupRetry = startupRetry
    this.sleep = sleep
    this.random = random
    this.clock = clock
    this.logger = logger
  }

  metadata() {
    return Object.freeze({ provider: this.provider, url: this.url })
  }

  toJSON() {
    return this.metadata()
  }

  async execute(operation, fn, { policy = this.requestRetry } = {}) {
    let lastError
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      try {
        return await fn(this.#client)
      } catch (error) {
        lastError = error
        const retryable = isRetryableQdrantError(error)
        if (!retryable || attempt >= policy.maxAttempts) {
          throw new QdrantConnectionError({
            provider: this.provider,
            operation,
            attempts: attempt,
            retryable,
            cause: error
          })
        }
        const delayMs = retryDelayMs(attempt, policy, this.random)
        this.logger.warn?.({
          event: 'qdrant_retry',
          provider: this.provider,
          operation,
          attempt,
          maxAttempts: policy.maxAttempts,
          delayMs,
          httpStatus: numericStatus(error),
          transportCode: transportCode(error)
        })
        await this.sleep(delayMs)
      }
    }
    throw new QdrantConnectionError({
      provider: this.provider,
      operation,
      attempts: policy.maxAttempts,
      retryable: isRetryableQdrantError(lastError),
      cause: lastError
    })
  }

  async probe() {
    const started = this.clock()
    try {
      await this.#client.getCollections()
      return this.#probeState({ ready: true, status: 'ready', started })
    } catch (error) {
      const httpStatus = numericStatus(error)
      const status = httpStatus === 401 || httpStatus === 403
        ? 'unauthorized'
        : isRetryableQdrantError(error) ? 'unavailable' : 'error'
      return this.#probeState({ ready: false, status, started, error })
    }
  }

  async waitUntilReady() {
    await this.execute('readiness', (client) => client.getCollections(), { policy: this.startupRetry })
    return this.#probeState({ ready: true, status: 'ready', started: this.clock() })
  }

  #probeState({ ready, status, started, error }) {
    return {
      ready,
      provider: this.provider,
      status,
      http_status: error ? numericStatus(error) : null,
      transport_code: error ? transportCode(error) : null,
      latency_ms: Number(Math.max(0, this.clock() - started).toFixed(3))
    }
  }
}
