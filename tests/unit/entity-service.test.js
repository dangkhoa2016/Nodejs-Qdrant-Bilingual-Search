import test from 'node:test'
import assert from 'node:assert/strict'
import { EntityService, EntityValidationError, mapPoint, validateEntityId } from '../../src/entities/entity-service.js'
import { entityPointId } from '../../src/seed/ids.js'

test('validateEntityId canonicalizes a lower-case Wikidata QID', () => {
  assert.equal(validateEntityId('q869'), 'Q869')
})

test('validateEntityId accepts safe namespaced public dataset identifiers', () => {
  assert.equal(validateEntityId('geonames:city:1581130'), 'geonames:city:1581130')
  assert.throws(() => validateEntityId('../Q869'), EntityValidationError)
  assert.throws(() => validateEntityId('naturalearth:../secret'), EntityValidationError)
  assert.throws(() => validateEntityId('Thailand'), EntityValidationError)
})

test('EntityService resolves the deterministic point ID used by the seed pipeline', async () => {
  let requestedId
  const qdrant = {
    async getByPointId(id) {
      requestedId = id
      return { id, payload: { entity_id: 'Q869', type: 'country', name_en: 'Thailand', name_vi: 'Thái Lan', source: 'wikidata', source_id: 'Q869' } }
    }
  }
  const service = new EntityService({ qdrant })
  const entity = await service.getById('Q869')
  assert.equal(requestedId, entityPointId('Q869'))
  assert.deepEqual(entity.name, { en: 'Thailand', vi: 'Thái Lan' })
})

test('EntityService resolves GeoNames-only canonical IDs without knowing the source provider', async () => {
  let requestedId
  const service = new EntityService({
    qdrant: {
      async getByPointId(id) {
        requestedId = id
        return { id, payload: { entity_id: 'geonames:city:1581130', type: 'city', name_en: 'Example City', source: 'geonames', source_id: '1581130' } }
      }
    }
  })
  const entity = await service.getById('geonames:city:1581130')
  assert.equal(requestedId, entityPointId('geonames:city:1581130'))
  assert.equal(entity.id, 'geonames:city:1581130')
})

test('EntityService returns null when Qdrant has no matching point', async () => {
  const service = new EntityService({ qdrant: { getByPointId: async () => null } })
  assert.equal(await service.getById('Q999999999'), null)
})

test('mapPoint exposes an application response instead of leaking the raw Qdrant payload', () => {
  const entity = mapPoint({ id: 'uuid', payload: { entity_id: 'Q869', country_code: 'TH', facts: { currency: 'Thai baht' }, language_provenance: { name_vi: 'wikidata' }, internal_debug: 'secret' } })
  assert.equal(entity.countryCode, 'TH')
  assert.equal(entity.internal_debug, undefined)
  assert.deepEqual(entity.facts, { currency: 'Thai baht' })
  assert.deepEqual(entity.languageProvenance, { name_vi: 'wikidata' })
})

test('EntityService normalizes collection statistics', async () => {
  const service = new EntityService({
    qdrant: {
      stats: async () => ({ status: 'green', points_count: 123, indexed_vectors_count: 100, segments_count: 2, config: { params: { vectors: { size: 384, distance: 'Cosine' } } } })
    }
  })
  assert.deepEqual(await service.stats(), {
    vectorConfig: { size: 384, distance: 'Cosine' }, status: 'green', optimizerStatus: null,
    pointsCount: 123, indexedVectorsCount: 100, segmentsCount: 2
  })
})
