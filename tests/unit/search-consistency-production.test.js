import test from 'node:test'
import assert from 'node:assert/strict'
import { SearchService } from '../../src/search/search-service.js'

const canonicalConfig = {
  searchDefaultLimit: 10,
  searchMaxLimit: 100,
  searchDefaultScoreThreshold: 0.55,
  searchConsistencyVerificationEnabled: true,
  searchConsistencyCandidateMultiplier: 5,
  embeddingModel: 'Qwen/Qwen3-Embedding-4B',
  embeddingDimension: 2560
}

function point(id, score, { type, name, continent = null, capital = null } = {}) {
  return {
    id,
    score,
    payload: {
      entity_id: id,
      type,
      name_en: name,
      name_vi: name,
      continent,
      facts: capital ? { capital } : {}
    }
  }
}

function makeService({ points, config = canonicalConfig }) {
  let qdrantRequest
  const service = new SearchService({
    config,
    embeddingProvider: { embedQuery: async () => [1, 2, 3] },
    qdrant: {
      querySemantic: async (request) => {
        qdrantRequest = request
        return points
      }
    },
    clock: (() => { let n = 0; return () => ++n })()
  })
  return { service, getQdrantRequest: () => qdrantRequest }
}

test('production consistency verification rejects contradictory geography while preserving threshold', async () => {
  const { service, getQdrantRequest } = makeService({
    points: [
      point('japan', 0.735, { type: 'country', name: 'Japan', continent: 'Asia', capital: 'Tokyo' }),
      point('france', 0.690, { type: 'country', name: 'France', continent: 'Europe', capital: 'Paris' })
    ]
  })

  const result = await service.search({
    query: 'Which European country has Tokyo as its capital and uses the yen?',
    language: 'en',
    limit: 5
  })

  assert.deepEqual(result.results, [])
  assert.equal(getQdrantRequest().limit, 25)
  assert.equal(getQdrantRequest().scoreThreshold, 0.55)
  assert.deepEqual(result.meta.consistency_verification, {
    enabled: true,
    applied: true,
    candidate_limit: 25,
    candidate_count: 2,
    rejected_count: 2,
    constraints: { entity_type: 'country', continent: 'Europe', capital: 'Tokyo' },
    rejection_reason_counts: { 'continent-mismatch': 1, 'capital-mismatch': 1 }
  })
})

test('production consistency verification promotes the valid country after rejecting a city distractor', async () => {
  const { service } = makeService({
    points: [
      point('tokyo', 0.760, { type: 'city', name: 'Tokyo', continent: 'Asia' }),
      point('japan', 0.730, { type: 'country', name: 'Japan', continent: 'Asia', capital: 'Tokyo' })
    ]
  })

  const result = await service.search({
    query: 'Which country has Tokyo as its capital and uses the yen?',
    language: 'en',
    limit: 5
  })

  assert.deepEqual(result.results.map((row) => row.id), ['japan'])
  assert.equal(result.meta.consistency_verification.rejected_count, 1)
  assert.deepEqual(result.meta.consistency_verification.rejection_reason_counts, {
    'entity-type-mismatch': 1,
    'capital-mismatch': 1
  })
})

test('queries without high-confidence structured constraints keep the existing search path unchanged', async () => {
  const { service, getQdrantRequest } = makeService({
    points: [point('casablanca', 0.622, { type: 'city', name: 'Casablanca', continent: 'Africa' })]
  })

  const result = await service.search({
    query: 'What is the plot of the movie Casablanca?',
    language: 'en',
    limit: 5
  })

  assert.deepEqual(result.results.map((row) => row.id), ['casablanca'])
  assert.equal(getQdrantRequest().limit, 5)
  assert.deepEqual(result.meta.consistency_verification, {
    enabled: true,
    applied: false,
    candidate_limit: 5,
    candidate_count: 1,
    rejected_count: 0,
    constraints: {},
    rejection_reason_counts: {}
  })
})

test('consistency verification can be disabled explicitly as an operational rollback', async () => {
  const { service, getQdrantRequest } = makeService({
    config: { ...canonicalConfig, searchConsistencyVerificationEnabled: false },
    points: [point('japan', 0.735, { type: 'country', name: 'Japan', continent: 'Asia', capital: 'Tokyo' })]
  })

  const result = await service.search({
    query: 'Which European country has Tokyo as its capital and uses the yen?',
    limit: 5
  })

  assert.deepEqual(result.results.map((row) => row.id), ['japan'])
  assert.equal(getQdrantRequest().limit, 5)
  assert.deepEqual(result.meta.consistency_verification, {
    enabled: false,
    applied: false,
    candidate_limit: 5,
    candidate_count: 1,
    rejected_count: 0,
    constraints: {},
    rejection_reason_counts: {}
  })
})
