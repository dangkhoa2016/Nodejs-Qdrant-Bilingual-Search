import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'
import { createIndexFingerprint } from '../../src/seed/index-fingerprint.js'

const metadata = { embeddingModel: 'model-a', embeddingVersion: 'v1', datasetVersion: 'public-v1' }
const one = normalizeEntity({ id: 'geonames:city:1', type: 'city', name: { en: 'One', vi: 'Một' }, population: 1 })
const two = normalizeEntity({ id: 'geonames:city:2', type: 'city', name: { en: 'Two', vi: 'Hai' }, population: 2 })

test('index fingerprint is deterministic and independent of entity input order', () => {
  const first = createIndexFingerprint([one, two], metadata)
  const second = createIndexFingerprint([two, one], metadata)
  assert.match(first.value, /^sha256:[0-9a-f]{64}$/)
  assert.equal(first.value, second.value)
  assert.equal(first.embeddingTextVersion, 'v1')
  assert.equal(first.entityCount, 2)
})

test('index fingerprint changes with dataset content or embedding identity', () => {
  const baseline = createIndexFingerprint([one, two], metadata).value
  const changedEntity = normalizeEntity({ id: 'geonames:city:2', type: 'city', name: { en: 'Two changed', vi: 'Hai' }, population: 2 })
  assert.notEqual(createIndexFingerprint([one, changedEntity], metadata).value, baseline)
  assert.notEqual(createIndexFingerprint([one, two], { ...metadata, embeddingModel: 'model-b' }).value, baseline)
  assert.notEqual(createIndexFingerprint([one, two], { ...metadata, embeddingVersion: 'v2' }).value, baseline)
})

test('index fingerprint v2 changes when embedding runtime provenance changes', () => {
  const semantic = {
    ...metadata,
    embeddingRuntime: { backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true }
  }
  const mock = {
    ...metadata,
    embeddingRuntime: { backend: 'mock-deterministic', implementation: 'node-mock', semantic: false }
  }
  const semanticFingerprint = createIndexFingerprint([one, two], semantic).value
  assert.notEqual(createIndexFingerprint([one, two], mock).value, semanticFingerprint)
})

test('index fingerprint changes when Qwen query/runtime profile provenance changes', () => {
  const baseRuntime = {
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
    accelerator: 'gpu', device: 'cuda', dtype: 'float16', runtime: 'pytorch-cuda',
    profile: 'qwen3', query_strategy: 'prompt', query_instruction_id: 'geo-retrieval-v1:aaa',
    document_strategy: 'raw'
  }
  const baseline = createIndexFingerprint([one, two], { ...metadata, embeddingRuntime: baseRuntime }).value
  assert.notEqual(
    createIndexFingerprint([one, two], {
      ...metadata,
      embeddingRuntime: { ...baseRuntime, query_instruction_id: 'geo-retrieval-v1:bbb' }
    }).value,
    baseline
  )
  assert.notEqual(
    createIndexFingerprint([one, two], {
      ...metadata,
      embeddingRuntime: { ...baseRuntime, dtype: 'float32', runtime: 'pytorch-cpu', accelerator: 'cpu', device: 'cpu' }
    }).value,
    baseline
  )
})

test('index fingerprint selects v2.1 document text explicitly and leaves the v1 fingerprint unchanged by default', () => {
  const baseline = createIndexFingerprint([one, two], metadata)
  const explicitV1 = createIndexFingerprint([one, two], { ...metadata, embeddingTextVersion: 'v1' })
  const v21 = createIndexFingerprint([one, two], { ...metadata, embeddingTextVersion: 'v2.1' })

  assert.equal(explicitV1.value, baseline.value)
  assert.equal(explicitV1.embeddingTextVersion, 'v1')
  assert.equal(v21.embeddingTextVersion, 'v2.1')
  assert.notEqual(v21.value, baseline.value)
})
