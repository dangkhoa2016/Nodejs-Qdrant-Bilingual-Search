import { summarizeEvaluation } from './metrics.js'

export const FOCUSED_FAILURE_CASE_IDS = Object.freeze([
  'en-hard-country-20',
  'vi-hard-country-06',
  'vi-hard-country-08',
  'vi-hard-country-14',
  'vi-hard-country-17',
  'vi-hard-country-18',
  'vi-hard-city-02',
  'vi-hard-city-17',
  'vi-hard-city-19'
])

function unique(values) {
  return [...new Set(values)]
}

function assertSize(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`)
}

function relationScore(entity, expectedEntities) {
  if (!['country', 'city'].includes(entity.type)) return -1
  const expectedCountryNames = new Set()
  const expectedContinents = new Set()
  const expectedRegions = new Set()
  const expectedCountryCodes = new Set()

  for (const expected of expectedEntities) {
    if (expected.type === 'country') {
      if (expected.name?.en) expectedCountryNames.add(expected.name.en)
      if (expected.name?.vi) expectedCountryNames.add(expected.name.vi)
    }
    if (typeof expected.facts?.country === 'string' && expected.facts.country.trim()) {
      expectedCountryNames.add(expected.facts.country.trim())
    }
    if (expected.continent) expectedContinents.add(expected.continent)
    if (expected.region) expectedRegions.add(expected.region)
    if (expected.countryCode) expectedCountryCodes.add(expected.countryCode)
  }

  let score = 0
  if (typeof entity.facts?.country === 'string' && expectedCountryNames.has(entity.facts.country.trim())) score += 8
  if (entity.name?.en && expectedCountryNames.has(entity.name.en)) score += 8
  if (entity.name?.vi && expectedCountryNames.has(entity.name.vi)) score += 8
  if (entity.countryCode && expectedCountryCodes.has(entity.countryCode)) score += 4
  if (entity.region && expectedRegions.has(entity.region)) score += 2
  if (entity.continent && expectedContinents.has(entity.continent)) score += 1
  return score
}

export function buildFocusedCandidateSet({
  cases,
  hardReport,
  entities,
  focusCaseIds = FOCUSED_FAILURE_CASE_IDS,
  targetSize = 75,
  maxSize = 150
}) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('cases must not be empty')
  if (!hardReport || !Array.isArray(hardReport.rows)) throw new TypeError('hardReport.rows must be an array')
  if (!Array.isArray(entities) || !entities.length) throw new TypeError('entities must not be empty')
  if (!Array.isArray(focusCaseIds) || !focusCaseIds.length) throw new TypeError('focusCaseIds must not be empty')
  assertSize(targetSize, 'targetSize')
  assertSize(maxSize, 'maxSize')
  if (targetSize > maxSize) throw new RangeError('targetSize must be <= maxSize')

  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const rowById = new Map(hardReport.rows.map((row) => [row?.id, row]))
  const expectedIds = unique(cases
    .filter((item) => item?.answerable !== false)
    .flatMap((item) => Array.isArray(item?.expected_ids) ? item.expected_ids : []))

  for (const id of expectedIds) {
    if (!entityById.has(id)) throw new Error(`expected entity is missing from dataset: ${id}`)
  }

  const observedDistractorIds = []
  for (const caseId of focusCaseIds) {
    const row = rowById.get(caseId)
    if (!row) throw new Error(`focus case is missing from hard report: ${caseId}`)
    const expectedForCase = new Set(cases.find((item) => item.id === caseId)?.expected_ids ?? [])
    for (const result of row.topResults ?? []) {
      const id = result?.id
      if (!id || expectedForCase.has(id) || observedDistractorIds.includes(id)) continue
      if (!entityById.has(id)) throw new Error(`hard-report distractor is missing from dataset: ${id}`)
      observedDistractorIds.push(id)
    }
  }

  const requiredIds = unique([...expectedIds, ...observedDistractorIds])
  if (requiredIds.length > maxSize) {
    throw new RangeError(`required focused candidates (${requiredIds.length}) exceed maxSize (${maxSize})`)
  }
  const selectedIds = [...requiredIds]
  const expectedEntities = expectedIds.map((id) => entityById.get(id))

  if (selectedIds.length < targetSize) {
    const selected = new Set(selectedIds)
    const fillers = entities
      .filter((entity) => !selected.has(entity.id) && ['country', 'city'].includes(entity.type))
      .map((entity) => ({ entity, score: relationScore(entity, expectedEntities) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id))

    for (const { entity } of fillers) {
      if (selectedIds.length >= targetSize || selectedIds.length >= maxSize) break
      selectedIds.push(entity.id)
    }
  }
  if (selectedIds.length < targetSize) {
    throw new Error(`could only build ${selectedIds.length} focused candidates; targetSize ${targetSize} is not satisfiable from this dataset`)
  }

  return {
    entities: selectedIds.map((id) => entityById.get(id)),
    manifest: {
      candidateCount: selectedIds.length,
      targetSize,
      maxSize,
      focusCaseIds: [...focusCaseIds],
      expectedIds,
      observedDistractorIds,
      candidateIds: [...selectedIds]
    }
  }
}


function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`)
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    throw new TypeError('vectors must be non-empty arrays with equal dimensions')
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index])
    const b = Number(right[index])
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError('vectors must contain finite numbers')
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) throw new TypeError('vectors must have non-zero norm')
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function roundMetric(value) {
  return Math.round(value * 1e12) / 1e12
}

