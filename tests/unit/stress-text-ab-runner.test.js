import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'

const loadRunner = async () => import('../../src/evaluation/stress-text-ab-runner.js').catch(() => ({}))

function entity(input) {
  return normalizeEntity({ source: 'geonames', ...input })
}

function quality(recallAt1) {
  return { cases: 1, mrr: recallAt1, recallAt1, recallAt3: 1, recallAt5: 1 }
}

test('stress v2.1 runner embeds each query once and compares identical 500-1000 candidate IDs', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.runStressTextV21AbExperiment, 'function')

  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' }, facts: { capital: 'Tokyo', currency: 'yen' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'Tokyo', vi: 'Tokyo' }, facts: { country: 'Japan', capital: true } })
  ]
  const cases = [{
    id: 'focus', language: 'vi', category: 'country-factual', challenge: 'hard-negative',
    query: 'quốc gia, không phải Tokyo', expected_ids: ['geonames:country:1']
  }]
  const hardReport = { rows: [{ id: 'focus', topResults: [{ id: 'geonames:city:2' }, { id: 'geonames:country:1' }] }] }
  const queryCalls = []
  const documentCalls = []
  const provider = {
    async embedQuery(text) { queryCalls.push(text); return [1, 0] },
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

  const result = await module.runStressTextV21AbExperiment({
    cases, hardReport, entities, embeddingProvider: provider, focusCaseIds: ['focus'], targetSize: 2, maxSize: 2, batchSize: 2
  })

  assert.equal(result.experiment, 'embedding_text_v1_vs_v2_1_stress_ab')
  assert.deepEqual(queryCalls, ['quốc gia, không phải Tokyo'])
  assert.equal(documentCalls.length, 2)
  assert.deepEqual(result.candidateTexts.v1.map((item) => item.id), result.candidateTexts.v21.map((item) => item.id))
  assert.deepEqual(result.candidateManifest.candidateIds, ['geonames:country:1', 'geonames:city:2'])
  assert.equal(result.variants.v1.rows[0].expectedRank, 2)
  assert.equal(result.variants.v21.rows[0].expectedRank, 1)
})

test('stress acceptance requires material all-query and non-no-diacritics gains with no relation regressions', async () => {
  const module = await loadRunner()
  assert.equal(typeof module.assessV21StressAcceptance, 'function')

  const v1 = {
    quality: { mrr: 0.9, recallAt1: 0.9, recallAt3: 1, recallAt5: 1 },
    qualityByCategory: { 'city-capital': quality(0.9), 'country-factual': quality(0.9) },
    qualityByChallenge: { 'hard-negative': quality(0.8), compressed: quality(0.8), 'implicit-relation': quality(1) },
    rows: [
      { id: 'q1', challenge: 'paraphrase', expectedRank: 1, resultIds: ['a'], expectedIds: ['a'] },
      { id: 'q2', challenge: 'no-diacritics', expectedRank: 2, resultIds: ['x', 'b'], expectedIds: ['b'] }
    ]
  }
  const v21 = {
    quality: { mrr: 0.96, recallAt1: 0.95, recallAt3: 1, recallAt5: 1 },
    qualityByCategory: { 'city-capital': quality(0.9), 'country-factual': quality(0.95) },
    qualityByChallenge: { 'hard-negative': quality(14 / 15), compressed: quality(0.8), 'implicit-relation': quality(1) },
    rows: [
      { id: 'q1', challenge: 'paraphrase', expectedRank: 1, resultIds: ['a'], expectedIds: ['a'] },
      { id: 'q2', challenge: 'no-diacritics', expectedRank: 1, resultIds: ['b'], expectedIds: ['b'] }
    ]
  }
  const accepted = module.assessV21StressAcceptance(v1, v21, {
    minOverallRecallAt1Delta: 0.025,
    minNonNoDiacriticsRecallAt1Delta: 0,
    hardNegativeRecallAt1: 14 / 15,
    maxNewRank1Regressions: 0
  })
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.checks.overallRecallAt1MaterialGain, true)
  assert.equal(accepted.checks.nonNoDiacriticsRecallAt1MaterialGain, true)
  assert.equal(accepted.checks.cityCapitalNoRegression, true)
  assert.equal(accepted.checks.compressedNoRegression, true)
  assert.equal(accepted.checks.implicitRelationNoRegression, true)
  assert.deepEqual(accepted.rank1Regressions, [])

  const regressed = structuredClone(v21)
  regressed.qualityByCategory['city-capital'].recallAt1 = 0.8
  regressed.qualityByChallenge.compressed.recallAt1 = 0.7
  regressed.rows[0].expectedRank = 2
  regressed.rows[0].resultIds = ['x', 'a']
  const rejected = module.assessV21StressAcceptance(v1, regressed, {
    minOverallRecallAt1Delta: 0.025,
    minNonNoDiacriticsRecallAt1Delta: 0,
    hardNegativeRecallAt1: 14 / 15,
    maxNewRank1Regressions: 0
  })
  assert.equal(rejected.accepted, false)
  assert.equal(rejected.checks.cityCapitalNoRegression, false)
  assert.equal(rejected.checks.compressedNoRegression, false)
  assert.equal(rejected.checks.zeroNewRank1Regressions, false)
  assert.deepEqual(rejected.rank1Regressions, [{ id: 'q1', v1Rank: 1, v21Rank: 2 }])
})
