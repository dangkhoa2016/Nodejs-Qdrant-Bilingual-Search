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
import {
  assessDomainEntityIntentExperiment,
  evaluateDomainEntityIntentRows
} from '../../src/evaluation/domain-entity-intent-experiment.js'

const CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'
const EXPECTED_POINTS = 20000
const RESULT_LIMIT = 5
const apiUrl = String(process.env.API_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/$/, '')
const queryPath = resolve(process.env.DOMAIN_ENTITY_INTENT_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v3-threshold.json')
const datasetPath = resolve(process.env.DOMAIN_ENTITY_INTENT_DATASET ?? 'data/generated/entities.final.json')
const outputPath = resolve(process.env.DOMAIN_ENTITY_INTENT_OUTPUT ?? 'reports/v21-domain-entity-intent-experiment.json')
const requestTimeoutMs = Number.parseInt(process.env.DOMAIN_ENTITY_INTENT_REQUEST_TIMEOUT_MS ?? '180000', 10)
if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('DOMAIN_ENTITY_INTENT_REQUEST_TIMEOUT_MS must be a positive integer')

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
  expectedBackend: 'sentence-transformers',
  expectedImplementation: 'python-fastapi'
})
const preflight = assertCanonicalApiPreflight(preflightRaw, { expectedPoints: EXPECTED_POINTS })

const productionRows = await evaluateProductionConsistencyApiCases(cases, async (item) => {
  const started = performance.now()
  const response = await fetch(`${apiUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: item.query, language: item.language, limit: RESULT_LIMIT }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  })
  const body = await response.json()
  return { status: response.status, body, clientElapsedMs: performance.now() - started }
})

const productionAcceptance = assessProductionConsistencyAcceptance({ preflight, rows: productionRows })
const experimentRows = evaluateDomainEntityIntentRows(productionRows)
const experiment = assessDomainEntityIntentExperiment(experimentRows)
const accepted = productionAcceptance.accepted && experiment.accepted

const report = {
  generatedAt: new Date().toISOString(),
  experiment: 'v21_domain_entity_intent_gate_experiment',
  productionMutation: false,
  inputs: { apiUrl, queryPath, datasetPath, queryCorpusSha256 },
  requestPolicy: {
    endpoint: 'POST /api/v1/search',
    resultLimit: RESULT_LIMIT,
    scoreThresholdOverride: null,
    productionScoreThreshold: preflight.productionScoreThreshold,
    productionConsistencyVerificationEnabled: preflight.searchConsistencyVerificationEnabled,
    requestTimeoutMs,
    rationale: 'Use the already-productionized v2.1 + structured consistency response at its canonical 0.55 threshold, then apply a local read-only high-confidence non-geographic intent gate to measure only the three residual collision cases without mutating /api/v1/search.'
  },
  preflight: { raw: preflightRaw, verified: preflight },
  cases: cases.length,
  answerableCases,
  noAnswerCases,
  productionRows,
  productionAcceptance,
  experimentRows,
  experiment,
  acceptance: {
    accepted,
    checks: {
      productionBaselineAccepted: productionAcceptance.accepted,
      domainEntityIntentExperimentAccepted: experiment.accepted,
      productionMutation: false
    },
    failures: [
      ...productionAcceptance.failures.map((failure) => ({ stage: 'production-baseline', ...failure })),
      ...experiment.failures.map((failure) => ({ stage: 'domain-entity-intent', ...failure }))
    ]
  }
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  output: outputPath,
  experiment: report.experiment,
  productionMutation: false,
  corpusSha256: queryCorpusSha256,
  preflight,
  productionBaseline: {
    accepted: productionAcceptance.accepted,
    answerableQuality: productionAcceptance.answerableQuality,
    falsePositives: productionAcceptance.falsePositives
  },
  domainEntityIntent: experiment,
  acceptance: report.acceptance
}, null, 2))

if (!accepted) process.exitCode = 1
