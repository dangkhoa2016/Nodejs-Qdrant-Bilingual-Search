import test from 'node:test'
import assert from 'node:assert/strict'
import { SearchService } from '../../src/search/search-service.js'

const canonicalConfig = {
  searchDefaultLimit: 10,
  searchMaxLimit: 100,
  searchDefaultScoreThreshold: 0.55,
  searchConsistencyVerificationEnabled: true,
  searchConsistencyCandidateMultiplier: 5,
  searchDomainEntityIntentGateEnabled: true,
  embeddingModel: 'Qwen/Qwen3-Embedding-4B',
  embeddingDimension: 2560
}

function point(id, score, { type, name, continent = null } = {}) {
  return {
    id,
    score,
    payload: {
      entity_id: id,
      type,
      name_en: name,
      name_vi: name,
      continent,
      facts: {}
    }
  }
}

function makeService(points, config = canonicalConfig) {
  return new SearchService({
    config,
    embeddingProvider: { embedQuery: async () => [1, 2, 3] },
    qdrant: { querySemantic: async () => points },
    clock: (() => { let n = 0; return () => ++n })()
  })
}

test('production domain/entity-intent gate rejects a geographic Casablanca result for movie-content intent', async () => {
  const service = makeService([
    point('casablanca-city', 0.62208444, { type: 'city', name: 'Casablanca', continent: 'Africa' })
  ])

  const result = await service.search({
    query: 'What is the plot of the movie Casablanca?',
    language: 'en',
    limit: 5
  })

  assert.deepEqual(result.results, [])
  assert.deepEqual(result.meta.domain_entity_intent, {
    enabled: true,
    applied: true,
    intent: { domain: 'media-work', reason: 'media-content-intent' },
    rejected_count: 1,
    rejection_reason_counts: { 'geographic-entity-for-nongeographic-intent': 1 }
  })
})

test('production gate handles Vietnamese movie-content and football-club achievement collisions generically', async () => {
  const cases = [
    {
      query: 'Nội dung phim Casablanca nói về điều gì?',
      point: point('casablanca-city', 0.62208444, { type: 'city', name: 'Casablanca', continent: 'Africa' }),
      expectedDomain: 'media-work'
    },
    {
      query: 'Chelsea Football Club đã giành những danh hiệu nào?',
      point: point('chelsea-city', 0.5653962, { type: 'city', name: 'Chelsea', continent: 'North America' }),
      expectedDomain: 'sports-club'
    }
  ]

  for (const item of cases) {
    const result = await makeService([item.point]).search({ query: item.query, language: 'vi', limit: 5 })
    assert.deepEqual(result.results, [], item.query)
    assert.equal(result.meta.domain_entity_intent.applied, true, item.query)
    assert.equal(result.meta.domain_entity_intent.intent.domain, item.expectedDomain, item.query)
    assert.equal(result.meta.domain_entity_intent.rejected_count, 1, item.query)
  }
})

test('production gate preserves ordinary geographic questions and does not mistake Manchester City Football Club for geography intent', async () => {
  const geographic = await makeService([
    point('casablanca-city', 0.80, { type: 'city', name: 'Casablanca', continent: 'Africa' })
  ]).search({ query: 'Where is Casablanca located?', language: 'en', limit: 5 })

  assert.deepEqual(geographic.results.map((row) => row.id), ['casablanca-city'])
  assert.equal(geographic.meta.domain_entity_intent.applied, false)
  assert.equal(geographic.meta.domain_entity_intent.rejected_count, 0)

  const club = await makeService([
    point('manchester-city', 0.60, { type: 'city', name: 'Manchester', continent: 'Europe' })
  ]).search({ query: 'What trophies has Manchester City Football Club won?', language: 'en', limit: 5 })

  assert.deepEqual(club.results, [])
  assert.equal(club.meta.domain_entity_intent.applied, true)
  assert.equal(club.meta.domain_entity_intent.intent.domain, 'sports-club')
})

test('production domain/entity-intent gate can be disabled explicitly for operational rollback', async () => {
  const service = makeService([
    point('casablanca-city', 0.62208444, { type: 'city', name: 'Casablanca', continent: 'Africa' })
  ], { ...canonicalConfig, searchDomainEntityIntentGateEnabled: false })

  const result = await service.search({ query: 'What is the plot of the movie Casablanca?', language: 'en', limit: 5 })

  assert.deepEqual(result.results.map((row) => row.id), ['casablanca-city'])
  assert.deepEqual(result.meta.domain_entity_intent, {
    enabled: false,
    applied: false,
    intent: null,
    rejected_count: 0,
    rejection_reason_counts: {}
  })
})
