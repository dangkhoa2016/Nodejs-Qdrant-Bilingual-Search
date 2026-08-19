import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'
import { createQdrantPoint, prepareEntityForEmbedding, mapEntityToPayload } from '../../src/seed/point-mapper.js'

test('point mapper stores provenance/version metadata but not embedding text duplication', () => {
  const entity = normalizeEntity({ id: 'Q869', type: 'country', name: { en: 'Thailand', vi: 'Thái Lan' }, description: { en: 'country', vi: 'quốc gia' } })
  const prepared = prepareEntityForEmbedding(entity)
  const point = createQdrantPoint(prepared, [0.1, 0.2], {
    embeddingModel: 'test-model', embeddingVersion: 'v1', datasetVersion: '2026-08-14-v1'
  })
  assert.equal(point.payload.entity_id, 'Q869')
  assert.equal(point.payload.bilingual_state, 'native_bilingual')
  assert.equal(point.payload.embedding_text_version, 'v1')
  assert.equal(point.payload.dataset_version, '2026-08-14-v1')
  assert.deepEqual(point.payload.source_refs, [{ source: 'wikidata', sourceId: 'Q869' }])
  assert.equal('embedding_text' in point.payload, false)
})

test('payload retains semantic facts needed by entity and search responses', () => {
  const entity = normalizeEntity({ id: 'Q869', type: 'country', name: { en: 'Thailand' }, facts: { capital: 'Bangkok', currency: 'Thai baht', languages: ['Thai'] } })
  const payload = mapEntityToPayload(entity, { embeddingModel: 'm', embeddingVersion: 'v1', embeddingTextVersion: 'v1', datasetVersion: 'd' })
  assert.deepEqual(payload.facts, { capital: 'Bangkok', currency: 'Thai baht', languages: ['Thai'] })
})

test('point mapper persists verified embedding runtime provenance', () => {
  const entity = normalizeEntity({ id: 'geonames:country:1605651', type: 'country', name: { en: 'Thailand', vi: 'Thái Lan' } })
  const payload = mapEntityToPayload(entity, {
    embeddingModel: 'intfloat/multilingual-e5-small',
    embeddingVersion: 'v1', embeddingTextVersion: 'v1', datasetVersion: 'public-v1',
    embeddingRuntime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true }
  })
  assert.equal(payload.embedding_backend, 'sentence-transformers')
  assert.equal(payload.embedding_implementation, 'python-fastapi')
  assert.equal(payload.embedding_semantic, true)
})

test('point mapper persists extended embedding runtime provenance for model experiments', () => {
  const entity = normalizeEntity({ id: 'geonames:country:1605651', type: 'country', name: { en: 'Thailand', vi: 'Thái Lan' } })
  const payload = mapEntityToPayload(entity, {
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingVersion: 'qwen3-4b-v1', embeddingTextVersion: 'v1', datasetVersion: 'public-v1',
    embeddingRuntime: {
      backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
      accelerator: 'gpu', device: 'cuda', dtype: 'float16', runtime: 'pytorch-cuda',
      profile: 'qwen3', query_strategy: 'prompt', query_instruction_id: 'geo-retrieval-v1:abc',
      document_strategy: 'raw'
    }
  })
  assert.equal(payload.embedding_accelerator, 'gpu')
  assert.equal(payload.embedding_device, 'cuda')
  assert.equal(payload.embedding_dtype, 'float16')
  assert.equal(payload.embedding_runtime, 'pytorch-cuda')
  assert.equal(payload.embedding_profile, 'qwen3')
  assert.equal(payload.embedding_query_strategy, 'prompt')
  assert.equal(payload.embedding_query_instruction_id, 'geo-retrieval-v1:abc')
  assert.equal(payload.embedding_document_strategy, 'raw')
})

test('point preparation can explicitly select embedding_text v2.1 without changing the v1 default', () => {
  const entity = normalizeEntity({
    id: 'Q17', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' },
    facts: { capital: 'Tokyo', currency: 'Japanese yen' }
  })
  assert.equal(prepareEntityForEmbedding(entity).document.version, 'v1')
  const prepared = prepareEntityForEmbedding(entity, 'v2.1')
  assert.equal(prepared.document.version, 'v2.1')
  assert.match(prepared.document.text, /Japan has Tokyo as its capital\./)
})
