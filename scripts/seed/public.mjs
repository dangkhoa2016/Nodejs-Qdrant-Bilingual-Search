#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parsePublicSeedArgs } from '../../src/cli/options.js'
import { buildPublicDataset } from '../../src/dataset/public-builder.js'
import { translateDataset } from '../../src/dataset/translation.js'
import { loadConfig } from '../../src/config.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { createProductionQdrantConnection } from '../../src/qdrant/create-qdrant-connection.js'
import { QdrantService } from '../../src/qdrant/qdrant-service.js'
import { SeedService, assertEmbeddingTextCollectionSafety } from '../../src/seed/seed-service.js'
import { createSeedProgressOutput } from '../../src/seed/progress-output.js'
import { PublicSeedOrchestrator } from '../../src/seed/public-seed-orchestrator.js'
import { loadTranslationConfig } from '../../src/translation/config.js'
import { createTranslationProvider } from '../../src/translation/create-provider.js'
import { JsonlTranslationCache } from '../../src/translation/cache.js'
import { TranslationService } from '../../src/translation/service.js'

const options = parsePublicSeedArgs(process.argv.slice(2))
let activeTranslationConfig = null
let seedRuntimePromise = null

function getSeedRuntime() {
  if (!seedRuntimePromise) {
    seedRuntimePromise = (async () => {
      const config = loadConfig()
      assertEmbeddingTextCollectionSafety({ embeddingTextVersion: config.embeddingTextVersion, collection: config.qdrantCollection })
      const connection = await createProductionQdrantConnection({ config })
      await connection.waitUntilReady()
      const qdrant = new QdrantService({
        connection,
        collection: config.qdrantCollection,
        dimension: config.embeddingDimension
      })
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
        requireSemanticBackend: true,
        batchSize: Number.parseInt(process.env.SEED_BATCH_SIZE ?? '64', 10),
        metadata: {
          embeddingModel: config.embeddingModel,
          embeddingVersion: process.env.EMBEDDING_VERSION ?? 'v1',
          datasetVersion: process.env.DATASET_VERSION ?? 'public-v1',
          embeddingTextVersion: config.embeddingTextVersion
        }
      })
      return { service, config }
    })()
  }
  return seedRuntimePromise
}

const orchestrator = new PublicSeedOrchestrator({
  preflightInfrastructure: async () => {
    const { service } = await getSeedRuntime()
    await service.preflight()
  },
  buildDataset: (buildOptions) => buildPublicDataset(buildOptions),
  createTranslator: async ({ provider, model }) => {
    const env = { ...process.env, TRANSLATION_PROVIDER: provider }
    if (model) env.TRANSLATION_MODEL = model
    activeTranslationConfig = loadTranslationConfig(env)
    const cloudOrLocal = createTranslationProvider({ config: activeTranslationConfig, env })
    const cache = new JsonlTranslationCache(resolve(activeTranslationConfig.cachePath))
    return new TranslationService({ provider: cloudOrLocal, cache, translationVersion: activeTranslationConfig.version })
  },
  translateEntities: (entities, { translator, fields }) => translateDataset(entities, {
    translator,
    fields,
    model: activeTranslationConfig.model,
    translationVersion: activeTranslationConfig.version,
    concurrency: activeTranslationConfig.concurrency
  }),
  seedEntities: async (entities) => {
    const { service, config } = await getSeedRuntime()
    const onProgress = createSeedProgressOutput({
      collection: config.qdrantCollection,
      embeddingModel: config.embeddingModel,
      progressPath: config.seedProgressPath,
      eventsPath: config.seedProgressEventsPath,
      everyBatches: config.seedProgressEveryBatches
    })
    console.error(`[seed] progress snapshot: ${config.seedProgressPath}`)
    console.error(`[seed] progress events: ${config.seedProgressEventsPath}`)
    return service.seed(entities, { onProgress })
  }
})

const result = await orchestrator.run({
  buildOptions: {
    sources: options.sources,
    types: options.types,
    limit: options.limit,
    wofOptions: { cacheDir: resolve(options.wofCacheDir), refresh: options.wofRefresh }
  },
  translation: {
    provider: options.translationProvider,
    model: options.translationModel,
    fields: options.translationFields
  },
  dryRun: options.dryRun
})

const reportPath = resolve(options.report)
await mkdir(dirname(reportPath), { recursive: true })
const safeReport = { ...result, entities: undefined }
await writeFile(reportPath, `${JSON.stringify(safeReport, null, 2)}\n`, 'utf8')

if (!options.dryRun) {
  const datasetPath = resolve(options.datasetOutput)
  const manifestPath = resolve(options.manifest)
  await mkdir(dirname(datasetPath), { recursive: true })
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(datasetPath, `${JSON.stringify(result.entities, null, 2)}\n`, 'utf8')
  await writeFile(manifestPath, `${JSON.stringify({
    ...result.build,
    translation: result.translation,
    seed: result.seed,
    generatedAt: result.generatedAt
  }, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({
  dryRun: result.dryRun,
  plan: result.plan,
  build: result.build,
  translation: result.translation,
  seed: result.seed,
  datasetOutput: options.dryRun ? null : resolve(options.datasetOutput),
  manifest: options.dryRun ? null : resolve(options.manifest),
  report: reportPath
}, null, 2))
