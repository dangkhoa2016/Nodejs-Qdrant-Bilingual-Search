import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../src/http/app.js'
import { EntityService } from '../../src/entities/entity-service.js'

const entityService = new EntityService({
  qdrant: {
    getByPointId: async () => ({ id: 'point', payload: { entity_id: 'Q869', type: 'country', name_en: 'Thailand', name_vi: 'Thái Lan', source: 'wikidata', source_id: 'Q869' } }),
    stats: async () => ({ status: 'green', points_count: 4, indexed_vectors_count: 4, segments_count: 1 })
  }
})

test('GET /api/v1/entities/:id returns stable entity contract', async () => {
  const response = await createApp({ entityService }).request('/api/v1/entities/Q869')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.entity.id, 'Q869')
  assert.deepEqual(body.entity.name, { en: 'Thailand', vi: 'Thái Lan' })
})

test('GET /api/v1/entities/:id rejects malformed IDs', async () => {
  const response = await createApp({ entityService }).request('/api/v1/entities/Thailand')
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
})

test('GET /api/v1/stats returns normalized collection statistics', async () => {
  const response = await createApp({ entityService }).request('/api/v1/stats')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.stats.pointsCount, 4)
  assert.equal(body.stats.status, 'green')
})
