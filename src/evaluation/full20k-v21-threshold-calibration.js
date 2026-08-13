import { calibrateThresholds } from './threshold-calibration.js'

export const HARD_V2_CORPUS_SHA256 = '3f0ebee543de7fe93ef3add07fef390e88ab56f03f4b1b57ef71f8588e44bacc'
export const FULL20K_V21_THRESHOLDS = Object.freeze([0.50, 0.51, 0.53, 0.55])
export const FULL20K_V21_COLLECTION = 'knowledge_entities_qwen3_4b_text_v21'
export const FULL20K_V21_MODEL = 'Qwen/Qwen3-Embedding-4B'

function roundMetric(value) {
  return Math.round(value * 1e12) / 1e12
}

function percentile(sorted, percentage) {
  if (!sorted.length) return null
  const index = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarizeScores(values) {
  if (!Array.isArray(values) || !values.length || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('score distribution requires non-empty finite scores')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  return {
    count: sorted.length,
    min: sorted[0],
    mean: roundMetric(mean),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1)
  }
}

function top1Score(row) {
  const score = Number(row?.topResults?.[0]?.score)
  if (!Number.isFinite(score)) throw new Error(`threshold calibration row ${row?.id ?? '<unknown>'} is missing a finite top-1 score`)
  return score
}

function caseEvidence(row) {
  return {
    id: row.id,
    language: row.language ?? null,
    query: row.query ?? null,
    expectedIds: Array.isArray(row.expectedIds) ? row.expectedIds : [],
    expectedRank: row.expectedRank ?? null,
    top1Id: row.topResults?.[0]?.id ?? null,
    top1Score: top1Score(row)
  }
}

function predictedAnswered(row, threshold) {
  return (row.topResults ?? []).some((result) => Number.isFinite(result?.score) && result.score >= threshold)
}

function addCandidateEvidence(candidate, rows, { minAnswerableTop1, maxNoAnswerTop1 }) {
  const falsePositives = rows
    .filter((row) => row.answerable === false && predictedAnswered(row, candidate.threshold))
    .map(caseEvidence)
  const falseNegatives = rows
    .filter((row) => row.answerable !== false && !predictedAnswered(row, candidate.threshold))
    .map(caseEvidence)
  const answerableHeadroom = roundMetric(minAnswerableTop1 - candidate.threshold)
  const noAnswerHeadroom = roundMetric(candidate.threshold - maxNoAnswerTop1)

  return {
    ...candidate,
    falsePositives,
    falseNegatives,
    answerableHeadroom,
    noAnswerHeadroom,
    guardBand: roundMetric(Math.min(answerableHeadroom, noAnswerHeadroom))
  }
}

function compareRobustCandidates(a, b, currentProductionThreshold) {
  return (
    b.decisionAccuracy - a.decisionAccuracy ||
    b.answerability.f1 - a.answerability.f1 ||
    b.answerableTop1Accuracy - a.answerableTop1Accuracy ||
    b.noAnswerAccuracy - a.noAnswerAccuracy ||
    b.guardBand - a.guardBand ||
    Math.abs(a.threshold - currentProductionThreshold) - Math.abs(b.threshold - currentProductionThreshold) ||
    a.threshold - b.threshold
  )
}

export function assertFull20kV21CalibrationSource(report) {
  if (!report || typeof report !== 'object') throw new TypeError('full-20k A/B report is required')
  if (report.experiment !== 'embedding_text_v1_vs_v2_1_full20k_collection_ab') {
    throw new Error('threshold calibration requires the full-20k v1-v2.1 collection A/B report')
  }
  if (report.inputs?.queryCorpusSha256 !== HARD_V2_CORPUS_SHA256) {
    throw new Error(`Hard-v2 corpus SHA-256 mismatch: expected ${HARD_V2_CORPUS_SHA256}, got ${report.inputs?.queryCorpusSha256 ?? 'missing'}`)
  }
  if (report.inputs?.v21Collection !== FULL20K_V21_COLLECTION) {
    throw new Error(`v2.1 collection mismatch: expected ${FULL20K_V21_COLLECTION}, got ${report.inputs?.v21Collection ?? 'missing'}`)
  }
  if (report.acceptance?.accepted !== true) {
    throw new Error('full-20k v2.1 quality acceptance must already be true before threshold calibration')
  }
  if (report.cases !== 100 || report.answerableCases !== 80 || report.noAnswerCases !== 20) {
    throw new Error(`Hard-v2 report shape mismatch: expected 100 / 80 / 20, got ${report.cases ?? 'missing'} / ${report.answerableCases ?? 'missing'} / ${report.noAnswerCases ?? 'missing'}`)
  }
  if (report.preflight?.expectedPoints !== 20000) {
    throw new Error(`full-20k expected point count must be 20000, got ${report.preflight?.expectedPoints ?? 'missing'}`)
  }
  if (report.controlledVariables?.scoreThreshold !== 0) {
    throw new Error(`full-20k A/B source score threshold must be 0, got ${report.controlledVariables?.scoreThreshold ?? 'missing'}`)
  }

  const fingerprintExpected = report.preflight?.fingerprint?.expected?.v21
  const fingerprintAudit = report.preflight?.fingerprint?.audit?.v21
  if (fingerprintExpected?.embeddingTextVersion !== 'v2.1' || fingerprintExpected?.entityCount !== 20000 || typeof fingerprintExpected?.value !== 'string' || !fingerprintExpected.value.startsWith('sha256:')) {
    throw new Error('v2.1 fingerprint expectation must identify the 20000-point v2.1 index')
  }
  if (fingerprintAudit?.pointsCount !== 20000 || fingerprintAudit?.matchingCount !== 20000) {
    throw new Error('v2.1 fingerprint must match all 20000 points')
  }

  const state = report.preflight?.collectionState?.v21
  if (state?.collection !== FULL20K_V21_COLLECTION || String(state?.status ?? '').toLowerCase() !== 'green' || state?.pointsCount !== 20000 || state?.dimension !== 2560 || String(state?.distance ?? '').toLowerCase() !== 'cosine') {
    throw new Error('v2.1 collection preflight must be green, Cosine, 2560-dimensional, and contain exactly 20000 points')
  }

  const provenance = report.preflight?.provenance?.v21
  if (provenance?.embeddingTextVersion !== 'v2.1') {
    throw new Error(`v2.1 embedding text version provenance must be v2.1, got ${provenance?.embeddingTextVersion ?? 'missing'}`)
  }
  if (provenance?.embeddingModel !== FULL20K_V21_MODEL) {
    throw new Error(`v2.1 embedding model provenance mismatch: expected ${FULL20K_V21_MODEL}, got ${provenance?.embeddingModel ?? 'missing'}`)
  }
  if (provenance?.pointsCount !== 20000 || provenance?.matchingCount !== 20000) {
    throw new Error('v2.1 semantic provenance must match all 20000 points')
  }

  const rows = report.variants?.v21?.rows
  if (!Array.isArray(rows) || rows.length !== 100) throw new Error('v2.1 full-20k report must contain exactly 100 threshold rows')
  const answerableCases = rows.filter((row) => row.answerable !== false).length
  const noAnswerCases = rows.filter((row) => row.answerable === false).length
  if (answerableCases !== 80 || noAnswerCases !== 20) {
    throw new Error(`v2.1 threshold rows must contain 80 answerable and 20 no-answer cases, got ${answerableCases} and ${noAnswerCases}`)
  }
  for (const row of rows) top1Score(row)

  return { rows, state, provenance }
}

export function calibrateFull20kV21Threshold(report, {
  thresholds = FULL20K_V21_THRESHOLDS,
  currentProductionThreshold = 0.55
} = {}) {
  if (!Number.isFinite(currentProductionThreshold) || currentProductionThreshold < 0 || currentProductionThreshold > 1) {
    throw new TypeError('currentProductionThreshold must be between 0 and 1')
  }
  const { rows, state, provenance } = assertFull20kV21CalibrationSource(report)
  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  const answerableTop1Scores = answerableRows.map(top1Score)
  const noAnswerTop1Scores = noAnswerRows.map(top1Score)
  const answerableSummary = summarizeScores(answerableTop1Scores)
  const noAnswerSummary = summarizeScores(noAnswerTop1Scores)
  const separation = {
    minAnswerableTop1: answerableSummary.min,
    maxNoAnswerTop1: noAnswerSummary.max,
    gap: roundMetric(answerableSummary.min - noAnswerSummary.max),
    overlap: noAnswerSummary.max >= answerableSummary.min
  }

  const framework = calibrateThresholds(rows, { thresholds })
  const candidates = framework.candidates.map((candidate) => addCandidateEvidence(candidate, rows, {
    minAnswerableTop1: separation.minAnswerableTop1,
    maxNoAnswerTop1: separation.maxNoAnswerTop1
  }))
  const robustRecommended = [...candidates].sort((a, b) => compareRobustCandidates(a, b, currentProductionThreshold))[0]
  const currentProductionCandidate = candidates.find((candidate) => candidate.threshold === currentProductionThreshold) ?? null
  const semanticTop1Errors = answerableRows
    .filter((row) => !new Set(row.expectedIds ?? []).has(row.topResults?.[0]?.id))
    .map(caseEvidence)

  return {
    experiment: 'embedding_text_v2_1_full20k_threshold_calibration',
    sourceExperiment: report.experiment,
    sourceGeneratedAt: report.generatedAt ?? null,
    sourceCollection: state.collection,
    sourceEmbeddingModel: provenance.embeddingModel,
    sourceEmbeddingTextVersion: provenance.embeddingTextVersion,
    sourceQueryCorpusSha256: report.inputs.queryCorpusSha256,
    cases: rows.length,
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    thresholds: candidates.map((candidate) => candidate.threshold),
    scoreDistribution: {
      answerableTop1: answerableSummary,
      noAnswerTop1: noAnswerSummary,
      separation
    },
    semanticTop1Errors,
    existingFrameworkSelectionRule: framework.selectionRule,
    existingFrameworkRecommendedThreshold: framework.recommended.threshold,
    candidates,
    recommendation: {
      status: 'candidate-only',
      threshold: robustRecommended.threshold,
      currentProductionThreshold,
      currentProductionCandidate,
      selectionRule: 'maximize decisionAccuracy, answerability F1, answerable top-1 accuracy and no-answer accuracy; then maximize score guard-band; then prefer proximity to the current production threshold',
      guardBand: robustRecommended.guardBand,
      noAnswerSampleSize: noAnswerRows.length,
      caution: 'Hard-v2 contains only 20 no-answer cases, so this report supports a threshold candidate but does not change production configuration automatically.'
    }
  }
}
