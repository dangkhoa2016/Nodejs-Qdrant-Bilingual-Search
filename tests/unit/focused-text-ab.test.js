import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'

const loadModule = async () => import('../../src/evaluation/focused-text-ab.js').catch(() => ({}))

function entity(input) {
  return normalizeEntity({ source: 'geonames', ...input })
}

test('focused text A/B candidate builder keeps every expected entity and observed focus-case distractor', async () => {
  const module = await loadModule()
  assert.equal(typeof module.buildFocusedCandidateSet, 'function')

  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan' }, continent: 'Asia', facts: { capital: 'Tokyo' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'Tokyo' }, continent: 'Asia', facts: { country: 'Japan', capital: true } }),
    entity({ id: 'geonames:city:3', type: 'city', name: { en: 'Osaka' }, continent: 'Asia', facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:4', type: 'city', name: { en: 'Kyoto' }, continent: 'Asia', facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:country:5', type: 'country', name: { en: 'France' }, continent: 'Europe', facts: { capital: 'Paris' } })
  ]
  const cases = [
    { id: 'focus', answerable: true, expected_ids: ['geonames:country:1'] },
    { id: 'other', answerable: true, expected_ids: ['geonames:country:5'] }
  ]
  const hardReport = {
    rows: [{ id: 'focus', topResults: [
      { id: 'geonames:city:2', score: 0.7 },
      { id: 'geonames:country:1', score: 0.69 },
      { id: 'geonames:city:3', score: 0.6 }
    ] }]
  }

  const result = module.buildFocusedCandidateSet({
    cases, hardReport, entities, focusCaseIds: ['focus'], targetSize: 4, maxSize: 5
  })
  assert.deepEqual(result.entities.map((item) => item.id), [
    'geonames:country:1',
    'geonames:country:5',
    'geonames:city:2',
    'geonames:city:3'
  ])
  assert.deepEqual(result.manifest.expectedIds, ['geonames:country:1', 'geonames:country:5'])
  assert.deepEqual(result.manifest.observedDistractorIds, ['geonames:city:2', 'geonames:city:3'])
  assert.equal(result.manifest.candidateCount, 4)
})

test('focused candidate builder deterministically fills with related country/city entities up to target size', async () => {
  const { buildFocusedCandidateSet } = await loadModule()
  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan' }, continent: 'Asia', facts: { capital: 'Tokyo' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'Tokyo' }, continent: 'Asia', facts: { country: 'Japan', capital: true } }),
    entity({ id: 'geonames:city:3', type: 'city', name: { en: 'Osaka' }, continent: 'Asia', facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:4', type: 'city', name: { en: 'Kyoto' }, continent: 'Asia', facts: { country: 'Japan', capital: false } }),
    entity({ id: 'geonames:city:5', type: 'city', name: { en: 'Seoul' }, continent: 'Asia', facts: { country: 'South Korea', capital: true } })
  ]
  const result = buildFocusedCandidateSet({
    cases: [{ id: 'focus', expected_ids: ['geonames:country:1'] }],
    hardReport: { rows: [{ id: 'focus', topResults: [{ id: 'geonames:city:2' }] }] },
    entities,
    focusCaseIds: ['focus'],
    targetSize: 4,
    maxSize: 4
  })
  assert.deepEqual(result.manifest.candidateIds, [
    'geonames:country:1',
    'geonames:city:2',
    'geonames:city:3',
    'geonames:city:4'
  ])
})

test('focused variant evaluator reports ranks and both score margins', async () => {
  const module = await loadModule()
  assert.equal(typeof module.evaluateFocusedVariant, 'function')

  const candidates = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'Japan' }, facts: { capital: 'Tokyo' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'Tokyo' }, facts: { country: 'Japan', capital: true } }),
    entity({ id: 'geonames:city:3', type: 'city', name: { en: 'Osaka' }, facts: { country: 'Japan' } })
  ]
  const cases = [{
    id: 'q1', language: 'vi', category: 'country-factual', challenge: 'hard-negative',
    query: 'quốc gia, không phải Tokyo', expected_ids: ['geonames:country:1']
  }]
  const queryVectors = new Map([['q1', [1, 0]]])
  const documentVectors = [[0.8, 0.6], [0.9, 0.435889894], [0, 1]]
  const report = module.evaluateFocusedVariant(cases, queryVectors, candidates, documentVectors)

  assert.deepEqual(report.quality, { mrr: 0.5, recallAt1: 0, recallAt3: 1, recallAt5: 1 })
  assert.deepEqual(report.qualityByLanguage.vi, report.quality)
  assert.deepEqual(report.qualityByChallenge['hard-negative'], report.quality)
  assert.deepEqual(report.qualityByCategory['country-factual'], report.quality)
  assert.equal(report.rows[0].expectedRank, 2)
  assert.deepEqual(report.rows[0].resultIds, ['geonames:city:2', 'geonames:country:1', 'geonames:city:3'])
  assert.ok(Math.abs(report.rows[0].top1Top2Margin - 0.1) < 1e-9)
  assert.ok(Math.abs(report.rows[0].targetVsBestDistractorMargin + 0.1) < 1e-9)
})

