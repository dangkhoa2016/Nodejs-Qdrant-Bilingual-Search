import test from 'node:test'
import assert from 'node:assert/strict'
import { SearchService, SearchValidationError } from '../../src/search/search-service.js'

const config = {
  searchDefaultLimit: 10, searchMaxLimit: 100, searchDefaultScoreThreshold: 0.55,
  embeddingModel: 'intfloat/multilingual-e5-small', embeddingDimension: 384
}

test('SearchService combines cross-language embedding with validated Qdrant filter', async () => {
  let qdrantRequest
  const service = new SearchService({
    config,
    embeddingProvider: { embedQuery: async (text) => { assert.equal(text, 'quốc gia dùng baht'); return [1, 2] } },
    qdrant: { querySemantic: async (request) => { qdrantRequest = request; return [{ id: 'uuid', score: 0.91, payload: { entity_id: 'Q869', type: 'country', name_en: 'Thailand', name_vi: 'Thái Lan' } }] } },
    clock: (() => { let n = 0; return () => ++n })()
  })
  const result = await service.search({ query: ' quốc gia dùng baht ', language: 'vi', filter: { type: 'country' }, limit: 5 })
  assert.equal(result.results[0].id, 'Q869')
  assert.equal(result.results[0].name.vi, 'Thái Lan')
  assert.deepEqual(qdrantRequest.filter, { must: [{ key: 'type', match: { value: 'country' } }] })
  assert.equal(qdrantRequest.limit, 5)
})

test('SearchService rejects invalid input before calling dependencies', async () => {
  const service = new SearchService({ config, embeddingProvider: {}, qdrant: {} })
  await assert.rejects(() => service.search({ query: '', limit: 0 }), SearchValidationError)
  await assert.rejects(() => service.search({ query: 'x', filter: { raw_qdrant: true } }), /unsupported filter/)
})
