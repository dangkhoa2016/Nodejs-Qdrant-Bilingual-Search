#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadEntities } from '../../src/dataset/io.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import { collectBenchmarkPreflight } from '../../src/evaluation/benchmark-preflight.js'
import {
  assessPostPromotionApiAcceptance,
  assertCanonicalApiPreflight,
  buildPostPromotionApiAcceptanceReport,
  evaluatePostPromotionApiCases,
  selectPostPromotionAcceptanceCases
} from '../../src/evaluation/post-promotion-api-acceptance.js'

const HARD_V2_CORPUS_SHA256 = '3f0ebee543de7fe93ef3add07fef390e88ab56f03f4b1b57ef71f8588e44bacc'
const EXPECTED_POINTS = 20000
const RESULT_LIMIT = 5

function positiveInteger(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
  return parsed
}

const apiUrl = String(process.env.API_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/$/, '')
if (!apiUrl) throw new TypeError('API_URL is required')
const queryPath = resolve(process.env.POST_PROMOTION_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v2.json')
const datasetPath = resolve(process.env.POST_PROMOTION_DATASET ?? 'data/generated/entities.final.json')
const outputPath = resolve(process.env.POST_PROMOTION_OUTPUT ?? 'reports/post-promotion-v21-api-acceptance.json')
const requestTimeoutMs = positiveInteger(process.env.POST_PROMOTION_REQUEST_TIMEOUT_MS, 180000, 'POST_PROMOTION_REQUEST_TIMEOUT_MS')

const querySource = await readFile(queryPath, 'utf8')
const queryCorpusSha256 = createHash('sha256').update(querySource).digest('hex')
if (queryCorpusSha256 !== HARD_V2_CORPUS_SHA256) {
  throw new Error(`Hard-v2 corpus SHA-256 mismatch: expected ${HARD_V2_CORPUS_SHA256}, got ${queryCorpusSha256}`)
}

const entities = await loadEntities(datasetPath)
if (entities.length !== EXPECTED_POINTS) {
  throw new Error(`canonical dataset count mismatch: expected ${EXPECTED_POINTS}, got ${entities.length}`)
}
const allCases = validateBenchmarkCases(JSON.parse(querySource), entities)
const answerableCount = allCases.filter((item) => item.answerable !== false).length
const noAnswerCount = allCases.filter((item) => item.answerable === false).length
if (allCases.length !== 100 || answerableCount !== 80 || noAnswerCount !== 20) {
  throw new Error(`Hard-v2 corpus shape mismatch: expected 100 total / 80 answerable / 20 no-answer, got ${allCases.length} / ${answerableCount} / ${noAnswerCount}`)
}
const cases = selectPostPromotionAcceptanceCases(allCases)

const preflightRaw = await collectBenchmarkPreflight({
  apiUrl,
  embeddingUrlOverride: process.env.BENCHMARK_EMBEDDING_URL,
  expectedBackend: 'sentence-transformers',
  expectedImplementation: 'python-fastapi'
})
const verifiedPreflight = assertCanonicalApiPreflight(preflightRaw, { expectedPoints: EXPECTED_POINTS })

const rows = await evaluatePostPromotionApiCases(cases, async (item) => {
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
const acceptance = assessPostPromotionApiAcceptance({ preflight: verifiedPreflight, rows })
const generatedAt = new Date().toISOString()
const report = buildPostPromotionApiAcceptanceReport({
  generatedAt,
  apiUrl,
  queryPath,
  datasetPath,
  queryCorpusSha256,
  preflightRaw,
  verifiedPreflight,
  rows,
  acceptance
})
report.requestPolicy.requestTimeoutMs = requestTimeoutMs

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify({
  output: outputPath,
  experiment: report.experiment,
  cases: report.cases,
  canonical: verifiedPreflight,
  requestPolicy: report.requestPolicy,
  sentinelCases: acceptance.sentinelCases,
  knownRank2Cases: acceptance.knownRank2Cases,
  latencyMs: acceptance.latencyMs,
  acceptance: {
    accepted: acceptance.accepted,
    checks: acceptance.checks,
    failures: acceptance.failures
  }
}, null, 2))

if (!acceptance.accepted) process.exitCode = 1
