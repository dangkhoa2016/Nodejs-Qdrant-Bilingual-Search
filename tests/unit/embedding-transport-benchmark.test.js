import test from 'node:test'
import assert from 'node:assert/strict'
import { benchmarkEmbeddingTransports } from '../../src/benchmarks/embedding-transport-benchmark.js'

test('embedding transport benchmark compares identical documents without touching Qdrant', async () => {
  const calls = []
  let now = 0
  const report = await benchmarkEmbeddingTransports({
    documents: ['a', 'b', 'c', 'd', 'e'],
    batchSize: 2,
    transports: ['json', 'binary-f32'],
    clock: () => { now += 100; return now },
    providerFactory: (transport) => ({
      assertCompatible: async () => ({ model: 'test', dimension: 2 }),
      embedDocumentsDetailed: async (texts) => {
        calls.push({ transport, texts: [...texts] })
        return {
          vectors: texts.map(() => [1, 0]),
          metrics: {
            transport,
            serverInferenceMs: transport === 'json' ? 10 : 8,
            httpRoundTripMs: transport === 'json' ? 50 : 20,
            transferOverheadMs: transport === 'json' ? 40 : 12
          }
        }
      }
    })
  })

  assert.equal(report.documents, 5)
  assert.equal(report.batchSize, 2)
  assert.deepEqual(report.transports.map((entry) => entry.transport), ['json', 'binary-f32'])
  assert.equal(report.transports[0].requests, 3)
  assert.equal(report.transports[0].serverInferenceMs, 30)
  assert.equal(report.transports[0].httpRoundTripMs, 150)
  assert.equal(report.transports[0].transferOverheadMs, 120)
  assert.equal(report.transports[0].serverInferenceDocsPerSecond, 166.667)
  assert.equal(report.transports[0].httpDocsPerSecond, 33.333)
  assert.equal(report.transports[0].endToEndDocsPerSecond, 50)
  assert.equal(report.transports[1].serverInferenceMs, 24)
  assert.equal(report.transports[1].httpRoundTripMs, 60)
  assert.equal(report.transports[1].transferOverheadMs, 36)
  assert.equal(report.transports[1].endToEndDocsPerSecond, 50)
  assert.equal(calls.length, 6)
  assert.deepEqual(calls[0], { transport: 'json', texts: ['a', 'b'] })
  assert.deepEqual(calls[3], { transport: 'binary-f32', texts: ['a', 'b'] })
})

test('embedding transport benchmark fails closed on malformed detailed metrics', async () => {
  await assert.rejects(() => benchmarkEmbeddingTransports({
    documents: ['a'],
    batchSize: 1,
    transports: ['binary-f32'],
    providerFactory: () => ({
      assertCompatible: async () => ({ model: 'test', dimension: 2 }),
      embedDocumentsDetailed: async () => ({ vectors: [[1, 0]], metrics: { transport: 'binary-f32' } })
    })
  }), /timing metrics/)
})
