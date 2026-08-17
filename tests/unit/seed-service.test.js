import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'
import { SeedService } from '../../src/seed/seed-service.js'

const entities = [1, 2, 3].map((n) => normalizeEntity({ id: `Q${n}`, type: 'city', name: { en: `City ${n}` } }))

function seedHarness({ preflightMode = 'fresh', before = 0 } = {}) {
  const upserts = []
  const calls = []
  let ensureCount = 0
  const qdrant = {
    ensureCollection: async () => { ensureCount++ },
    preflightSeed: async ({ indexFingerprint, expectedPoints }) => {
      calls.push(['preflight', indexFingerprint, expectedPoints])
      return { mode: preflightMode, pointsCount: before, matchingCount: before }
    },
    upsertPoints: async (points) => upserts.push(points),
    verifySeed: async ({ indexFingerprint, expectedPoints }) => {
      calls.push(['verify', indexFingerprint, expectedPoints])
      return { pointsCount: expectedPoints, matchingCount: expectedPoints }
    }
  }
  const embeddingProvider = {
    health: async () => true,
    assertCompatible: async () => ({ model: 'test', dimension: 2 }),
    embedDocuments: async (texts) => texts.map((_, i) => [i, 1])
  }
  return { upserts, calls, qdrant, embeddingProvider, ensureCount: () => ensureCount }
}

test('SeedService batches embeddings/upserts and verifies exact idempotent index state', async () => {
  const harness = seedHarness()
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant,
    clock: (() => { let n = 0; return () => ++n })()
  })
  const report = await service.seed(entities)
  const ids = harness.upserts.flat().map((point) => point.id)
  assert.equal(new Set(ids).size, 3)
  assert.equal(harness.upserts.flat().every((point) => point.payload.index_fingerprint === report.index_fingerprint), true)
  assert.equal(report.read, 3)
  assert.equal(report.embedded, 3)
  assert.equal(report.upserted, 3)
  assert.equal(report.batches, 2)
  assert.equal(report.skipped_existing, 0)
  assert.equal(report.mode, 'fresh')
  assert.equal(report.points_before, 0)
  assert.equal(report.matching_before, 0)
  assert.equal(report.points_after, 3)
  assert.equal(report.matching_after, 3)
  assert.ok(report.elapsed_ms > 0)
  assert.ok(report.embedding_ms > 0)
  assert.ok(report.qdrant_upsert_ms > 0)
  assert.match(report.index_fingerprint, /^sha256:[0-9a-f]{64}$/)
  assert.equal(harness.ensureCount(), 1)
  assert.equal(harness.calls[0][0], 'preflight')
  assert.equal(harness.calls.at(-1)[0], 'verify')
})

test('SeedService skips embedding/upsert when the exact index fingerprint is already complete', async () => {
  const harness = seedHarness({ preflightMode: 'idempotent', before: 3 })
  let embedCalls = 0
  harness.embeddingProvider.embedDocuments = async () => { embedCalls++; throw new Error('must not embed') }
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant,
    clock: (() => { let n = 0; return () => ++n })()
  })
  const report = await service.seed(entities)
  assert.equal(embedCalls, 0)
  assert.equal(harness.upserts.length, 0)
  assert.equal(report.mode, 'idempotent')
  assert.equal(report.skipped_existing, 3)
  assert.equal(report.points_after, 3)
})

test('SeedService rejects batch sizes larger than embedding service contract', () => {
  const harness = seedHarness()
  assert.throws(() => new SeedService({
    batchSize: 257,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant
  }), /batchSize must be between 1 and 256/)
})

test('SeedService revalidates infrastructure when seed begins after an earlier preflight', async () => {
  const calls = []
  const harness = seedHarness()
  harness.embeddingProvider.health = async () => { calls.push('embedding:health'); return true }
  harness.embeddingProvider.assertCompatible = async () => { calls.push('embedding:model'); return { model: 'test', dimension: 2 } }
  harness.qdrant.ensureCollection = async () => { calls.push('qdrant:schema') }
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant
  })
  await service.preflight()
  await service.seed(entities)
  assert.deepEqual(calls, [
    'embedding:health', 'embedding:model', 'qdrant:schema',
    'embedding:health', 'embedding:model', 'qdrant:schema'
  ])
})

