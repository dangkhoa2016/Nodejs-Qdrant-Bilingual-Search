import { loadConfig } from '../../src/config.js'
import { loadEntities } from '../../src/dataset/io.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { createProductionQdrantConnection } from '../../src/qdrant/create-qdrant-connection.js'
import { QdrantService } from '../../src/qdrant/qdrant-service.js'
import { SeedService, assertEmbeddingTextCollectionSafety } from '../../src/seed/seed-service.js'
import { createSeedProgressOutput } from '../../src/seed/progress-output.js'

const config = loadConfig()
assertEmbeddingTextCollectionSafety({ embeddingTextVersion: config.embeddingTextVersion, collection: config.qdrantCollection })
const path = process.argv[2] ?? 'data/fixtures/tiny.json'
const entities = await loadEntities(path)
const connection = await createProductionQdrantConnection({ config })
await connection.waitUntilReady()
const qdrant = new QdrantService({ connection, collection: config.qdrantCollection, dimension: config.embeddingDimension })
const embeddingProvider = new HttpEmbeddingProvider({
  baseUrl: config.embeddingUrl,
  model: config.embeddingModel,
  dimension: config.embeddingDimension,
  timeoutMs: config.embeddingTimeoutMs,
  transport: config.embeddingTransport
})
const service = new SeedService({
  qdrant,
  embeddingProvider,
  batchSize: Number.parseInt(process.env.SEED_BATCH_SIZE ?? '64', 10),
  metadata: {
    embeddingModel: config.embeddingModel,
    embeddingVersion: process.env.EMBEDDING_VERSION ?? 'v1',
    datasetVersion: process.env.DATASET_VERSION ?? 'fixture-v1',
    embeddingTextVersion: config.embeddingTextVersion
  }
})

const onProgress = createSeedProgressOutput({
  collection: config.qdrantCollection,
  embeddingModel: config.embeddingModel,
  progressPath: config.seedProgressPath,
  eventsPath: config.seedProgressEventsPath,
  everyBatches: config.seedProgressEveryBatches
})

console.error(`[seed] progress snapshot: ${config.seedProgressPath}`)
console.error(`[seed] progress events: ${config.seedProgressEventsPath}`)
console.log(JSON.stringify(await service.seed(entities, { onProgress }), null, 2))
