import test from 'node:test'
import assert from 'node:assert/strict'

const loadModule = async () => import('../../src/evaluation/full20k-v21-threshold-calibration.js').catch(() => ({}))

const HARD_V2_SHA256 = '3f0ebee543de7fe93ef3add07fef390e88ab56f03f4b1b57ef71f8588e44bacc'

function makeRows({ answerableScore = 0.571, noAnswerScore = 0.495 } = {}) {
  const answerable = Array.from({ length: 80 }, (_, index) => ({
    id: `answerable-${index + 1}`,
    language: index % 2 ? 'vi' : 'en',
    query: `answerable query ${index + 1}`,
    answerable: true,
    expectedIds: [`E${index + 1}`],
    expectedRank: index < 77 ? 1 : 2,
    topResults: index < 77
      ? [{ id: `E${index + 1}`, score: answerableScore }, { id: `D${index + 1}`, score: answerableScore - 0.01 }]
      : [{ id: `D${index + 1}`, score: answerableScore }, { id: `E${index + 1}`, score: answerableScore - 0.001 }]
  }))
  const noAnswer = Array.from({ length: 20 }, (_, index) => ({
    id: `no-answer-${index + 1}`,
    language: index % 2 ? 'vi' : 'en',
    query: `no-answer query ${index + 1}`,
    answerable: false,
    expectedIds: [],
    expectedRank: null,
    topResults: [{ id: `N${index + 1}`, score: noAnswerScore }]
  }))
  return [...answerable, ...noAnswer]
}

function makeReport(rows = makeRows()) {
  return {
    generatedAt: '2026-08-26T05:10:00.000Z',
    inputs: {
      queryCorpusSha256: HARD_V2_SHA256,
      v21Collection: 'knowledge_entities_qwen3_4b_text_v21'
    },
    experiment: 'embedding_text_v1_vs_v2_1_full20k_collection_ab',
    cases: 100,
    answerableCases: 80,
    noAnswerCases: 20,
    controlledVariables: { scoreThreshold: 0 },
    preflight: {
      expectedPoints: 20000,
      collectionState: {
        v21: {
          collection: 'knowledge_entities_qwen3_4b_text_v21',
          status: 'green',
          pointsCount: 20000,
          dimension: 2560,
          distance: 'Cosine'
        }
      },
      fingerprint: {
        expected: { v21: { value: 'sha256:v21', embeddingTextVersion: 'v2.1', entityCount: 20000 } },
        audit: { v21: { pointsCount: 20000, matchingCount: 20000 } }
      },
      provenance: {
        v21: {
          pointsCount: 20000,
          matchingCount: 20000,
          embeddingModel: 'Qwen/Qwen3-Embedding-4B',
          embeddingTextVersion: 'v2.1'
        }
      }
    },
    acceptance: { accepted: true },
    variants: { v21: { rows } }
  }
}

test('full-20k v2.1 threshold calibration uses the required four thresholds and favors the widest guard band when primary metrics tie', async () => {
  const { calibrateFull20kV21Threshold } = await loadModule()
  assert.equal(typeof calibrateFull20kV21Threshold, 'function')

  const result = calibrateFull20kV21Threshold(makeReport())

  assert.deepEqual(result.thresholds, [0.5, 0.51, 0.53, 0.55])
  assert.equal(result.cases, 100)
  assert.equal(result.answerableCases, 80)
  assert.equal(result.noAnswerCases, 20)
  assert.equal(result.candidates.every((item) => item.answerability.tp === 80 && item.answerability.fp === 0 && item.answerability.fn === 0 && item.answerability.tn === 20), true)
  assert.equal(result.candidates.every((item) => item.answerability.precision === 1 && item.answerability.recall === 1 && item.answerability.f1 === 1), true)
  assert.equal(result.existingFrameworkRecommendedThreshold, 0.5)
  assert.equal(result.recommendation.threshold, 0.53)
  assert.equal(result.recommendation.status, 'candidate-only')
  assert.equal(result.recommendation.currentProductionThreshold, 0.55)
  assert.equal(result.scoreDistribution.separation.overlap, false)
  assert.ok(result.scoreDistribution.separation.gap > 0)
  assert.ok(result.candidates.find((item) => item.threshold === 0.53).guardBand > result.candidates.find((item) => item.threshold === 0.55).guardBand)
})

test('full-20k v2.1 threshold calibration reports concrete false-positive and false-negative cases', async () => {
  const { calibrateFull20kV21Threshold } = await loadModule()
  assert.equal(typeof calibrateFull20kV21Threshold, 'function')

  const rows = makeRows()
  rows[0].topResults[0].score = 0.54
  rows[0].topResults[1].score = 0.53
  rows[80].topResults[0].score = 0.52
  const result = calibrateFull20kV21Threshold(makeReport(rows))

  const at050 = result.candidates.find((item) => item.threshold === 0.5)
  const at055 = result.candidates.find((item) => item.threshold === 0.55)
  assert.deepEqual(at050.falsePositives.map((item) => item.id), ['no-answer-1'])
  assert.deepEqual(at050.falseNegatives, [])
  assert.deepEqual(at055.falsePositives, [])
  assert.deepEqual(at055.falseNegatives.map((item) => item.id), ['answerable-1'])
  assert.equal(result.semanticTop1Errors.length, 3)
})

test('full-20k v2.1 threshold calibration fails closed on stale corpus or unverified shadow provenance', async () => {
  const { calibrateFull20kV21Threshold } = await loadModule()
  assert.equal(typeof calibrateFull20kV21Threshold, 'function')

  const staleCorpus = makeReport()
  staleCorpus.inputs.queryCorpusSha256 = 'deadbeef'
  assert.throws(() => calibrateFull20kV21Threshold(staleCorpus), /Hard-v2 corpus SHA-256 mismatch/)

  const mixedText = makeReport()
  mixedText.preflight.provenance.v21.embeddingTextVersion = 'v1'
  assert.throws(() => calibrateFull20kV21Threshold(mixedText), /embedding text version.*v2\.1/i)

  const rejectedQuality = makeReport()
  rejectedQuality.acceptance.accepted = false
  assert.throws(() => calibrateFull20kV21Threshold(rejectedQuality), /full-20k v2\.1 quality acceptance must already be true/i)

  const censoredScores = makeReport()
  censoredScores.controlledVariables.scoreThreshold = 0.55
  assert.throws(() => calibrateFull20kV21Threshold(censoredScores), /source score threshold must be 0/i)

  const wrongFingerprint = makeReport()
  wrongFingerprint.preflight.fingerprint.audit.v21.matchingCount = 19999
  assert.throws(() => calibrateFull20kV21Threshold(wrongFingerprint), /fingerprint must match all 20000 points/i)
})
