import { QdrantConnection } from './qdrant-connection.js'

export function createQdrantConnection({
  config,
  ClientClass,
  logger,
  sleep,
  random,
  clock
} = {}) {
  if (!config?.qdrant) throw new TypeError('config.qdrant is required')
  if (typeof ClientClass !== 'function') throw new TypeError('ClientClass is required')

  const profile = config.qdrant
  const client = new ClientClass({
    url: profile.url,
    apiKey: profile.apiKey,
    timeout: profile.requestTimeoutMs
  })

  return new QdrantConnection({
    client,
    provider: profile.provider,
    url: profile.url,
    requestRetry: profile.requestRetry,
    startupRetry: profile.startupRetry,
    logger,
    sleep,
    random,
    clock
  })
}

export async function createProductionQdrantConnection(options = {}) {
  const { QdrantClient } = await import('@qdrant/js-client-rest')
  return createQdrantConnection({ ...options, ClientClass: QdrantClient })
}
