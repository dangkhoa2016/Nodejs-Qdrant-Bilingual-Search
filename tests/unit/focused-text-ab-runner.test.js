import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'

const loadRunner = async () => import('../../src/evaluation/focused-text-ab-runner.js').catch(() => ({}))

function entity(input) {
  return normalizeEntity({ source: 'geonames', ...input })
}

test('focused A/B runner embeds each query once and reuses the exact candidate set for v1 and v2', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.runFocusedTextAbExperiment, 'function')

  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' }, facts: { capital: 'Tokyo', currency: 'yen' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'Tokyo', vi: 'Tokyo' }, facts: { country: 'Japan', capital: true } })
  ]
  const cases = [{
    id: 'focus', language: 'vi', category: 'country-factual', challenge: 'hard-negative',
    query: 'quốc gia, không phải Tokyo', expected_ids: ['geonames:country:1']
  }]
  const hardReport = { rows: [{ id: 'focus', topResults: [
    { id: 'geonames:city:2', score: 0.9 },
    { id: 'geonames:country:1', score: 0.8 }
  ] }] }

  const queryCalls = []
  const documentCalls = []
  const provider = {
    async embedQuery(text) {
      queryCalls.push(text)
      return [1, 0]
    },
    async embedDocuments(texts) {
      documentCalls.push([...texts])
      return texts.map((text) => {
        if (text.includes('Japan is a country.')) return [1, 0]
        if (text.includes('Tokyo is a city in Japan.')) return [0.7, 0.714142842]
        if (text.includes('Capital: Tokyo.')) return [0.8, 0.6]
        if (text.includes('Capital: true.')) return [0.9, 0.435889894]
        throw new Error(`unexpected document text: ${text}`)
      })
    }
  }

  const result = await module.runFocusedTextAbExperiment({
    cases,
    hardReport,
    entities,
    embeddingProvider: provider,
    focusCaseIds: ['focus'],
    targetSize: 2,
    maxSize: 2,
    batchSize: 2
  })

  assert.deepEqual(queryCalls, ['quốc gia, không phải Tokyo'])
  assert.equal(documentCalls.length, 2)
  assert.equal(documentCalls[0].length, 2)
  assert.equal(documentCalls[1].length, 2)
  assert.deepEqual(result.candidateManifest.candidateIds, ['geonames:country:1', 'geonames:city:2'])
  assert.equal(result.variants.v1.rows[0].expectedRank, 2)
  assert.equal(result.variants.v2.rows[0].expectedRank, 1)
  assert.equal(result.comparison.focusCases[0].delta.rankGain, 1)
  assert.deepEqual(result.noDiacriticsCaseIds, [])
  assert.deepEqual(result.candidateTexts.v1.map((item) => item.id), result.candidateTexts.v2.map((item) => item.id))
})

test('focused A/B runtime guard requires the canonical Qwen3 profile and query instruction', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.assertFocusedAbRuntime, 'function')
  const canonical = {
    model: 'Qwen/Qwen3-Embedding-4B', dimension: 2560,
    backend: 'sentence-transformers', implementation: 'python-fastapi', semantic: true,
    profile: 'qwen3', query_strategy: 'prompt', query_instruction_id: 'geo-retrieval-v1:d014d3ec6df87e49',
    document_strategy: 'raw', dtype: 'float16', device: 'cuda'
  }
  assert.deepEqual(module.assertFocusedAbRuntime(canonical), canonical)
  assert.throws(() => module.assertFocusedAbRuntime({ ...canonical, model: 'Qwen/Qwen3-Embedding-8B' }), /model mismatch/i)
  assert.throws(() => module.assertFocusedAbRuntime({ ...canonical, query_instruction_id: 'other' }), /query instruction/i)
  assert.throws(() => module.assertFocusedAbRuntime({ ...canonical, document_strategy: 'prompt' }), /document strategy/i)
  assert.throws(() => module.assertFocusedAbRuntime({ ...canonical, semantic: false }), /semantic embedding runtime/i)
})

