const TRANSIENT_HTTP = new Set([408, 425, 500, 502, 503, 504])
const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'
])
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class CloudTranslationHttpError extends Error {
  constructor(provider, status) {
    super(`translation provider ${provider} returned HTTP ${status}`)
    this.name = 'CloudTranslationHttpError'
    this.provider = provider
    this.status = status
  }

  toJSON() { return { name: this.name, provider: this.provider, status: this.status } }
}

export class CloudTranslationNetworkError extends Error {
  constructor(provider, code = null) {
    super(`translation provider ${provider} request failed`)
    this.name = 'CloudTranslationNetworkError'
    this.provider = provider
    this.transportCode = code ?? null
  }

  toJSON() { return { name: this.name, provider: this.provider, transport_code: this.transportCode } }
}

export function parseRetryAfterMs(value, now = Date.now()) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.ceil(Number(raw) * 1000))
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null
}

export function cloudRetryDelayMs(attempt, { baseDelayMs, maxDelayMs, jitterRatio = 0.2, random = Math.random }) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)))
  const jitter = 1 + ((random() * 2) - 1) * jitterRatio
  return Math.max(0, Math.round(exponential * jitter))
}

function networkCode(error) {
  return error?.code ?? error?.cause?.code ?? null
}

function isRetryableNetworkError(error) {
  const code = networkCode(error)
  if (code && NETWORK_CODES.has(code)) return true
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

export class CloudTranslationExecutor {
  constructor({
    provider,
    keyPool,
    fetchImpl = fetch,
    timeoutMs = 30_000,
    maxAttempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 2_000,
    jitterRatio = 0.2,
    sleep = defaultSleep,
    random = Math.random,
    clock = Date.now
  }) {
    if (!provider) throw new TypeError('provider is required')
    if (!keyPool) throw new TypeError('keyPool is required')
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('maxAttempts must be a positive integer')
    this.provider = provider
    this.keyPool = keyPool
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
    this.maxAttempts = maxAttempts
    this.baseDelayMs = baseDelayMs
    this.maxDelayMs = maxDelayMs
    this.jitterRatio = jitterRatio
    this.sleep = sleep
    this.random = random
    this.clock = clock
  }

  async #fetch(lease, makeRequest) {
    const request = makeRequest(lease)
    if (!request?.url || !request?.init) throw new TypeError('makeRequest must return url and init')
    const init = { ...request.init }
    if (!init.signal && this.timeoutMs > 0) init.signal = AbortSignal.timeout(this.timeoutMs)
    return this.fetch(request.url, init)
  }

  async execute({ makeRequest, parse }) {
    if (typeof makeRequest !== 'function' || typeof parse !== 'function') throw new TypeError('makeRequest and parse are required')
    let lease = await this.keyPool.acquire({ allowWait: true })
    let transientAttempt = 1
    let requestCount = 0
    const maxTotalRequests = Math.max(1, this.keyPool.snapshot().length * (this.maxAttempts + 2))

    while (requestCount < maxTotalRequests) {
      requestCount += 1
      let response
      try {
        response = await this.#fetch(lease, makeRequest)
      } catch (error) {
        this.keyPool.markFailure(lease)
        if (isRetryableNetworkError(error) && transientAttempt < this.maxAttempts) {
          await this.sleep(cloudRetryDelayMs(transientAttempt, this))
          transientAttempt += 1
          continue
        }
        throw new CloudTranslationNetworkError(this.provider, networkCode(error))
      }

      if (response.ok) {
        let text
        try {
          text = await parse(response)
        } catch (error) {
          this.keyPool.markFailure(lease)
          throw error
        }
        this.keyPool.markSuccess(lease)
        return { text, keySlot: lease.slot, requests: requestCount }
      }

      if (response.status === 401 || response.status === 403) {
        this.keyPool.disable(lease, 'authentication_failed')
        lease = await this.keyPool.acquire({ allowWait: true })
        transientAttempt = 1
        continue
      }

      if (response.status === 429) {
        const retryAfter = parseRetryAfterMs(response.headers?.get?.('retry-after'), this.clock())
        this.keyPool.cooldown(lease, retryAfter ?? undefined)
        lease = await this.keyPool.acquire({ allowWait: true })
        transientAttempt = 1
        continue
      }

      if (TRANSIENT_HTTP.has(response.status) && transientAttempt < this.maxAttempts) {
        this.keyPool.markFailure(lease)
        await this.sleep(cloudRetryDelayMs(transientAttempt, this))
        transientAttempt += 1
        continue
      }

      this.keyPool.markFailure(lease)
      throw new CloudTranslationHttpError(this.provider, response.status)
    }

    throw new CloudTranslationNetworkError(this.provider, 'REQUEST_BUDGET_EXHAUSTED')
  }
}
