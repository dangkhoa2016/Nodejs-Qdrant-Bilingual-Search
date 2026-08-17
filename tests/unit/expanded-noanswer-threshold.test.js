import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const hardV2 = JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v2.json', import.meta.url), 'utf8'))

const loadCorpus = async () => JSON.parse(await readFile(new URL('../../benchmarks/queries/bilingual-hard-v3-threshold.json', import.meta.url), 'utf8'))
const loadModule = async () => import('../../src/evaluation/expanded-noanswer-threshold.js').catch(() => ({}))

function canonicalPreflight() {
  return {
    canonical: true,
    collection: 'knowledge_entities_qwen3_4b_text_v21',
    pointsCount: 20000,
    indexedVectorsCount: 20000,
    embeddingModel: 'Qwen/Qwen3-Embedding-4B',
    embeddingDimension: 2560,
    embeddingTextVersion: 'v2.1',
    productionScoreThreshold: 0.55,
    queryStrategy: 'prompt',
    queryInstructionId: 'geo-retrieval-v1:d014d3ec6df87e49',
    documentStrategy: 'raw'
  }
}

function responseFor(item, { score = 0.48, rank = 1 } = {}) {
  const expected = item.expected_ids?.[0]
  const positiveResults = rank === 1
    ? [{ id: expected, score }, { id: 'distractor:1', score: score - 0.01 }]
    : [{ id: 'distractor:1', score: score + 0.01 }, { id: expected, score }]
  const results = item.answerable === false
    ? [{ id: 'distractor:negative', score }, { id: 'distractor:negative-2', score: score - 0.01 }]
    : positiveResults
  return {
    status: 200,
    body: {
      query: { text: item.query, language: item.language },
      search: { mode: 'semantic', embedding_model: 'Qwen/Qwen3-Embedding-4B', vector_dimension: 2560, distance: 'Cosine' },
      results,
      meta: { count: results.length, timing_ms: { embedding: 20, qdrant: 4, total: 25 } }
    },
    clientElapsedMs: 27
  }
}

function makeRows({ positiveScore = 0.58, negativeScore = 0.49, borderlinePositiveScore = null, negativeOver55 = false } = {}) {
  const positives = Array.from({ length: 80 }, (_, index) => ({
    id: `answerable-${index + 1}`,
    language: index % 2 ? 'vi' : 'en',
    category: index % 2 ? 'city-capital' : 'country-factual',
    challenge: 'paraphrase',
    answerable: true,
    expectedIds: [`E${index + 1}`],
    topResults: [{ id: `E${index + 1}`, score: index === 0 && borderlinePositiveScore != null ? borderlinePositiveScore : positiveScore }],
    resultIds: [`E${index + 1}`],
    resultCount: 1,
    top1Id: `E${index + 1}`,
    top1Score: index === 0 && borderlinePositiveScore != null ? borderlinePositiveScore : positiveScore,
    expectedRank: 1,
    httpStatus: 200,
    responseMappingError: null,
    timingMs: { embedding: 20, qdrant: 4, total: 25, client: 27 }
  }))
  const negatives = Array.from({ length: 120 }, (_, index) => ({
    id: `negative-${index + 1}`,
    language: index % 2 ? 'vi' : 'en',
    category: 'no-answer',
    challenge: `challenge-${(index % 10) + 1}`,
    answerable: false,
    expectedIds: [],
    topResults: [{ id: `N${index + 1}`, score: negativeOver55 && index === 0 ? 0.56 : negativeScore }],
    resultIds: [`N${index + 1}`],
    resultCount: 1,
    top1Id: `N${index + 1}`,
    top1Score: negativeOver55 && index === 0 ? 0.56 : negativeScore,
    expectedRank: null,
    httpStatus: 200,
    responseMappingError: null,
    timingMs: { embedding: 20, qdrant: 4, total: 25, client: 27 }
  }))
  return [...positives, ...negatives]
}

function makeSourceReport(rows = makeRows()) {
  return {
    generatedAt: '2026-08-26T08:00:00.000Z',
    experiment: 'expanded_noanswer_v21_public_api_benchmark',
    inputs: { queryCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' },
    requestPolicy: { rankingScoreThreshold: 0, productionScoreThresholdRetained: 0.55 },
    preflight: { verified: canonicalPreflight() },
    cases: 200,
    answerableCases: 80,
    noAnswerCases: 120,
    rows,
    executionAcceptance: { accepted: true }
  }
}

test('Hard-v3 threshold corpus extends Hard-v2 unchanged to 200 cases with 120 balanced adversarial negatives', async () => {
  const cases = await loadCorpus()
  assert.equal(cases.length, 200)
  assert.deepEqual(cases.slice(0, hardV2.length), hardV2)
  assert.equal(cases.filter((item) => item.answerable !== false).length, 80)
  assert.equal(cases.filter((item) => item.answerable === false).length, 120)
  assert.equal(new Set(cases.map((item) => item.id)).size, 200)

  const added = cases.slice(hardV2.length)
  assert.equal(added.length, 100)
  assert.equal(added.filter((item) => item.answerable === false).length, 100)
  assert.equal(added.filter((item) => item.language === 'en').length, 50)
  assert.equal(added.filter((item) => item.language === 'vi').length, 50)
  const distribution = Object.fromEntries([...new Set(added.map((item) => item.challenge))].sort().map((challenge) => [challenge, added.filter((item) => item.challenge === challenge).length]))
  assert.equal(Object.keys(distribution).length, 10)
  assert.equal(Object.values(distribution).every((count) => count === 10), true)
})

test('expanded benchmark API evaluator captures answerable and no-answer evidence without imposing a rank on negatives', async () => {
  const { evaluateExpandedNoAnswerApiCases } = await loadModule()
  assert.equal(typeof evaluateExpandedNoAnswerApiCases, 'function')
  const cases = await loadCorpus()
  const sample = [cases.find((item) => item.answerable !== false), cases.find((item) => item.answerable === false)]
  const rows = await evaluateExpandedNoAnswerApiCases(sample, async (item) => responseFor(item, { score: item.answerable === false ? 0.49 : 0.61 }))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].expectedRank, 1)
  assert.equal(rows[0].top1Score, 0.61)
  assert.equal(rows[1].answerable, false)
  assert.equal(rows[1].expectedRank, null)
  assert.equal(rows[1].top1Score, 0.49)
  assert.deepEqual(rows[1].timingMs, { embedding: 20, qdrant: 4, total: 25, client: 27 })
})

