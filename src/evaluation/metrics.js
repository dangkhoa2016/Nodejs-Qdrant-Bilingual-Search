function assertPositiveK(k) {
  if (!Number.isInteger(k) || k < 1) throw new TypeError('k must be a positive integer')
}

export function reciprocalRank(resultIds, expectedIds) {
  const expected = new Set(expectedIds)
  const index = resultIds.findIndex((id) => expected.has(id))
  return index < 0 ? 0 : 1 / (index + 1)
}

export function hitAtK(resultIds, expectedIds, k) {
  assertPositiveK(k)
  const expected = new Set(expectedIds)
  return resultIds.slice(0, k).some((id) => expected.has(id)) ? 1 : 0
}

export function summarizeEvaluation(rows, ks = [1, 3, 5]) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError('evaluation rows must not be empty')
  const totals = Object.fromEntries(ks.map((k) => [`recallAt${k}`, 0]))
  let rr = 0
  for (const row of rows) {
    rr += reciprocalRank(row.resultIds, row.expectedIds)
    for (const k of ks) totals[`recallAt${k}`] += hitAtK(row.resultIds, row.expectedIds, k)
  }
  const quality = { mrr: rr / rows.length }
  for (const k of ks) quality[`recallAt${k}`] = totals[`recallAt${k}`] / rows.length
  return quality
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export function summarizeLatencies(values) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('latencies must be non-negative finite numbers')
  }
  if (!values.length) return { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 }
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    min: Math.min(...values), mean: sum / values.length,
    p50: percentile(values, 50), p90: percentile(values, 90), p95: percentile(values, 95), p99: percentile(values, 99),
    max: Math.max(...values)
  }
}

function summarizeBy(rows, key) {
  const summary = {}
  for (const value of [...new Set(rows.map((row) => row[key]).filter(Boolean))]) {
    summary[value] = summarizeEvaluation(rows.filter((row) => row[key] === value))
  }
  return summary
}

function firstExpectedRank(resultIds, expectedIds) {
  const expected = new Set(expectedIds)
  const index = resultIds.findIndex((id) => expected.has(id))
  return index < 0 ? null : index + 1
}

function finiteTiming(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function summarizeTimingComponent(rows, component) {
  return summarizeLatencies(rows.map((row) => row.timingMs[component]).filter((value) => value !== null))
}

function roundMetric(value) {
  return Math.round(value * 1e12) / 1e12
}

function scoreMargin(results) {
  const scores = results.slice(0, 2).map((result) => result?.score)
  if (scores.length < 2 || scores.some((score) => !Number.isFinite(score))) return null
  return roundMetric(Math.max(0, scores[0] - scores[1]))
}

function thresholdedResults(row, threshold) {
  return row.topResults.filter((result) => Number.isFinite(result.score) && result.score >= threshold)
}

function summarizeDecisionQuality(rows, threshold) {
  if (threshold === null || threshold === undefined) return null
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new TypeError('decisionThreshold must be between 0 and 1')

  const answerable = rows.filter((row) => row.answerable)
  const noAnswer = rows.filter((row) => !row.answerable)
  let correct = 0
  let answerableCorrect = 0
  let noAnswerCorrect = 0

  for (const row of rows) {
    const surviving = thresholdedResults(row, threshold)
    if (row.answerable) {
      const expected = new Set(row.expectedIds)
      const rowCorrect = Boolean(surviving[0] && expected.has(surviving[0].id))
      if (rowCorrect) answerableCorrect += 1
      if (rowCorrect) correct += 1
    } else {
      const rowCorrect = surviving.length === 0
      if (rowCorrect) noAnswerCorrect += 1
      if (rowCorrect) correct += 1
    }
  }

  return {
    threshold,
    accuracy: correct / rows.length,
    answerableTop1Accuracy: answerable.length ? answerableCorrect / answerable.length : null,
    noAnswerAccuracy: noAnswer.length ? noAnswerCorrect / noAnswer.length : null
  }
}

export async function evaluateQueryCases(cases, search, { decisionThreshold = null } = {}) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('benchmark cases must not be empty')
  const rows = []
  for (const item of cases) {
    const started = performance.now()
    const response = await search(item)
    const clientElapsedMs = performance.now() - started
    const resultIds = response.results.map((result) => result.id)
    const serverTiming = response.meta?.timing_ms ?? {}
    const totalMs = finiteTiming(serverTiming.total) ?? finiteTiming(response.meta?.took_ms) ?? clientElapsedMs
    const answerable = item.answerable !== false
    const topResults = response.results.map((result) => ({
      id: result.id,
      score: result.score ?? null,
      type: result.type ?? null,
      name: result.name ?? null
    }))
    rows.push({
      id: item.id,
      language: item.language,
      category: item.category ?? 'uncategorized',
      challenge: item.challenge ?? null,
      query: item.query,
      answerable,
      expectedIds: item.expected_ids,
      resultIds,
      expectedRank: answerable ? firstExpectedRank(resultIds, item.expected_ids) : null,
      hits: answerable
        ? {
            at1: hitAtK(resultIds, item.expected_ids, 1),
            at3: hitAtK(resultIds, item.expected_ids, 3),
            at5: hitAtK(resultIds, item.expected_ids, 5)
          }
        : { at1: 0, at3: 0, at5: 0 },
      topResults,
      top1Top2Margin: scoreMargin(topResults),
      timingMs: {
        embedding: finiteTiming(serverTiming.embedding),
        qdrant: finiteTiming(serverTiming.qdrant),
        total: totalMs,
        client: clientElapsedMs
      },
      totalMs
    })
  }

  const answerableRows = rows.filter((row) => row.answerable)
  if (!answerableRows.length) throw new TypeError('benchmark must contain at least one answerable case')
  const qualityByLanguage = summarizeBy(answerableRows, 'language')
  const qualityByCategory = summarizeBy(answerableRows, 'category')
  const qualityByChallenge = summarizeBy(answerableRows, 'challenge')
  const qualityByLanguageAndCategory = {}
  for (const language of Object.keys(qualityByLanguage)) {
    qualityByLanguageAndCategory[language] = summarizeBy(answerableRows.filter((row) => row.language === language), 'category')
  }

  return {
    cases: rows.length,
    answerableCases: answerableRows.length,
    noAnswerCases: rows.length - answerableRows.length,
    quality: summarizeEvaluation(answerableRows),
    qualityByLanguage,
    qualityByCategory,
    qualityByChallenge,
    qualityByLanguageAndCategory,
    rankingMargins: summarizeLatencies(rows.map((row) => row.top1Top2Margin).filter((value) => value !== null)),
    decisionQuality: summarizeDecisionQuality(rows, decisionThreshold),
    latencyMs: summarizeLatencies(rows.map((row) => row.totalMs)),
    latencyMsByComponent: {
      embedding: summarizeTimingComponent(rows, 'embedding'),
      qdrant: summarizeTimingComponent(rows, 'qdrant'),
      total: summarizeTimingComponent(rows, 'total'),
      client: summarizeTimingComponent(rows, 'client')
    },
    rows
  }
}
