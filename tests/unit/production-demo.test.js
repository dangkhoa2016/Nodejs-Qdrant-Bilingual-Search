import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCanonicalInfo,
  assertExpectedTopEntity,
  assertNoGeographicFalsePositive,
  DEMO_QUERIES
} from '../../src/demo/production-demo.js'

test('canonical info assertion accepts the production v2.1 profile', () => {
  assert.doesNotThrow(() => assertCanonicalInfo({
    info: {
      qdrant_collection: 'knowledge_entities_qwen3_4b_text_v21',
      embedding_model: 'Qwen/Qwen3-Embedding-4B',
      embedding_dimension: 2560,
      embedding_transport: 'binary-f32',
      embedding_text_version: 'v2.1',
      search_default_score_threshold: 0.55,
      search_consistency_verification_enabled: true,
      search_consistency_candidate_multiplier: 5,
      search_domain_entity_intent_gate_enabled: true
    }
  }))
})

test('positive demo assertion requires the expected top entity', () => {
  assert.doesNotThrow(() => assertExpectedTopEntity({ results: [{ id: 'Q869', name: { en: 'Thailand' } }] }, 'Thailand'))
  assert.throws(() => assertExpectedTopEntity({ results: [{ name: { en: 'Japan' } }] }, 'Thailand'), /Thailand/)
})

test('negative demo assertion rejects geographic Casablanca false positive', () => {
  assert.doesNotThrow(() => assertNoGeographicFalsePositive({ results: [] }, 'Casablanca'))
  assert.throws(() => assertNoGeographicFalsePositive({ results: [{ type: 'city', name: { en: 'Casablanca' } }] }, 'Casablanca'), /geographic false positive/i)
})

test('demo stays intentionally small and bilingual', () => {
  assert.equal(DEMO_QUERIES.length, 5)
  assert.equal(DEMO_QUERIES.filter((q) => q.language === 'en').length >= 2, true)
  assert.equal(DEMO_QUERIES.filter((q) => q.language === 'vi').length >= 2, true)
  assert.equal(DEMO_QUERIES.filter((q) => q.negative).length, 1)
})
