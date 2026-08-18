import test from 'node:test'
import assert from 'node:assert/strict'

const loadRunner = async () => import('../../src/evaluation/full20k-collection-ab-runner.js').catch(() => ({}))

function point(id, score, type = 'country') {
  return { id: `point:${id}`, score, payload: { entity_id: id, type, name_en: id, name_vi: id } }
}

test('full-20k collection runner embeds every Hard-v2 query once and reuses the identical vector for v1 and v2.1 Qdrant queries', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.runFull20kCollectionAbExperiment, 'function')

  const cases = [
    { id: 'focus', language: 'vi', category: 'country-factual', challenge: 'hard-negative', query: 'find country', expected_ids: ['country'] },
    { id: 'sentinel', language: 'en', category: 'city-capital', challenge: 'compressed', query: 'find capital', expected_ids: ['capital'] },
    { id: 'implicit', language: 'en', category: 'city-capital', challenge: 'implicit-relation', query: 'implicit capital', expected_ids: ['capital2'] },
    { id: 'noanswer', language: 'en', category: 'no-answer', challenge: 'out-of-domain', query: '2+2?', expected_ids: [], answerable: false }
  ]
  const vectors = new Map()
  const embedCalls = []
  const provider = {
    async embedQuery(text) {
      embedCalls.push(text)
      const vector = [embedCalls.length, 0]
      vectors.set(text, vector)
      return vector
    }
  }
  const v1Calls = []
  const v21Calls = []
  const service = (calls, version) => ({
    async querySemantic(request) {
      calls.push(request)
      const queryIndex = request.vector[0]
      if (queryIndex === 1) return version === 'v1' ? [point('city', 0.91, 'city'), point('country', 0.90)] : [point('country', 0.95), point('city', 0.90, 'city')]
      if (queryIndex === 2) return [point('capital', 0.93, 'city'), point('country2', 0.91)]
      if (queryIndex === 3) return [point('capital2', 0.94, 'city'), point('country3', 0.90)]
      return [point('noise', version === 'v1' ? 0.52 : 0.50)]
    }
  })

  const result = await module.runFull20kCollectionAbExperiment({
    cases,
    embeddingProvider: provider,
    qdrantV1: service(v1Calls, 'v1'),
    qdrantV21: service(v21Calls, 'v21'),
    resultLimit: 5,
    rankProbeLimit: 100,
    focusCaseIds: ['focus'],
    sentinelCaseIds: ['sentinel'],
    acceptanceCriteria: { minOverallRecallAt1Delta: 0.025, minNonNoDiacriticsRecallAt1Delta: 0, maxNewRank1Regressions: 0, maxTop5Misses: 0 }
  })

  assert.deepEqual(embedCalls, cases.map((item) => item.query))
  assert.equal(v1Calls.length, cases.length)
  assert.equal(v21Calls.length, cases.length)
  for (let index = 0; index < cases.length; index += 1) {
    assert.strictEqual(v1Calls[index].vector, v21Calls[index].vector)
    assert.equal(v1Calls[index].limit, 100)
    assert.equal(v1Calls[index].scoreThreshold, 0)
  }
  assert.equal(result.experiment, 'embedding_text_v1_vs_v2_1_full20k_collection_ab')
  assert.equal(result.cases, 4)
  assert.equal(result.answerableCases, 3)
  assert.equal(result.noAnswerCases, 1)
  assert.equal(result.variants.v1.rows[0].expectedRank, 2)
  assert.equal(result.variants.v21.rows[0].expectedRank, 1)
  assert.equal(result.comparison.noAnswerCases[0].v1.top1Score, 0.52)
  assert.equal(result.comparison.noAnswerCases[0].v21.top1Score, 0.50)
})

test('full-20k collection guard rejects an unhealthy or schema-incompatible collection before benchmarking', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.assertFull20kCollectionInfo, 'function')

  const good = {
    status: 'green', points_count: 20000,
    config: { params: { vectors: { size: 2560, distance: 'Cosine' } } }
  }
  assert.doesNotThrow(() => module.assertFull20kCollectionInfo(good, { collection: 'c', dimension: 2560, expectedPoints: 20000 }))
  assert.throws(() => module.assertFull20kCollectionInfo({ ...good, status: 'yellow' }, { collection: 'c', dimension: 2560, expectedPoints: 20000 }), /status.*green/i)
  assert.throws(() => module.assertFull20kCollectionInfo({ ...good, config: { params: { vectors: { size: 384, distance: 'Cosine' } } } }, { collection: 'c', dimension: 2560, expectedPoints: 20000 }), /vector size mismatch/i)
  const strict = structuredClone(good)
  strict.config.strict_mode_config = { enabled: true, max_query_limit: 50 }
  assert.throws(() => module.assertFull20kCollectionInfo(strict, { collection: 'c', dimension: 2560, expectedPoints: 20000, rankProbeLimit: 100 }), /rank probe limit.*50/i)
})
