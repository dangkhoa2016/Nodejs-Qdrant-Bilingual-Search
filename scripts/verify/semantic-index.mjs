#!/usr/bin/env node
import { loadConfig } from '../../src/config.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { semanticIndexCompatibilityRuntime } from '../../src/embeddings/runtime-provenance.js'
import { createProductionQdrantConnection } from '../../src/qdrant/create-qdrant-connection.js'
import { QdrantService } from '../../src/qdrant/qdrant-service.js'

const expectedPoints = Number.parseInt(process.argv[2] ?? process.env.EXPECTED_POINTS ?? '20000', 10)
if (!Number.isInteger(expectedPoints) || expectedPoints < 1) {
  throw new TypeError('expected point count must be a positive integer')
}

const config = loadConfig()
const embeddingProvider = new HttpEmbeddingProvider({
  baseUrl: config.embeddingUrl,
  model: config.embeddingModel,
  dimension: config.embeddingDimension,
  timeoutMs: config.embeddingTimeoutMs,
  transport: config.embeddingTransport
})
const embeddingIdentity = await embeddingProvider.assertCompatible()
const runtime = semanticIndexCompatibilityRuntime(embeddingIdentity)

const connection = await createProductionQdrantConnection({ config })
await connection.waitUntilReady()
const qdrant = new QdrantService({
  connection,
  collection: config.qdrantCollection,
  dimension: config.embeddingDimension
})
const audit = await qdrant.verifyEmbeddingRuntime({
  expectedPoints,
  runtime,
  embeddingModel: config.embeddingModel,
  embeddingTextVersion: config.embeddingTextVersion
})

console.log(JSON.stringify({
  collection: config.qdrantCollection,
  expected_points: expectedPoints,
  embedding: embeddingIdentity,
  audit,
  verified: true
}, null, 2))