export function rankFocusedCandidates(queryVector, candidateEntities, documentVectors, limit = 5) {
  assertPositiveInteger(limit, 'limit')
  if (!Array.isArray(candidateEntities) || !Array.isArray(documentVectors) || candidateEntities.length !== documentVectors.length || !candidateEntities.length) {
    throw new TypeError('candidate entities and document vectors must be non-empty arrays with equal lengths')
  }
  return candidateEntities
    .map((entity, index) => ({
      id: entity.id,
      score: roundMetric(cosineSimilarity(queryVector, documentVectors[index])),
      type: entity.type,
      name: entity.name
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export function evaluateFocusedVariant(cases, queryVectorsById, candidateEntities, documentVectors, { limit = 5 } = {}) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('cases must not be empty')
  if (!(queryVectorsById instanceof Map)) throw new TypeError('queryVectorsById must be a Map')

  const rows = cases.map((item) => {
    const queryVector = queryVectorsById.get(item.id)
    if (!queryVector) throw new Error(`missing query vector for ${item.id}`)
    const fullResults = rankFocusedCandidates(queryVector, candidateEntities, documentVectors, candidateEntities.length)
    const topResults = fullResults.slice(0, limit)
    const resultIds = topResults.map((result) => result.id)
    const expectedIds = Array.isArray(item.expected_ids) ? item.expected_ids : []
    const expected = new Set(expectedIds)
    const expectedIndex = fullResults.findIndex((result) => expected.has(result.id))
    const expectedRank = expectedIndex < 0 ? null : expectedIndex + 1
    const expectedScore = fullResults.find((result) => expected.has(result.id))?.score ?? null
    const bestDistractorScore = fullResults.find((result) => !expected.has(result.id))?.score ?? null

    return {
      id: item.id,
      language: item.language,
      category: item.category,
      challenge: item.challenge ?? null,
      query: item.query,
      expectedIds,
      expectedRank,
      resultIds,
      topResults,
      top1Top2Margin: topResults.length >= 2 ? roundMetric(topResults[0].score - topResults[1].score) : null,
      targetVsBestDistractorMargin: expectedScore != null && bestDistractorScore != null
        ? roundMetric(expectedScore - bestDistractorScore)
        : null
    }
  })

  const summarizeRows = (subset) => summarizeEvaluation(subset.map((row) => ({ resultIds: row.resultIds, expectedIds: row.expectedIds })))
  const summarizeBy = (key) => Object.fromEntries(
    [...new Set(rows.map((row) => row[key]).filter(Boolean))].map((value) => [value, summarizeRows(rows.filter((row) => row[key] === value))])
  )

  return {
    cases: rows.length,
    quality: summarizeRows(rows),
    qualityByLanguage: summarizeBy('language'),
    qualityByCategory: summarizeBy('category'),
    qualityByChallenge: summarizeBy('challenge'),
    rows
  }
}

function metricDelta(before, after) {
  const keys = ['mrr', 'recallAt1', 'recallAt3', 'recallAt5']
  return Object.fromEntries(keys.map((key) => [key, roundMetric((after?.[key] ?? 0) - (before?.[key] ?? 0))]))
}



function compareGroupedQuality(before = {}, after = {}, secondLabel = 'v2') {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return Object.fromEntries(keys.map((key) => {
    const v1 = before[key] ?? null
    const second = after[key] ?? null
    return [key, {
      v1,
      [secondLabel]: second,
      delta: v1 && second ? metricDelta(v1, second) : null
    }]
  }))
}

function rowEvidence(row) {
  return {
    expectedRank: row?.expectedRank ?? null,
    top1Top2Margin: row?.top1Top2Margin ?? null,
    targetVsBestDistractorMargin: row?.targetVsBestDistractorMargin ?? null
  }
}

export function compareFocusedVariants(v1, v2, { focusCaseIds = FOCUSED_FAILURE_CASE_IDS, secondLabel = 'v2' } = {}) {
  const v1ById = new Map((v1?.rows ?? []).map((row) => [row.id, row]))
  const v2ById = new Map((v2?.rows ?? []).map((row) => [row.id, row]))
  const focusCases = focusCaseIds.map((id) => {
    const before = v1ById.get(id)
    const after = v2ById.get(id)
    if (!before || !after) throw new Error(`missing focused A/B row for ${id}`)
    const v1Evidence = rowEvidence(before)
    const v2Evidence = rowEvidence(after)
    const rankGain = Number.isInteger(v1Evidence.expectedRank) && Number.isInteger(v2Evidence.expectedRank)
      ? v1Evidence.expectedRank - v2Evidence.expectedRank
      : null
    const marginDelta = v1Evidence.top1Top2Margin != null && v2Evidence.top1Top2Margin != null
      ? roundMetric(v2Evidence.top1Top2Margin - v1Evidence.top1Top2Margin)
      : null
    const targetMarginDelta = v1Evidence.targetVsBestDistractorMargin != null && v2Evidence.targetVsBestDistractorMargin != null
      ? roundMetric(v2Evidence.targetVsBestDistractorMargin - v1Evidence.targetVsBestDistractorMargin)
      : null
    return {
      id,
      challenge: after.challenge ?? before.challenge ?? null,
      noDiacritics: (after.challenge ?? before.challenge) === 'no-diacritics',
      v1: v1Evidence,
      [secondLabel]: v2Evidence,
      delta: {
        rankGain,
        top1Top2Margin: marginDelta,
        targetVsBestDistractorMargin: targetMarginDelta
      }
    }
  })

  return {
    quality: {
      v1: v1.quality,
      [secondLabel]: v2.quality,
      delta: metricDelta(v1.quality, v2.quality)
    },
    qualityByLanguage: compareGroupedQuality(v1.qualityByLanguage, v2.qualityByLanguage, secondLabel),
    qualityByCategory: compareGroupedQuality(v1.qualityByCategory, v2.qualityByCategory, secondLabel),
    qualityByChallenge: compareGroupedQuality(v1.qualityByChallenge, v2.qualityByChallenge, secondLabel),
    focusCases
  }
}
