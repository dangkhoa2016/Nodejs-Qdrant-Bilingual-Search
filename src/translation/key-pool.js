const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class ApiKeyPoolExhaustedError extends Error {
  constructor(provider) {
    super(`no usable API keys remain for translation provider ${provider}`)
    this.name = 'ApiKeyPoolExhaustedError'
    this.provider = provider
  }

  toJSON() { return { name: this.name, provider: this.provider } }
}

export class ApiKeyPoolCoolingError extends Error {
  constructor(provider, retryAfterMs) {
    super(`all API keys for translation provider ${provider} are cooling down`)
    this.name = 'ApiKeyPoolCoolingError'
    this.provider = provider
    this.retryAfterMs = retryAfterMs
  }

  toJSON() { return { name: this.name, provider: this.provider, retry_after_ms: this.retryAfterMs } }
}

export class ApiKeyLease {
  #secret

  constructor({ slot, secret, index }) {
    this.slot = slot
    this.index = index
    this.#secret = secret
    Object.freeze(this)
  }

  secret() { return this.#secret }
  toJSON() { return { slot: this.slot, index: this.index } }
}

export class ApiKeyPool {
  #states
  #cursor = 0
  #clock
  #sleep
  #defaultCooldownMs
  #maxWaitMs

  constructor({
    provider,
    keys,
    clock = Date.now,
    sleep = defaultSleep,
    defaultCooldownMs = 60_000,
    maxWaitMs = 60_000
  }) {
    if (typeof provider !== 'string' || !provider) throw new TypeError('provider is required')
    if (!Array.isArray(keys) || !keys.length) throw new TypeError(`at least one API key is required for ${provider}`)
    if (!Number.isInteger(defaultCooldownMs) || defaultCooldownMs < 0) throw new TypeError('defaultCooldownMs must be a non-negative integer')
    if (!Number.isInteger(maxWaitMs) || maxWaitMs < 0) throw new TypeError('maxWaitMs must be a non-negative integer')
    this.provider = provider
    this.#clock = clock
    this.#sleep = sleep
    this.#defaultCooldownMs = defaultCooldownMs
    this.#maxWaitMs = maxWaitMs
    this.#states = keys.map((entry, index) => {
      if (!entry?.slot || !entry?.secret) throw new TypeError('each API key requires slot and secret')
      return {
        index,
        slot: String(entry.slot),
        secret: String(entry.secret),
        disabled: false,
        disabledReason: null,
        cooldownUntil: 0,
        successes: 0,
        failures: 0
      }
    })
  }

  #findState(lease) {
    if (!(lease instanceof ApiKeyLease)) throw new TypeError('lease must be an ApiKeyLease')
    const state = this.#states[lease.index]
    if (!state || state.slot !== lease.slot) throw new TypeError('lease does not belong to this key pool')
    return state
  }

  #readyIndex(now) {
    for (let offset = 0; offset < this.#states.length; offset += 1) {
      const index = (this.#cursor + offset) % this.#states.length
      const state = this.#states[index]
      if (!state.disabled && state.cooldownUntil <= now) return index
    }
    return -1
  }

  async acquire({ allowWait = true } = {}) {
    const now = this.#clock()
    const readyIndex = this.#readyIndex(now)
    if (readyIndex >= 0) {
      const state = this.#states[readyIndex]
      this.#cursor = (readyIndex + 1) % this.#states.length
      return new ApiKeyLease({ slot: state.slot, secret: state.secret, index: readyIndex })
    }

    const enabled = this.#states.filter((state) => !state.disabled)
    if (!enabled.length) throw new ApiKeyPoolExhaustedError(this.provider)

    const earliest = Math.min(...enabled.map((state) => state.cooldownUntil))
    const waitMs = Math.max(0, earliest - now)
    if (!allowWait || waitMs > this.#maxWaitMs) throw new ApiKeyPoolCoolingError(this.provider, waitMs)
    if (waitMs > 0) await this.#sleep(waitMs)
    return this.acquire({ allowWait: false })
  }

  disable(lease, reason = 'disabled') {
    const state = this.#findState(lease)
    state.disabled = true
    state.disabledReason = String(reason)
    state.failures += 1
  }

  cooldown(lease, retryAfterMs = this.#defaultCooldownMs) {
    const state = this.#findState(lease)
    const delay = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.ceil(retryAfterMs) : this.#defaultCooldownMs
    state.cooldownUntil = Math.max(state.cooldownUntil, this.#clock() + delay)
    state.failures += 1
  }

  markSuccess(lease) {
    const state = this.#findState(lease)
    state.successes += 1
  }

  markFailure(lease) {
    const state = this.#findState(lease)
    state.failures += 1
  }

  snapshot() {
    const now = this.#clock()
    return this.#states.map((state) => {
      const cooling = !state.disabled && state.cooldownUntil > now
      return {
        slot: state.slot,
        status: state.disabled ? 'disabled' : cooling ? 'cooldown' : 'ready',
        disabled_reason: state.disabledReason,
        cooldown_remaining_ms: cooling ? state.cooldownUntil - now : 0,
        successes: state.successes,
        failures: state.failures
      }
    })
  }

  toJSON() {
    return { provider: this.provider, keys: this.snapshot() }
  }
}