test('focused v2.1 A/B runner reuses query vectors and compares the same candidates against v1', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.runFocusedTextV21AbExperiment, 'function')

  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' }, facts: { capital: 'Tokyo', currency: 'yen' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'Tokyo', vi: 'Tokyo' }, facts: { country: 'Japan', capital: true } })
  ]
  const cases = [{
    id: 'focus', language: 'vi', category: 'country-factual', challenge: 'hard-negative',
    query: 'quốc gia, không phải Tokyo', expected_ids: ['geonames:country:1']
  }]
  const hardReport = { rows: [{ id: 'focus', topResults: [
    { id: 'geonames:city:2', score: 0.9 },
    { id: 'geonames:country:1', score: 0.8 }
  ] }] }

  const queryCalls = []
  const documentCalls = []
  const provider = {
    async embedQuery(text) {
      queryCalls.push(text)
      return [1, 0]
    },
    async embedDocuments(texts) {
      documentCalls.push([...texts])
      return texts.map((text) => {
        if (text.includes('Japan has Tokyo as its capital.')) return [1, 0]
        if (text.includes('Tokyo is a city in Japan.')) return [0.7, 0.714142842]
        if (text.includes('Capital: Tokyo.')) return [0.8, 0.6]
        if (text.includes('Capital: true.')) return [0.9, 0.435889894]
        throw new Error(`unexpected document text: ${text}`)
      })
    }
  }

  const result = await module.runFocusedTextV21AbExperiment({
    cases,
    hardReport,
    entities,
    embeddingProvider: provider,
    focusCaseIds: ['focus'],
    targetSize: 2,
    maxSize: 2,
    batchSize: 2
  })

  assert.equal(result.experiment, 'embedding_text_v1_vs_v2_1_focused_ab')
  assert.deepEqual(queryCalls, ['quốc gia, không phải Tokyo'])
  assert.equal(documentCalls.length, 2)
  assert.equal(result.variants.v1.rows[0].expectedRank, 2)
  assert.equal(result.variants.v21.rows[0].expectedRank, 1)
  assert.equal(result.comparison.focusCases[0].delta.rankGain, 1)
  assert.ok(result.comparison.quality.v21)
  assert.equal(result.comparison.quality.v2, undefined)
  assert.ok(result.comparison.focusCases[0].v21)
  assert.equal(result.comparison.focusCases[0].v2, undefined)
  assert.deepEqual(result.candidateTexts.v1.map((item) => item.id), result.candidateTexts.v21.map((item) => item.id))
  assert.ok(result.candidateTexts.v21.every((item) => item.version === 'v2.1'))
})

test('v2.1 acceptance assessment enforces relation/type bars and zero new rank-1 regressions', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.assessV21Acceptance, 'function')

  const passing = module.assessV21Acceptance({
    qualityByCategory: { 'country-factual': { recallAt1: 0.95 }, 'city-capital': { recallAt1: 11 / 12 } },
    qualityByChallenge: { 'hard-negative': { recallAt1: 14 / 15 }, compressed: { recallAt1: 0.8 }, 'implicit-relation': { recallAt1: 1 } },
    rows: [{ id: 'q1', expectedRank: 1 }]
  }, {
    qualityByCategory: { 'country-factual': { recallAt1: 0.95 }, 'city-capital': { recallAt1: 11 / 12 } },
    qualityByChallenge: { 'hard-negative': { recallAt1: 14 / 15 }, compressed: { recallAt1: 0.8 }, 'implicit-relation': { recallAt1: 1 } },
    rows: [{ id: 'q1', expectedRank: 1 }]
  })
  assert.equal(passing.accepted, true)
  assert.deepEqual(passing.rank1Regressions, [])

  const failing = module.assessV21Acceptance({
    qualityByCategory: { 'country-factual': { recallAt1: 0.95 }, 'city-capital': { recallAt1: 0.9166667 } },
    qualityByChallenge: { 'hard-negative': { recallAt1: 0.9333334 }, compressed: { recallAt1: 0.8 }, 'implicit-relation': { recallAt1: 1 } },
    rows: [{ id: 'q1', expectedRank: 1 }]
  }, {
    qualityByCategory: { 'country-factual': { recallAt1: 0.95 }, 'city-capital': { recallAt1: 0.9 } },
    qualityByChallenge: { 'hard-negative': { recallAt1: 0.9333334 }, compressed: { recallAt1: 0.7 }, 'implicit-relation': { recallAt1: 0.9 } },
    rows: [{ id: 'q1', expectedRank: 2 }]
  })
  assert.equal(failing.accepted, false)
  assert.deepEqual(failing.rank1Regressions, [{ id: 'q1', v1Rank: 1, v21Rank: 2 }])
  assert.equal(failing.checks.cityCapitalRecallAt1, false)
  assert.equal(failing.checks.compressedRecallAt1, false)
  assert.equal(failing.checks.implicitRelationRecallAt1, false)
  assert.equal(failing.checks.zeroNewRank1Regressions, false)
})
