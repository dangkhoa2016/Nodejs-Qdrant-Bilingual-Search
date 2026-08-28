import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeEmbeddingRuntime,
  requireVerifiedSemanticEmbeddingRuntime,
  semanticIndexCompatibilityRuntime
} from '../../src/embeddings/runtime-provenance.js'

const extended = {
  backend: 'sentence-transformers',
  implementation: 'python-fastapi',
  semantic: true,
  accelerator: 'gpu',
  device: 'cuda',
  dtype: 'float16',
  runtime: 'pytorch-cuda',
  profile: 'qwen3',
  query_strategy: 'prompt',
  query_instruction_id: 'geo-retrieval-v1:abc',
  document_strategy: 'raw'
}

test('normalizeEmbeddingRuntime preserves optional model-runtime provenance', () => {
  assert.deepEqual(normalizeEmbeddingRuntime(extended), extended)
})

test('requireVerifiedSemanticEmbeddingRuntime preserves verified extended provenance', () => {
  assert.deepEqual(requireVerifiedSemanticEmbeddingRuntime(extended), extended)
})

const cpuRuntime = {
  backend: 'sentence-transformers',
  implementation: 'python-fastapi',
  semantic: true,
  accelerator: 'cpu',
  device: 'cpu',
  dtype: 'float32',
  runtime: 'pytorch-cpu',
  profile: 'qwen3',
  query_strategy: 'prompt',
  query_instruction_id: 'geo-retrieval-v1:abc',
  document_strategy: 'raw'
}

test('semanticIndexCompatibilityRuntime projects a CPU runtime to the canonical GPU-seeded semantic contract', () => {
  const projected = semanticIndexCompatibilityRuntime(cpuRuntime)
  assert.equal(projected.backend, 'sentence-transformers')
  assert.equal(projected.implementation, 'python-fastapi')
  assert.equal(projected.semantic, true)
})

test('semanticIndexCompatibilityRuntime retains semantic identity fields', () => {
  const projected = semanticIndexCompatibilityRuntime(cpuRuntime)
  assert.equal(projected.profile, 'qwen3')
  assert.equal(projected.query_strategy, 'prompt')
  assert.equal(projected.query_instruction_id, 'geo-retrieval-v1:abc')
  assert.equal(projected.document_strategy, 'raw')
})

test('semanticIndexCompatibilityRuntime excludes execution-hardware provenance fields', () => {
  const projected = semanticIndexCompatibilityRuntime(cpuRuntime)
  assert.equal('accelerator' in projected, false)
  assert.equal('device' in projected, false)
  assert.equal('dtype' in projected, false)
  assert.equal('runtime' in projected, false)
})

test('semanticIndexCompatibilityRuntime still requires a verified semantic runtime', () => {
  assert.throws(() => {
    semanticIndexCompatibilityRuntime({ ...cpuRuntime, semantic: false })
  }, /verified semantic embedding backend is required/i)
  assert.throws(() => {
    semanticIndexCompatibilityRuntime({ ...cpuRuntime, backend: 'mock', implementation: 'mock-server' })
  }, /verified semantic embedding backend is required/i)
})

test('semanticIndexCompatibilityRuntime rejects an unverified or non-semantic identity', () => {
  assert.throws(() => {
    semanticIndexCompatibilityRuntime({ backend: 'mock', implementation: 'python-fastapi', semantic: true })
  }, /verified semantic embedding backend is required/i)
  assert.throws(() => {
    semanticIndexCompatibilityRuntime(null)
  }, /verified semantic embedding backend is required/i)
})
