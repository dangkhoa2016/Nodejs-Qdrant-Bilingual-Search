#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { normalizeEntity } from '../../src/domain/entity.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import {
  FOCUSED_AB_RUNTIME,
  assertFocusedAbRuntime,
  runFocusedTextV21AbExperiment
} from '../../src/evaluation/focused-text-ab-runner.js'

function positiveInteger(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
  return parsed
}

const queryPath = resolve(process.env.FOCUSED_AB_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v2.json')
const datasetPath = resolve(process.env.FOCUSED_AB_DATASET ?? 'data/generated/entities.final.json')
const hardReportPath = resolve(process.env.FOCUSED_AB_HARD_REPORT ?? 'reports/qwen3-4b-v1-20k-hard-v2.json')
const outputPath = resolve(process.env.FOCUSED_AB_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-focused-ab.json')
const textsOutputPath = resolve(process.env.FOCUSED_AB_TEXTS_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-focused-candidate-texts.json')
const manifestOutputPath = resolve(process.env.FOCUSED_AB_MANIFEST_OUTPUT ?? 'reports/qwen3-4b-text-v1-v21-focused-candidate-manifest.json')
const embeddingUrl = (process.env.EMBEDDING_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '')
const targetSize = positiveInteger(process.env.FOCUSED_AB_TARGET_SIZE, 75, 'FOCUSED_AB_TARGET_SIZE')
const maxSize = positiveInteger(process.env.FOCUSED_AB_MAX_SIZE, 150, 'FOCUSED_AB_MAX_SIZE')
const batchSize = positiveInteger(process.env.FOCUSED_AB_BATCH_SIZE, 128, 'FOCUSED_AB_BATCH_SIZE')
if (targetSize > maxSize) throw new RangeError('FOCUSED_AB_TARGET_SIZE must be <= FOCUSED_AB_MAX_SIZE')
if (maxSize > 150) throw new RangeError('FOCUSED_AB_MAX_SIZE must be <= 150 for the focused experiment')
if (batchSize > 256) throw new RangeError('FOCUSED_AB_BATCH_SIZE must be <= 256')

const rawEntities = JSON.parse(await readFile(datasetPath, 'utf8'))
const entities = rawEntities.map(normalizeEntity)
const rawCases = JSON.parse(await readFile(queryPath, 'utf8'))
const cases = validateBenchmarkCases(rawCases, entities)
const hardReport = JSON.parse(await readFile(hardReportPath, 'utf8'))

const provider = new HttpEmbeddingProvider({
  baseUrl: embeddingUrl,
  model: FOCUSED_AB_RUNTIME.model,
  dimension: FOCUSED_AB_RUNTIME.dimension,
  transport: process.env.EMBEDDING_TRANSPORT ?? 'binary-f32',
  timeoutMs: positiveInteger(process.env.EMBEDDING_TIMEOUT_MS, 120000, 'EMBEDDING_TIMEOUT_MS')
})
const runtime = assertFocusedAbRuntime(await provider.assertCompatible())

const result = await runFocusedTextV21AbExperiment({
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
  model: FOCUSED_AB_RUNTIME.model,
  dimension: FOCUSED_AB_RUNTIME.dimension,
  queryInstructionId: FOCUSED_AB_RUNTIME.queryInstructionId,
  queryStrategy: FOCUSED_AB_RUNTIME.queryStrategy,
  documentStrategy: FOCUSED_AB_RUNTIME.documentStrategy,
  device: FOCUSED_AB_RUNTIME.device,
  dtype: FOCUSED_AB_RUNTIME.dtype,
  queryCorpus: queryPath,
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
  hypothesis: 'v2.1 keeps explicit type/relation semantics while making country-capital wording self-oriented to reduce country-overbias on capital-city queries.',
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
  quality: result.comparison.quality,
  qualityByLanguage: result.comparison.qualityByLanguage,
  qualityByCategory: result.comparison.qualityByCategory,
  qualityByChallenge: result.comparison.qualityByChallenge,
  focusCases: result.comparison.focusCases,
  acceptance: result.acceptance,
  noDiacriticsCaseIds: result.noDiacriticsCaseIds,
  note: 'No-diacritics remains separately reported; v2.1 acceptance also requires zero new v1 rank-1 regressions.'
}, null, 2))
