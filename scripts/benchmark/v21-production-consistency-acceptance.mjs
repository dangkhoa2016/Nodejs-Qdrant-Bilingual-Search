#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadEntities } from '../../src/dataset/io.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import { collectBenchmarkPreflight } from '../../src/evaluation/benchmark-preflight.js'
import { assertCanonicalApiPreflight } from '../../src/evaluation/post-promotion-api-acceptance.js'
import {
  assessProductionConsistencyAcceptance,
  evaluateProductionConsistencyApiCases
} from '../../src/evaluation/production-consistency-acceptance.js'

const CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'
const EXPECTED_POINTS = 20000
const RESULT_LIMIT = 5
const apiUrl = String(process.env.API_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/$/, '')
const queryPath = resolve(process.env.PRODUCTION_CONSISTENCY_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v3-threshold.json')
const datasetPath = resolve(process.env.PRODUCTION_CONSISTENCY_DATASET ?? 'data/generated/entities.final.json')
const outputPath = resolve(process.env.PRODUCTION_CONSISTENCY_OUTPUT ?? 'reports/v21-production-consistency-acceptance.json')
const requestTimeoutMs = Number.parseInt(process.env.PRODUCTION_CONSISTENCY_REQUEST_TIMEOUT_MS ?? '180000', 10)
if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('PRODUCTION_CONSISTENCY_REQUEST_TIMEOUT_MS must be a positive integer')

const querySource = await readFile(queryPath, 'utf8')
const queryCorpusSha256 = createHash('sha256').update(querySource).digest('hex')
if (queryCorpusSha256 !== CORPUS_SHA256) throw new Error(`Hard-v3 corpus SHA-256 mismatch: expected ${CORPUS_SHA256}, got ${queryCorpusSha256}`)

const entities = await loadEntities(datasetPath)
if (entities.length !== EXPECTED_POINTS) throw new Error(`canonical dataset count mismatch: expected ${EXPECTED_POINTS}, got ${entities.length}`)
const cases = validateBenchmarkCases(JSON.parse(querySource), entities)
const answerableCases = cases.filter((item) => item.answerable !== false).length
const noAnswerCases = cases.filter((item) => item.answerable === false).length
if (cases.length !== 200 || answerableCases !== 80 || noAnswerCases !== 120) {
  throw new Error(`Hard-v3 corpus shape mismatch: expected 200 / 80 / 120, got ${cases.length} / ${answerableCases} / ${noAnswerCases}`)
}

const preflightRaw = await collectBenchmarkPreflight({
  apiUrl,
  embeddingUrlOverride: process.env.BENCHMARK_EMBEDDING_URL,
  expectedBackend: process.env.BENCHMARK_EMBEDDING_BACKEND ?? 'transformers',
  expectedImplementation: 'python-fastapi'
})
const preflight = assertCanonicalApiPreflight(preflightRaw, { expectedPoints: EXPECTED_POINTS })

const rows = await evaluateProductionConsistencyApiCases(cases, async (item) => {
  const started = performance.now()
  const response = await fetch(`${apiUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: item.query,
      language: item.language,
      limit: RESULT_LIMIT
    }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  })
  const body = await response.json()
  return { status: response.status, body, clientElapsedMs: performance.now() - started }
})

const acceptance = assessProductionConsistencyAcceptance({ preflight, rows })
const report = {
  generatedAt: new Date().toISOString(),
  experiment: 'v21_production_consistency_public_api_acceptance',
  inputs: { apiUrl, queryPath, datasetPath, queryCorpusSha256 },
  requestPolicy: {
    endpoint: 'POST /api/v1/search',
    resultLimit: RESULT_LIMIT,
    scoreThresholdOverride: null,
    productionScoreThreshold: preflight.productionScoreThreshold,
    consistencyVerificationEnabled: preflight.searchConsistencyVerificationEnabled,
    consistencyCandidateMultiplier: preflight.searchConsistencyCandidateMultiplier,
    requestTimeoutMs,
    rationale: 'Exercise the production API exactly at its canonical default threshold. score_threshold is intentionally omitted so the live 0.55 policy and production consistency verifier are tested together.'
  },
  preflight: { raw: preflightRaw, verified: preflight },
  cases: cases.length,
  answerableCases,
  noAnswerCases,
  rows,
  acceptance
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  output: outputPath,
  experiment: report.experiment,
  corpusSha256: queryCorpusSha256,
  preflight,
  requestPolicy: report.requestPolicy,
  answerableQuality: acceptance.answerableQuality,
  falsePositives: acceptance.falsePositives,
  knownRemainingRank2Cases: acceptance.knownRemainingRank2Cases,
  latencyMs: acceptance.latencyMs,
  acceptance: { accepted: acceptance.accepted, checks: acceptance.checks, failures: acceptance.failures }
}, null, 2))

if (!acceptance.accepted) process.exitCode = 1
