import { HttpTranslator } from '../dataset/http-translator.js'
import { discoverProviderApiKeys } from './credentials.js'
import { ApiKeyPool } from './key-pool.js'
import { CloudTranslationExecutor } from './cloud-executor.js'
import { OpenAIResponsesTranslationProvider } from './providers/openai-responses.js'
import { GeminiTranslationProvider } from './providers/gemini.js'
import { OpenAICompatibleChatTranslationProvider } from './providers/openai-compatible-chat.js'

export function createTranslationProvider({
  config,
  env = process.env,
  fetchImpl = fetch,
  sleep,
  clock,
  random
}) {
  if (!config?.provider) throw new TypeError('translation config is required')
  if (config.provider === 'none') return null
  if (config.provider === 'local') {
    return new HttpTranslator({ baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs, fetchImpl })
  }

  const keys = discoverProviderApiKeys(env, config.provider)
  if (!keys.length) throw new Error(`no API keys configured for ${config.provider}`)

  const keyPool = new ApiKeyPool({
    provider: config.provider,
    keys,
    defaultCooldownMs: config.keyPool.defaultCooldownMs,
    maxWaitMs: config.keyPool.maxWaitMs,
    ...(clock ? { clock } : {}),
    ...(sleep ? { sleep } : {})
  })
  const executor = new CloudTranslationExecutor({
    provider: config.provider,
    keyPool,
    fetchImpl,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.retry.maxAttempts,
    baseDelayMs: config.retry.baseDelayMs,
    maxDelayMs: config.retry.maxDelayMs,
    jitterRatio: config.retry.jitterRatio,
    ...(sleep ? { sleep } : {}),
    ...(clock ? { clock } : {}),
    ...(random ? { random } : {})
  })

  if (config.provider === 'openai') {
    return new OpenAIResponsesTranslationProvider({ model: config.model, executor, baseUrl: config.baseUrl })
  }
  if (config.provider === 'gemini') {
    return new GeminiTranslationProvider({ model: config.model, executor, baseUrl: config.baseUrl })
  }
  return new OpenAICompatibleChatTranslationProvider({
    provider: config.provider,
    model: config.model,
    executor,
    baseUrl: config.baseUrl
  })
}