test('SeedService public semantic preflight rejects mock or unverified embedding runtimes', async () => {
  for (const embedding of [
    { model: 'test', dimension: 2, backend: 'mock-deterministic', implementation: 'node-mock', semantic: false },
    { model: 'test', dimension: 2 }
  ]) {
    const harness = seedHarness()
    harness.embeddingProvider.assertCompatible = async () => embedding
    const service = new SeedService({
      batchSize: 2,
      requireSemanticBackend: true,
      metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
      embeddingProvider: harness.embeddingProvider,
      qdrant: harness.qdrant
    })
    await assert.rejects(() => service.preflight(), /verified semantic embedding backend/)
  }
})

test('SeedService fingerprints and reports the verified embedding runtime provenance', async () => {
  const harness = seedHarness()
  harness.embeddingProvider.assertCompatible = async () => ({
    model: 'test', dimension: 2,
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true
  })
  const service = new SeedService({
    batchSize: 2,
    requireSemanticBackend: true,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant,
    clock: (() => { let n = 0; return () => ++n })()
  })
  const report = await service.seed(entities)
  assert.deepEqual(report.embedding_runtime, {
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true
  })
  assert.equal(harness.upserts.flat().every((point) => point.payload.embedding_backend === 'sentence-transformers'), true)
  assert.equal(harness.upserts.flat().every((point) => point.payload.embedding_implementation === 'python-fastapi'), true)
  assert.equal(harness.upserts.flat().every((point) => point.payload.embedding_semantic === true), true)
})

test('SeedService emits structured progress after every committed batch and on completion', async () => {
  const harness = seedHarness()
  const events = []
  let now = 0
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant,
    clock: () => { now += 100; return now }
  })

  const report = await service.seed(entities, { onProgress: (event) => events.push(event) })
  const batches = events.filter((event) => event.stage === 'seeding')
  assert.equal(batches.length, 2)
  assert.equal(batches[0].batch, 1)
  assert.equal(batches[0].upserted, 2)
  assert.equal(batches[0].total, 3)
  assert.equal(batches[0].totalBatches, 2)
  assert.equal(batches[0].mode, 'fresh')
  assert.equal(batches[0].pointsBefore, 0)
  assert.match(batches[0].indexFingerprint, /^sha256:/)
  assert.equal(batches[1].upserted, 3)
  assert.ok(batches[1].embeddingMs > 0)
  assert.ok(batches[1].qdrantUpsertMs > 0)

  const completed = events.at(-1)
  assert.equal(completed.stage, 'completed')
  assert.equal(completed.upserted, 3)
  assert.equal(completed.percent, 100)
  assert.equal(report.embedded, 3)
  assert.ok(report.embedding_ms > 0)
  assert.ok(report.qdrant_upsert_ms > 0)
})

test('SeedService marks idempotent progress complete even when no points are upserted in this run', async () => {
  const harness = seedHarness({ preflightMode: 'idempotent', before: 3 })
  const events = []
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant
  })
  await service.seed(entities, { onProgress: (event) => events.push(event) })
  assert.equal(events.at(-1).stage, 'completed')
  assert.equal(events.at(-1).percent, 100)
  assert.equal(events.at(-1).upserted, 0)
  assert.equal(events.at(-1).skippedExisting, 3)
})

test('SeedService emits failed progress with last committed counters when a later embedding batch fails', async () => {
  const harness = seedHarness()
  let calls = 0
  harness.embeddingProvider.embedDocuments = async (texts) => {
    calls += 1
    if (calls === 2) throw new Error('remote embedding disappeared')
    return texts.map((_, i) => [i, 1])
  }
  const events = []
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant
  })

  await assert.rejects(
    () => service.seed(entities, { onProgress: (event) => events.push(event) }),
    /remote embedding disappeared/
  )
  assert.equal(events.at(-1).stage, 'failed')
  assert.equal(events.at(-1).embedded, 2)
  assert.equal(events.at(-1).upserted, 2)
})

test('SeedService records preflight then failed progress when infrastructure is unavailable before the first batch', async () => {
  const harness = seedHarness()
  harness.embeddingProvider.health = async () => false
  const events = []
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant
  })

  await assert.rejects(
    () => service.seed(entities, { onProgress: (event) => events.push(event) }),
    /embedding service is not ready/
  )
  assert.deepEqual(events.map((event) => event.stage), ['preflight', 'failed'])
  assert.equal(events.at(-1).batch, 0)
  assert.equal(events.at(-1).upserted, 0)
})


