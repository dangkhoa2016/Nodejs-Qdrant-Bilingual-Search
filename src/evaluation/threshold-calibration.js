function safeDivide(numerator, denominator) {
  return denominator ? numerator / denominator : 0
}

function roundThreshold(value) {
  return Math.round(value * 1e6) / 1e6
}

function defaultThresholds() {
  return Array.from({ length: 41 }, (_, index) => roundThreshold(0.30 + index * 0.01))
}

function validateThresholds(thresholds) {
  if (!Array.isArray(thresholds) || !thresholds.length) throw new TypeError('thresholds must not be empty')
  if (thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('thresholds must be finite numbers between 0 and 1')
  }
  return [...new Set(thresholds.map(roundThreshold))].sort((a, b) => a - b)
}

function survivingResults(row, threshold) {
  return (row.topResults ?? []).filter((result) => Number.isFinite(result?.score) && result.score >= threshold)
}

function evaluateThreshold(rows, threshold) {
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  let semanticTop1Correct = 0
  let recallAt5Hits = 0

  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)

  for (const row of rows) {
    const answerable = row.answerable !== false
    const surviving = survivingResults(row, threshold)
    const predictedAnswered = surviving.length > 0

    if (answerable && predictedAnswered) tp += 1
    else if (!answerable && predictedAnswered) fp += 1
    else if (answerable) fn += 1
    else tn += 1

    if (answerable) {
      const expected = new Set(row.expectedIds ?? [])
      if (surviving[0] && expected.has(surviving[0].id)) semanticTop1Correct += 1
      if (surviving.slice(0, 5).some((result) => expected.has(result.id))) recallAt5Hits += 1
    }
  }

  const precision = safeDivide(tp, tp + fp)
  const recall = safeDivide(tp, tp + fn)
  const f1 = safeDivide(2 * precision * recall, precision + recall)
  const answerableTop1Accuracy = safeDivide(semanticTop1Correct, answerableRows.length)
  const noAnswerAccuracy = safeDivide(tn, noAnswerRows.length)

  return {
    threshold,
    answerability: { tp, fp, fn, tn, precision, recall, f1 },
    answerableTop1Accuracy,
    recallAt5: safeDivide(recallAt5Hits, answerableRows.length),
    noAnswerAccuracy,
    decisionAccuracy: safeDivide(semanticTop1Correct + tn, rows.length)
  }
}

function compareCandidates(a, b) {
  return (
    b.decisionAccuracy - a.decisionAccuracy ||
    b.answerability.f1 - a.answerability.f1 ||
    b.answerableTop1Accuracy - a.answerableTop1Accuracy ||
    b.noAnswerAccuracy - a.noAnswerAccuracy ||
    a.threshold - b.threshold
  )
}

export function calibrateThresholds(rows, { thresholds = defaultThresholds() } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('benchmark rows must not be empty')
  if (!rows.some((row) => row.answerable !== false)) throw new TypeError('threshold calibration requires at least one answerable row')
  if (!rows.some((row) => row.answerable === false)) throw new TypeError('threshold calibration requires at least one no-answer row')

  const normalizedThresholds = validateThresholds(thresholds)
  const candidates = normalizedThresholds.map((threshold) => evaluateThreshold(rows, threshold))
  const recommended = [...candidates].sort(compareCandidates)[0]

  return {
    cases: rows.length,
    answerableCases: rows.filter((row) => row.answerable !== false).length,
    noAnswerCases: rows.filter((row) => row.answerable === false).length,
    selectionRule: 'maximize decisionAccuracy, then answerability F1, top1 accuracy, no-answer accuracy, then prefer lower threshold',
    recommended,
    candidates
  }
}
