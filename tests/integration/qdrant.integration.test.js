import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../../src/config.js'
import { normalizeEntity } from '../../src/domain/entity.js'
import { MockEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { createProductionQdrantConnection } from '../../src/qdrant/create-qdrant-connection.js'
import { QdrantService } from '../../src/qdrant/qdrant-service.js'
import { SeedService } from '../../src/seed/seed-service.js'

const enabled = process.env.RUN_QDRANT_INTEGRATION === '1'

test('production connection seeds idempotently, queries and verifies exact collection state', { skip: !enabled }, async (t) => {
  const config = loadConfig(process.env)
  const connection = await createProductionQdrantConnection({ config, logger: { warn() {}, info() {}, error() {} } })
  await connection.waitUntilReady()

  const collection = `integration_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const qdrant = new QdrantService({ connection, collection, dimension: 3 })
  t.after(async () => {
    await connection.execute('deleteCollection', (client) => client.deleteCollection(collection)).catch(() => {})
  })

  const entities = [
    normalizeEntity({ id: 'Q1', type: 'country', name: { en: 'One' }, continent: 'Asia', population: 10 }),
    normalizeEntity({ id: 'Q2', type: 'city', name: { en: 'Two' }, continent: 'Europe', population: 20 })
  ]
  const vectors = new Map([
    ['passage: One.\nContinent: Asia.', [1, 0, 0]],
    ['passage: Two.\nContinent: Europe.', [0, 1, 0]]
  ])
  const seed = new SeedService({
    qdrant,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 3, vectorFor: (text) => vectors.get(text) ?? [0, 0, 1] }),
    batchSize: 2,
    metadata: { embeddingModel: 'mock', embeddingVersion: 'v1', datasetVersion: 'integration-v1' }
  })

  const first = await seed.seed(entities)
  assert.equal(first.mode, 'fresh')
  assert.equal(first.points_after, 2)

  const second = await seed.seed(entities)
  assert.equal(second.mode, 'idempotent')
  assert.equal(second.embedded, 0)
  assert.equal(second.upserted, 0)
  assert.equal(second.skipped_existing, 2)

  const points = await qdrant.querySemantic({ vector: [1, 0, 0], filter: { must: [{ key: 'type', match: { value: 'country' } }] }, limit: 5, scoreThreshold: 0 })
  assert.equal(points.length, 1)
  assert.equal(points[0].payload.entity_id, 'Q1')
  assert.equal((await qdrant.stats()).points_count, 2)
})
