#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadEntities } from '../../src/dataset/io.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import { collectBenchmarkPreflight } from '../../src/evaluation/benchmark-preflight.js'
import { assertCanonicalApiPreflight } from '../../src/evaluation/post-promotion-api-acceptance.js'
import {
  assessExpandedNoAnswerExecution,
  evaluateExpandedNoAnswerApiCases
} from '../../src/evaluation/expanded-noanswer-threshold.js'

const HARD_V3_THRESHOLD_CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'
const EXPECTED_POINTS = 20000
const RESULT_LIMIT = 5

function positiveInteger(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
  return parsed
}

const apiUrl = String(process.env.API_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/$/, '')
if (!apiUrl) throw new TypeError('API_URL is required')
const queryPath = resolve(process.env.EXPANDED_NOANSWER_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v3-threshold.json')
const datasetPath = resolve(process.env.EXPANDED_NOANSWER_DATASET ?? 'data/generated/entities.final.json')
const outputPath = resolve(process.env.EXPANDED_NOANSWER_OUTPUT ?? 'reports/expanded-noanswer-v21-api.json')
const requestTimeoutMs = positiveInteger(process.env.EXPANDED_NOANSWER_REQUEST_TIMEOUT_MS, 180000, 'EXPANDED_NOANSWER_REQUEST_TIMEOUT_MS')

const querySource = await readFile(queryPath, 'utf8')
const queryCorpusSha256 = createHash('sha256').update(querySource).digest('hex')
if (queryCorpusSha256 !== HARD_V3_THRESHOLD_CORPUS_SHA256) {
  throw new Error(`Hard-v3 threshold corpus SHA-256 mismatch: expected ${HARD_V3_THRESHOLD_CORPUS_SHA256}, got ${queryCorpusSha256}`)
}

const entities = await loadEntities(datasetPath)
if (entities.length !== EXPECTED_POINTS) {
  throw new Error(`canonical dataset count mismatch: expected ${EXPECTED_POINTS}, got ${entities.length}`)
}
const cases = validateBenchmarkCases(JSON.parse(querySource), entities)
const answerableCount = cases.filter((item) => item.answerable !== false).length
const noAnswerCount = cases.filter((item) => item.answerable === false).length
if (cases.length !== 200 || answerableCount !== 80 || noAnswerCount !== 120) {
  throw new Error(`Hard-v3 threshold corpus shape mismatch: expected 200 total / 80 answerable / 120 no-answer, got ${cases.length} / ${answerableCount} / ${noAnswerCount}`)
}

const preflightRaw = await collectBenchmarkPreflight({
  apiUrl,
  embeddingUrlOverride: process.env.BENCHMARK_EMBEDDING_URL,
  expectedBackend: process.env.BENCHMARK_EMBEDDING_BACKEND ?? 'transformers',
  expectedImplementation: 'python-fastapi'
})
const verifiedPreflight = assertCanonicalApiPreflight(preflightRaw, { expectedPoints: EXPECTED_POINTS })

const rows = await evaluateExpandedNoAnswerApiCases(cases, async (item) => {
  const started = performance.now()
  const response = await fetch(`${apiUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: item.query,
      language: item.language,
      limit: RESULT_LIMIT,
      score_threshold: 0
    }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  })
  const body = await response.json()
  return { status: response.status, body, clientElapsedMs: performance.now() - started }
})

const executionAcceptance = assessExpandedNoAnswerExecution({ preflight: verifiedPreflight, rows })
const generatedAt = new Date().toISOString()
const report = {
  generatedAt,
  experiment: 'expanded_noanswer_v21_public_api_benchmark',
  inputs: { apiUrl, queryPath, datasetPath, queryCorpusSha256 },
  requestPolicy: {
    endpoint: 'POST /api/v1/search',
    resultLimit: RESULT_LIMIT,
    rankingScoreThreshold: 0,
    productionScoreThresholdRetained: verifiedPreflight.productionScoreThreshold,
    requestTimeoutMs,
    rationale: 'Collect uncensored top scores through the public Node API. This benchmark never changes the production score threshold.'
  },
  preflight: { raw: preflightRaw, verified: verifiedPreflight },
  cases: cases.length,
  answerableCases: answerableCount,
  noAnswerCases: noAnswerCount,
  rows,
  executionAcceptance
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify({
  output: outputPath,
  experiment: report.experiment,
  corpusSha256: queryCorpusSha256,
  cases: report.cases,
  answerableCases: report.answerableCases,
  noAnswerCases: report.noAnswerCases,
  canonical: verifiedPreflight,
  requestPolicy: report.requestPolicy,
  answerableQuality: executionAcceptance.answerableQuality,
  knownRank2Cases: executionAcceptance.knownRank2Cases,
  latencyMs: executionAcceptance.latencyMs,
  executionAcceptance: {
    accepted: executionAcceptance.accepted,
    checks: executionAcceptance.checks,
    failures: executionAcceptance.failures
  }
}, null, 2))

if (!executionAcceptance.accepted) process.exitCode = 1
