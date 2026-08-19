import test from 'node:test'
import assert from 'node:assert/strict'
import { calibrateThresholds } from '../../src/evaluation/threshold-calibration.js'

const rows = [
  {
    id: 'positive-strong', answerable: true, expectedIds: ['C1'],
    topResults: [{ id: 'C1', score: 0.62 }, { id: 'X1', score: 0.58 }]
  },
  {
    id: 'positive-low', answerable: true, expectedIds: ['C2'],
    topResults: [{ id: 'C2', score: 0.54 }, { id: 'X2', score: 0.50 }]
  },
  {
    id: 'negative', answerable: false, expectedIds: [],
    topResults: [{ id: 'X3', score: 0.52 }, { id: 'X4', score: 0.49 }]
  }
]

test('calibrateThresholds computes answerability and strict retrieval decision metrics', () => {
  const result = calibrateThresholds(rows, { thresholds: [0.50, 0.53, 0.55] })
  const at053 = result.candidates.find((item) => item.threshold === 0.53)

  assert.equal(at053.answerability.precision, 1)
  assert.equal(at053.answerability.recall, 1)
  assert.equal(at053.answerability.f1, 1)
  assert.equal(at053.answerableTop1Accuracy, 1)
  assert.equal(at053.noAnswerAccuracy, 1)
  assert.equal(at053.recallAt5, 1)
  assert.equal(at053.decisionAccuracy, 1)
  assert.equal(result.recommended.threshold, 0.53)
})

test('calibrateThresholds rejects reports without both answerable and no-answer rows', () => {
  assert.throws(() => calibrateThresholds(rows.filter((row) => row.answerable), { thresholds: [0.5] }), /no-answer row/)
  assert.throws(() => calibrateThresholds(rows.filter((row) => !row.answerable), { thresholds: [0.5] }), /answerable row/)
})

test('calibrateThresholds uses a deterministic default sweep from 0.30 through 0.70', () => {
  const result = calibrateThresholds(rows)
  assert.equal(result.candidates[0].threshold, 0.3)
  assert.equal(result.candidates.at(-1).threshold, 0.7)
  assert.equal(result.candidates.length, 41)
})
