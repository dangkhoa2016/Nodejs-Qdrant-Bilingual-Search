import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSeedProgressSnapshot, formatSeedProgressLine, progressEveryBatches } from '../../src/seed/progress.js'

test('buildSeedProgressSnapshot reports percent rate ETA and component timings', () => {
  const snapshot = buildSeedProgressSnapshot({
    stage: 'seeding',
    total: 20_000,
    totalBatches: 2_500,
    batch: 500,
    embedded: 4_000,
    upserted: 4_000,
    elapsedMs: 100_000,
    embeddingMs: 82_000,
    embeddingServerInferenceMs: 20_000,
    embeddingHttpRoundTripMs: 80_000,
    embeddingTransferOverheadMs: 60_000,
    embeddingTransport: 'binary-f32',
    qdrantUpsertMs: 15_000
  })

  assert.deepEqual(snapshot, {
    stage: 'seeding',
    total: 20_000,
    totalBatches: 2_500,
    batch: 500,
    embedded: 4_000,
    upserted: 4_000,
    skippedExisting: 0,
    percent: 20,
    elapsedMs: 100_000,
    rateEntitiesPerSecond: 40,
    etaMs: 400_000,
    embeddingMs: 82_000,
    embeddingServerInferenceMs: 20_000,
    embeddingHttpRoundTripMs: 80_000,
    embeddingTransferOverheadMs: 60_000,
    embeddingTransport: 'binary-f32',
    serverInferenceDocsPerSecond: 200,
    embeddingHttpDocsPerSecond: 50,
    qdrantDocsPerSecond: 266.667,
    qdrantUpsertMs: 15_000
  })
  assert.match(formatSeedProgressLine(snapshot), /20\.00%/)
  assert.match(formatSeedProgressLine(snapshot), /4000\/20000/)
  assert.match(formatSeedProgressLine(snapshot), /E2E=40\.00 docs\/s/)
  assert.match(formatSeedProgressLine(snapshot), /GPU=200\.00 docs\/s/)
  assert.match(formatSeedProgressLine(snapshot), /HTTP=50\.00 docs\/s/)
  assert.match(formatSeedProgressLine(snapshot), /Qdrant=266\.67 docs\/s/)
  assert.match(formatSeedProgressLine(snapshot), /transport=binary-f32/)
  assert.match(formatSeedProgressLine(snapshot), /ETA 6m 40s/)
})

test('progressEveryBatches defaults to about one hundred progress updates', () => {
  assert.equal(progressEveryBatches({ totalBatches: 2_500 }), 25)
  assert.equal(progressEveryBatches({ totalBatches: 10 }), 1)
  assert.equal(progressEveryBatches({ totalBatches: 2_500, configured: 50 }), 50)
})