test('focused A/B comparison reports v1-v2 deltas and flags no-diacritics separately', async () => {
  const module = await loadModule()
  assert.equal(typeof module.compareFocusedVariants, 'function')
  const v1 = {
    quality: { mrr: 0.5, recallAt1: 0, recallAt3: 1, recallAt5: 1 },
    rows: [{ id: 'vi-hard-country-17', challenge: 'no-diacritics', expectedRank: 2, top1Top2Margin: 0.1, targetVsBestDistractorMargin: -0.1 }]
  }
  const v2 = {
    quality: { mrr: 1, recallAt1: 1, recallAt3: 1, recallAt5: 1 },
    rows: [{ id: 'vi-hard-country-17', challenge: 'no-diacritics', expectedRank: 1, top1Top2Margin: 0.2, targetVsBestDistractorMargin: 0.2 }]
  }
  const result = module.compareFocusedVariants(v1, v2, { focusCaseIds: ['vi-hard-country-17'] })
  assert.deepEqual(result.quality.delta, { mrr: 0.5, recallAt1: 1, recallAt3: 0, recallAt5: 0 })
  assert.deepEqual(result.focusCases[0], {
    id: 'vi-hard-country-17',
    challenge: 'no-diacritics',
    noDiacritics: true,
    v1: { expectedRank: 2, top1Top2Margin: 0.1, targetVsBestDistractorMargin: -0.1 },
    v2: { expectedRank: 1, top1Top2Margin: 0.2, targetVsBestDistractorMargin: 0.2 },
    delta: { rankGain: 1, top1Top2Margin: 0.1, targetVsBestDistractorMargin: 0.3 }
  })
})

test('focused evaluator keeps the full candidate rank and target margin when the expected entity misses top-k', async () => {
  const { evaluateFocusedVariant } = await loadModule()
  const candidates = [
    entity({ id: 'geonames:city:1', type: 'city', name: { en: 'A' }, facts: { country: 'X' } }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'B' }, facts: { country: 'X' } }),
    entity({ id: 'geonames:country:3', type: 'country', name: { en: 'Target' }, facts: { capital: 'A' } })
  ]
  const cases = [{ id: 'q', language: 'vi', category: 'country-factual', query: 'target', expected_ids: ['geonames:country:3'] }]
  const report = evaluateFocusedVariant(cases, new Map([['q', [1, 0]]]), candidates, [
    [1, 0],
    [0.9, 0.435889894],
    [0.8, 0.6]
  ], { limit: 2 })
  assert.deepEqual(report.rows[0].resultIds, ['geonames:city:1', 'geonames:city:2'])
  assert.equal(report.rows[0].expectedRank, 3)
  assert.ok(Math.abs(report.rows[0].targetVsBestDistractorMargin + 0.2) < 1e-9)
})


test('focused candidate builder fails closed instead of truncating required expected/distractor evidence', async () => {
  const { buildFocusedCandidateSet } = await loadModule()
  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'A' }, facts: {} }),
    entity({ id: 'geonames:country:2', type: 'country', name: { en: 'B' }, facts: {} }),
    entity({ id: 'geonames:city:3', type: 'city', name: { en: 'C' }, facts: { country: 'A' } })
  ]
  assert.throws(() => buildFocusedCandidateSet({
    cases: [
      { id: 'focus', expected_ids: ['geonames:country:1'] },
      { id: 'other', expected_ids: ['geonames:country:2'] }
    ],
    hardReport: { rows: [{ id: 'focus', topResults: [{ id: 'geonames:city:3' }] }] },
    entities,
    focusCaseIds: ['focus'],
    targetSize: 2,
    maxSize: 2
  }), /required focused candidates.*maxSize/i)
})

test('focused A/B comparison exposes language and challenge deltas for decision criteria', async () => {
  const { compareFocusedVariants } = await loadModule()
  const q0 = { mrr: 0.5, recallAt1: 0, recallAt3: 1, recallAt5: 1 }
  const q1 = { mrr: 1, recallAt1: 1, recallAt3: 1, recallAt5: 1 }
  const row = { id: 'focus', challenge: 'hard-negative', expectedRank: 2, top1Top2Margin: 0.1, targetVsBestDistractorMargin: -0.1 }
  const afterRow = { ...row, expectedRank: 1, top1Top2Margin: 0.2, targetVsBestDistractorMargin: 0.2 }
  const result = compareFocusedVariants({
    quality: q0,
    qualityByLanguage: { vi: q0 },
    qualityByCategory: { 'country-factual': q0 },
    qualityByChallenge: { 'hard-negative': q0 },
    rows: [row]
  }, {
    quality: q1,
    qualityByLanguage: { vi: q1 },
    qualityByCategory: { 'country-factual': q1 },
    qualityByChallenge: { 'hard-negative': q1 },
    rows: [afterRow]
  }, { focusCaseIds: ['focus'] })

  assert.deepEqual(result.qualityByLanguage.vi.delta, { mrr: 0.5, recallAt1: 1, recallAt3: 0, recallAt5: 0 })
  assert.deepEqual(result.qualityByChallenge['hard-negative'].delta, result.qualityByLanguage.vi.delta)
  assert.deepEqual(result.qualityByCategory['country-factual'].delta, result.qualityByLanguage.vi.delta)
})

test('focused candidate builder fails when the dataset cannot satisfy the requested target size', async () => {
  const { buildFocusedCandidateSet } = await loadModule()
  const entities = [
    entity({ id: 'geonames:country:1', type: 'country', name: { en: 'A' }, facts: {} }),
    entity({ id: 'geonames:city:2', type: 'city', name: { en: 'B' }, facts: { country: 'A' } })
  ]
  assert.throws(() => buildFocusedCandidateSet({
    cases: [{ id: 'focus', expected_ids: ['geonames:country:1'] }],
    hardReport: { rows: [{ id: 'focus', topResults: [{ id: 'geonames:city:2' }] }] },
    entities,
    focusCaseIds: ['focus'],
    targetSize: 3,
    maxSize: 3
  }), /could only build 2.*targetSize 3/i)
})
