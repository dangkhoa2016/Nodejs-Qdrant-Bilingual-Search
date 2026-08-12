import { HttpEmbeddingProvider } from '../embeddings/http-embedding-provider.js'
import { EntityService } from '../entities/entity-service.js'
import { QdrantService } from '../qdrant/qdrant-service.js'
import { createProductionQdrantConnection } from '../qdrant/create-qdrant-connection.js'
import { SearchService } from '../search/search-service.js'
import { createReadinessCheck } from './readiness.js'

export async function createRuntime({
  config,
  qdrantConnectionFactory = createProductionQdrantConnection,
  embeddingProviderFactory = (options) => new HttpEmbeddingProvider(options),
  logger = console
}) {
  if (!config) throw new TypeError('config is required')

  const qdrantConnection = await qdrantConnectionFactory({ config, logger })
  const qdrant = new QdrantService({
    connection: qdrantConnection,
    collection: config.qdrantCollection,
    dimension: config.embeddingDimension
  })
  const embeddingProvider = embeddingProviderFactory({
    baseUrl: config.embeddingUrl,
    model: config.embeddingModel,
    dimension: config.embeddingDimension,
    timeoutMs: config.embeddingTimeoutMs,
    transport: config.embeddingTransport
  })
  const searchService = new SearchService({ embeddingProvider, qdrant, config })
  const entityService = new EntityService({ qdrant })
  const readiness = createReadinessCheck({ qdrantConnection, embeddingProvider })

  return { qdrantConnection, qdrant, embeddingProvider, searchService, entityService, readiness }
}
