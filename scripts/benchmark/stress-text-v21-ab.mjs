#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { normalizeEntity } from '../../src/domain/entity.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import {
  STRESS_AB_RUNTIME,
  assertStressAbRuntime,
  runStressTextV21AbExperiment
} from '../../src/evaluation/stress-text-ab-runner.js'

function positiveInteger(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
  return parsed
}

const queryPath = resolve(process.env.STRESS_AB_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v2.json')
const datasetPath = resolve(process.env.STRESS_AB_DATASET ?? 'data/generated/entities.final.json')
const hardReportPath = resolve(process.env.STRESS_AB_HARD_REPORT ?? 'reports/qwen3-4b-v1-20k-hard-v2.json')
const outputPath = resolve(process.env.STRESS_AB_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-stress-ab.json')
const textsOutputPath = resolve(process.env.STRESS_AB_TEXTS_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-stress-candidate-texts.json')
const manifestOutputPath = resolve(process.env.STRESS_AB_MANIFEST_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-stress-candidate-manifest.json')
const embeddingUrl = (process.env.EMBEDDING_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')
const targetSize = positiveInteger(process.env.STRESS_AB_TARGET_SIZE, 750, 'STRESS_AB_TARGET_SIZE')
const maxSize = positiveInteger(process.env.STRESS_AB_MAX_SIZE, 1000, 'STRESS_AB_MAX_SIZE')
const batchSize = positiveInteger(process.env.STRESS_AB_BATCH_SIZE, 128, 'STRESS_AB_BATCH_SIZE')

if (targetSize < 500) throw new RangeError('STRESS_AB_TARGET_SIZE must be >= 500 for the stress validation stage')
if (targetSize > maxSize) throw new RangeError('STRESS_AB_TARGET_SIZE must be <= STRESS_AB_MAX_SIZE')
if (maxSize > 1000) throw new RangeError('STRESS_AB_MAX_SIZE must be <= 1000 for the stress validation stage')
if (batchSize > 256) throw new RangeError('STRESS_AB_BATCH_SIZE must be <= 256')

const rawEntities = JSON.parse(await readFile(datasetPath, 'utf8'))
const entities = rawEntities.map(normalizeEntity)
const rawCases = JSON.parse(await readFile(queryPath, 'utf8'))
const cases = validateBenchmarkCases(rawCases, entities)
const hardReport = JSON.parse(await readFile(hardReportPath, 'utf8'))

const provider = new HttpEmbeddingProvider({
  baseUrl: embeddingUrl,
  model: STRESS_AB_RUNTIME.model,
  dimension: STRESS_AB_RUNTIME.dimension,
  transport: process.env.EMBEDDING_TRANSPORT ?? 'binary-f32',
  timeoutMs: positiveInteger(process.env.EMBEDDING_TIMEOUT_MS, 120000, 'EMBEDDING_TIMEOUT_MS')
})
const runtime = assertStressAbRuntime(await provider.assertCompatible())

const result = await runStressTextV21AbExperiment({
  cases,
  hardReport,
  entities,
  embeddingProvider: provider,
  targetSize,
  maxSize,
  batchSize
})

const generatedAt = new Date().toISOString()
const controlledVariables = {
  model: STRESS_AB_RUNTIME.model,
  dimension: STRESS_AB_RUNTIME.dimension,
  queryInstructionId: STRESS_AB_RUNTIME.queryInstructionId,
  queryStrategy: STRESS_AB_RUNTIME.queryStrategy,
  documentStrategy: STRESS_AB_RUNTIME.documentStrategy,
  device: STRESS_AB_RUNTIME.device,
  dtype: STRESS_AB_RUNTIME.dtype,
  queryCorpus: queryPath,
  candidateStrategy: result.candidateManifest.strategy,
  candidateIds: result.candidateManifest.candidateIds,
  similarity: 'cosine',
  resultLimit: 5,
  onlyChangedVariable: 'document embedding text: v1 vs v2.1'
}

const report = {
  generatedAt,
  inputs: { queryPath, datasetPath, hardReportPath, embeddingUrl },
  runtime,
  controlledVariables,
  hypothesis: 'v2.1 remains better than v1 when challenged by a 500-1000 document adversarial universe containing every country, every capital city, observed hard distractors, related/locality cities and global major cities.',
  ...result
}

await Promise.all([
  mkdir(dirname(outputPath), { recursive: true }),
  mkdir(dirname(textsOutputPath), { recursive: true }),
  mkdir(dirname(manifestOutputPath), { recursive: true })
])
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`),
  writeFile(textsOutputPath, `${JSON.stringify({ generatedAt, candidateTexts: result.candidateTexts }, null, 2)}\n`),
  writeFile(manifestOutputPath, `${JSON.stringify({ generatedAt, ...result.candidateManifest }, null, 2)}\n`)
])

console.log(JSON.stringify({
  output: outputPath,
  candidateTextsOutput: textsOutputPath,
  candidateManifestOutput: manifestOutputPath,
  runtime,
  answerableCases: result.answerableCases,
  candidateCount: result.candidateManifest.candidateCount,
  candidateStrategy: result.candidateManifest.strategy,
  selectionCounts: result.candidateManifest.selectionCounts,
  selectedTierCounts: result.candidateManifest.selectedTierCounts,
  quality: result.comparison.quality,
  qualityByLanguage: result.comparison.qualityByLanguage,
  qualityByCategory: result.comparison.qualityByCategory,
  qualityByChallenge: result.comparison.qualityByChallenge,
  focusCases: result.comparison.focusCases,
  acceptance: result.acceptance,
  noDiacriticsCaseIds: result.noDiacriticsCaseIds,
  note: 'Stress acceptance requires material improvement both overall and after excluding no-diacritics, plus zero new v1 rank-1 regressions.'
}, null, 2))
