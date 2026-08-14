#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../../src/config.js'
import { loadEntities } from '../../src/dataset/io.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import {
  FULL20K_AB_RUNTIME,
  assertFull20kAbRuntime,
  assertFull20kCollectionInfo,
  runFull20kCollectionAbExperiment
} from '../../src/evaluation/full20k-collection-ab-runner.js'
import { createProductionQdrantConnection } from '../../src/qdrant/create-qdrant-connection.js'
import { QdrantService } from '../../src/qdrant/qdrant-service.js'
import { createIndexFingerprint } from '../../src/seed/index-fingerprint.js'

const HARD_V2_CORPUS_SHA256 = '3f0ebee543de7fe93ef3add07fef390e88ab56f03f4b1b57ef71f8588e44bacc'

function positiveInteger(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
  return parsed
}

const config = loadConfig()
const queryPath = resolve(process.env.FULL20K_AB_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v2.json')
const datasetPath = resolve(process.env.FULL20K_AB_DATASET ?? 'data/generated/entities.final.json')
const outputPath = resolve(process.env.FULL20K_AB_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-full20k-collection-ab.json')
const v1Collection = String(process.env.FULL20K_AB_V1_COLLECTION ?? 'knowledge_entities_qwen3_4b_v1').trim()
const v21Collection = String(process.env.FULL20K_AB_V21_COLLECTION ?? 'knowledge_entities_qwen3_4b_text_v21').trim()
const expectedPoints = positiveInteger(process.env.FULL20K_AB_EXPECTED_POINTS, 20000, 'FULL20K_AB_EXPECTED_POINTS')
const resultLimit = positiveInteger(process.env.FULL20K_AB_RESULT_LIMIT, 5, 'FULL20K_AB_RESULT_LIMIT')
const rankProbeLimit = positiveInteger(process.env.FULL20K_AB_RANK_PROBE_LIMIT, 100, 'FULL20K_AB_RANK_PROBE_LIMIT')
if (!v1Collection || !v21Collection) throw new TypeError('both full-20k collection names are required')
if (v1Collection === v21Collection) throw new Error('full-20k A/B requires two distinct Qdrant collections')
if (rankProbeLimit < resultLimit) throw new RangeError('FULL20K_AB_RANK_PROBE_LIMIT must be >= FULL20K_AB_RESULT_LIMIT')

const entities = await loadEntities(datasetPath)
if (entities.length !== expectedPoints) {
  throw new Error(`full-20k A/B dataset count mismatch: expected ${expectedPoints}, got ${entities.length}`)
}
const querySource = await readFile(queryPath, 'utf8')
const queryCorpusSha256 = createHash('sha256').update(querySource).digest('hex')
if (queryCorpusSha256 !== HARD_V2_CORPUS_SHA256) {
  throw new Error(`Hard-v2 corpus SHA-256 mismatch: expected ${HARD_V2_CORPUS_SHA256}, got ${queryCorpusSha256}`)
}
const rawCases = JSON.parse(querySource)
const cases = validateBenchmarkCases(rawCases, entities)
const answerableCount = cases.filter((item) => item.answerable !== false).length
const noAnswerCount = cases.filter((item) => item.answerable === false).length
if (cases.length !== 100 || answerableCount !== 80 || noAnswerCount !== 20) {
  throw new Error(`Hard-v2 corpus shape mismatch: expected 100 total / 80 answerable / 20 no-answer, got ${cases.length} / ${answerableCount} / ${noAnswerCount}`)
}

const embeddingProvider = new HttpEmbeddingProvider({
  baseUrl: config.embeddingUrl,
  model: FULL20K_AB_RUNTIME.model,
  dimension: FULL20K_AB_RUNTIME.dimension,
  transport: config.embeddingTransport,
  timeoutMs: config.embeddingTimeoutMs
})
const runtime = assertFull20kAbRuntime(await embeddingProvider.assertCompatible())

const connection = await createProductionQdrantConnection({ config })
await connection.waitUntilReady()
const qdrantV1 = new QdrantService({ connection, collection: v1Collection, dimension: FULL20K_AB_RUNTIME.dimension })
const qdrantV21 = new QdrantService({ connection, collection: v21Collection, dimension: FULL20K_AB_RUNTIME.dimension })

const [v1Info, v21Info] = await Promise.all([qdrantV1.stats(), qdrantV21.stats()])
const collectionState = {
  v1: assertFull20kCollectionInfo(v1Info, { collection: v1Collection, dimension: FULL20K_AB_RUNTIME.dimension, expectedPoints, rankProbeLimit }),
  v21: assertFull20kCollectionInfo(v21Info, { collection: v21Collection, dimension: FULL20K_AB_RUNTIME.dimension, expectedPoints, rankProbeLimit })
}

const v1Audit = await qdrantV1.verifyEmbeddingRuntime({
  expectedPoints,
  runtime,
  embeddingModel: FULL20K_AB_RUNTIME.model,
  embeddingTextVersion: 'v1'
})
const v21Audit = await qdrantV21.verifyEmbeddingRuntime({
  expectedPoints,
  runtime,
  embeddingModel: FULL20K_AB_RUNTIME.model,
  embeddingTextVersion: 'v2.1'
})

const fingerprintMetadata = {
  embeddingModel: FULL20K_AB_RUNTIME.model,
  embeddingVersion: process.env.FULL20K_AB_EMBEDDING_VERSION ?? 'qwen3-4b-v1',
  datasetVersion: process.env.DATASET_VERSION ?? 'public-v1',
  embeddingRuntime: runtime
}
const fingerprints = {
  v1: createIndexFingerprint(entities, { ...fingerprintMetadata, embeddingTextVersion: 'v1' }),
  v21: createIndexFingerprint(entities, { ...fingerprintMetadata, embeddingTextVersion: 'v2.1' })
}
const fingerprintAudit = {
  v1: await qdrantV1.verifySeed({ indexFingerprint: fingerprints.v1.value, expectedPoints }),
  v21: await qdrantV21.verifySeed({ indexFingerprint: fingerprints.v21.value, expectedPoints })
}

const result = await runFull20kCollectionAbExperiment({
  cases,
  embeddingProvider,
  qdrantV1,
  qdrantV21,
  resultLimit,
  rankProbeLimit
})

const generatedAt = new Date().toISOString()
const report = {
  generatedAt,
  inputs: { queryPath, queryCorpusSha256, datasetPath, embeddingUrl: config.embeddingUrl, v1Collection, v21Collection },
  runtime,
  preflight: {
    expectedPoints,
    collectionState,
    provenance: { v1: v1Audit, v21: v21Audit },
    fingerprint: { expected: fingerprints, audit: fingerprintAudit }
  },
  controlledVariables: {
    model: FULL20K_AB_RUNTIME.model,
    dimension: FULL20K_AB_RUNTIME.dimension,
    queryInstructionId: FULL20K_AB_RUNTIME.queryInstructionId,
    queryStrategy: FULL20K_AB_RUNTIME.queryStrategy,
    documentStrategy: FULL20K_AB_RUNTIME.documentStrategy,
    queryCorpus: queryPath,
    dataset: datasetPath,
    resultLimit,
    rankProbeLimit,
    scoreThreshold: 0,
    queryEmbeddingReuse: 'one query embedding per benchmark case reused unchanged for v1 and v2.1 collection queries',
    onlyChangedVariable: 'Qdrant collection / document embedding text: v1 vs v2.1'
  },
  ...result
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify({
  output: outputPath,
  experiment: result.experiment,
  collections: { v1: v1Collection, v21: v21Collection },
  preflight: report.preflight,
  cases: result.cases,
  answerableCases: result.answerableCases,
  noAnswerCases: result.noAnswerCases,
  quality: result.comparison.quality,
  qualityByLanguage: result.comparison.qualityByLanguage,
  qualityByCategory: result.comparison.qualityByCategory,
  qualityByChallenge: result.comparison.qualityByChallenge,
  nonNoDiacritics: result.comparison.nonNoDiacritics,
  focusCases: result.comparison.focusCases,
  sentinels: result.comparison.sentinels,
  noAnswerTop1Score: result.comparison.noAnswerTop1Score,
  acceptance: result.acceptance,
  note: 'No threshold is promoted here; no-answer scores are evidence for the later threshold-calibration stage.'
}, null, 2))