test('expanded benchmark execution acceptance protects the known 80-answerable v2.1 baseline but treats no-answer scores as calibration evidence', async () => {
  const { assessExpandedNoAnswerExecution } = await loadModule()
  assert.equal(typeof assessExpandedNoAnswerExecution, 'function')
  const rows = makeRows({ negativeOver55: true })
  const result = assessExpandedNoAnswerExecution({ preflight: canonicalPreflight(), rows })
  assert.equal(result.accepted, true)
  assert.equal(result.answerableQuality.recallAt1, 1)
  assert.equal(result.answerableQuality.recallAt5, 1)
  assert.equal(result.noAnswerCases, 120)

  rows[0].expectedRank = null
  rows[0].topResults = [{ id: 'wrong', score: 0.59 }]
  const regressed = assessExpandedNoAnswerExecution({ preflight: canonicalPreflight(), rows })
  assert.equal(regressed.accepted, false)
  assert.ok(regressed.failures.some((failure) => failure.reason === 'answerable-top5-regression'))
})

test('expanded threshold calibration retains 0.55 when 0.53 provides no recall gain even if both have zero false positives', async () => {
  const { calibrateExpandedNoAnswerThreshold } = await loadModule()
  assert.equal(typeof calibrateExpandedNoAnswerThreshold, 'function')
  const report = makeSourceReport()
  const result = calibrateExpandedNoAnswerThreshold(report, { expectedCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' })
  assert.deepEqual(result.thresholds, [0.5, 0.51, 0.53, 0.55])
  assert.equal(result.cases, 200)
  assert.equal(result.noAnswerCases, 120)
  assert.equal(result.candidates.every((candidate) => candidate.answerability.fp === 0), true)
  assert.equal(result.recommendation.status, 'retain-production')
  assert.equal(result.recommendation.threshold, 0.55)
  assert.equal(result.recommendation.reasonCode, 'NO_RECALL_GAIN_FROM_LOWER_THRESHOLD')
})

test('expanded threshold calibration marks 0.53 promotable only when it recovers answerables without worsening false positives', async () => {
  const { calibrateExpandedNoAnswerThreshold } = await loadModule()
  assert.equal(typeof calibrateExpandedNoAnswerThreshold, 'function')
  const report = makeSourceReport(makeRows({ borderlinePositiveScore: 0.54 }))
  const result = calibrateExpandedNoAnswerThreshold(report, { expectedCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' })
  const at053 = result.candidates.find((candidate) => candidate.threshold === 0.53)
  const at055 = result.candidates.find((candidate) => candidate.threshold === 0.55)
  assert.equal(at053.answerability.fn, 0)
  assert.equal(at055.answerability.fn, 1)
  assert.equal(result.recommendation.status, 'promote-candidate')
  assert.equal(result.recommendation.threshold, 0.53)
  assert.equal(result.recommendation.reasonCode, 'RECALL_GAIN_WITHOUT_FP_REGRESSION')
})

test('expanded threshold calibration flags threshold-only insufficiency when production 0.55 still admits adversarial false positives', async () => {
  const { calibrateExpandedNoAnswerThreshold } = await loadModule()
  assert.equal(typeof calibrateExpandedNoAnswerThreshold, 'function')
  const report = makeSourceReport(makeRows({ negativeOver55: true }))
  const result = calibrateExpandedNoAnswerThreshold(report, { expectedCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' })
  assert.equal(result.recommendation.status, 'retain-production-investigate-false-positives')
  assert.equal(result.recommendation.threshold, 0.55)
  assert.equal(result.recommendation.thresholdAloneInsufficient, true)
  assert.equal(result.candidates.find((candidate) => candidate.threshold === 0.55).answerability.fp, 1)
})

test('expanded threshold calibration fails closed on stale corpus, non-canonical runtime, censored source scores, or incomplete execution', async () => {
  const { calibrateExpandedNoAnswerThreshold } = await loadModule()
  assert.equal(typeof calibrateExpandedNoAnswerThreshold, 'function')

  const stale = makeSourceReport()
  assert.throws(() => calibrateExpandedNoAnswerThreshold(stale, { expectedCorpusSha256: 'different' }), /corpus SHA-256 mismatch/i)

  const rollback = makeSourceReport()
  rollback.preflight.verified.collection = 'knowledge_entities_qwen3_4b_v1'
  assert.throws(() => calibrateExpandedNoAnswerThreshold(rollback, { expectedCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' }), /canonical v2\.1/i)

  const censored = makeSourceReport()
  censored.requestPolicy.rankingScoreThreshold = 0.55
  assert.throws(() => calibrateExpandedNoAnswerThreshold(censored, { expectedCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' }), /score threshold must be 0/i)

  const incomplete = makeSourceReport()
  incomplete.executionAcceptance.accepted = false
  assert.throws(() => calibrateExpandedNoAnswerThreshold(incomplete, { expectedCorpusSha256: 'CORPUS_SHA_PLACEHOLDER' }), /execution acceptance must be true/i)
})