test('SeedService accumulates embedding transport timings and throughput evidence', async () => {
  const harness = seedHarness()
  harness.embeddingProvider.embedDocumentsDetailed = async (texts) => ({
    vectors: texts.map((_, i) => [i, 1]),
    metrics: {
      transport: 'binary-f32',
      serverInferenceMs: 20,
      httpRoundTripMs: 50,
      transferOverheadMs: 30
    }
  })
  const events = []
  let now = 0
  const service = new SeedService({
    batchSize: 2,
    metadata: { embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1' },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant,
    clock: () => { now += 10; return now }
  })

  const report = await service.seed(entities, { onProgress: (event) => events.push(event) })
  assert.equal(report.embedding_transport, 'binary-f32')
  assert.equal(report.embedding_server_inference_ms, 40)
  assert.equal(report.embedding_http_round_trip_ms, 100)
  assert.equal(report.embedding_transfer_overhead_ms, 60)
  assert.ok(report.server_inference_docs_per_second > 0)
  assert.ok(report.embedding_http_docs_per_second > 0)
  assert.ok(report.qdrant_docs_per_second > 0)
  assert.ok(report.end_to_end_docs_per_second > 0)

  const lastBatch = events.filter((event) => event.stage === 'seeding').at(-1)
  assert.equal(lastBatch.embeddingTransport, 'binary-f32')
  assert.equal(lastBatch.embeddingServerInferenceMs, 40)
  assert.equal(lastBatch.embeddingHttpRoundTripMs, 100)
  assert.equal(lastBatch.embeddingTransferOverheadMs, 60)
  assert.ok(lastBatch.serverInferenceDocsPerSecond > 0)
  assert.ok(lastBatch.embeddingHttpDocsPerSecond > 0)
  assert.ok(lastBatch.qdrantDocsPerSecond > 0)
})

test('SeedService seeds v2.1 text when metadata explicitly requests it and reports the selected version', async () => {
  const country = normalizeEntity({
    id: 'Q17', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' },
    facts: { capital: 'Tokyo', currency: 'Japanese yen' }
  })
  const harness = seedHarness()
  const embeddedTexts = []
  harness.embeddingProvider.embedDocuments = async (texts) => {
    embeddedTexts.push(...texts)
    return texts.map(() => [0, 1])
  }
  const service = new SeedService({
    batchSize: 2,
    metadata: {
      embeddingModel: 'test', embeddingVersion: 'v1', datasetVersion: 'fixture-v1',
      embeddingTextVersion: 'v2.1'
    },
    embeddingProvider: harness.embeddingProvider,
    qdrant: harness.qdrant
  })

  const report = await service.seed([country])
  assert.equal(report.embedding_text_version, 'v2.1')
  assert.match(embeddedTexts[0], /Japan has Tokyo as its capital\./)
  assert.equal(harness.upserts[0][0].payload.embedding_text_version, 'v2.1')
})

test('v2.1 seed target safety rejects canonical v1 and requires the approved shadow collection', async () => {
  const module = await import('../../src/seed/seed-service.js')
  assert.equal(typeof module.assertEmbeddingTextCollectionSafety, 'function')
  assert.doesNotThrow(() => module.assertEmbeddingTextCollectionSafety({
    embeddingTextVersion: 'v1', collection: 'knowledge_entities_qwen3_4b_v1'
  }))
  assert.throws(() => module.assertEmbeddingTextCollectionSafety({
    embeddingTextVersion: 'v1', collection: 'knowledge_entities_qwen3_4b_text_v21'
  }), /v1.*must not target.*v2\.1/i)
  assert.doesNotThrow(() => module.assertEmbeddingTextCollectionSafety({
    embeddingTextVersion: 'v2.1', collection: 'knowledge_entities_qwen3_4b_text_v21'
  }))
  assert.throws(() => module.assertEmbeddingTextCollectionSafety({
    embeddingTextVersion: 'v2.1', collection: 'knowledge_entities_qwen3_4b_v1'
  }), /knowledge_entities_qwen3_4b_text_v21/)
  assert.throws(() => module.assertEmbeddingTextCollectionSafety({
    embeddingTextVersion: 'v2.1', collection: 'some_other_shadow'
  }), /knowledge_entities_qwen3_4b_text_v21/)
})
