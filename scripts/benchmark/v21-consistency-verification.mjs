#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadEntities } from '../../src/dataset/io.js'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import { collectBenchmarkPreflight } from '../../src/evaluation/benchmark-preflight.js'
import { assertCanonicalApiPreflight } from '../../src/evaluation/post-promotion-api-acceptance.js'
import { applyConsistencyVerification, assessConsistencyExperiment } from '../../src/evaluation/relation-consistency-verification.js'

const CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'
const EXPECTED_POINTS = 20000
const THRESHOLD = 0.55
const RESULT_LIMIT = 5
const apiUrl = String(process.env.API_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/$/, '')
const queryPath = resolve(process.env.CONSISTENCY_QUERY_CORPUS ?? 'benchmarks/queries/bilingual-hard-v3-threshold.json')
const datasetPath = resolve(process.env.CONSISTENCY_DATASET ?? 'data/generated/entities.final.json')
const outputPath = resolve(process.env.CONSISTENCY_OUTPUT ?? 'reports/v21-consistency-verification.json')
const requestTimeoutMs = Number.parseInt(process.env.CONSISTENCY_REQUEST_TIMEOUT_MS ?? '180000', 10)

const querySource = await readFile(queryPath, 'utf8')
const sha = createHash('sha256').update(querySource).digest('hex')
if (sha !== CORPUS_SHA256) throw new Error(`Hard-v3 corpus SHA-256 mismatch: expected ${CORPUS_SHA256}, got ${sha}`)
const entities = await loadEntities(datasetPath)
if (entities.length !== EXPECTED_POINTS) throw new Error(`canonical dataset count mismatch: expected ${EXPECTED_POINTS}, got ${entities.length}`)
const cases = validateBenchmarkCases(JSON.parse(querySource), entities)
if (cases.length !== 200 || cases.filter((x) => x.answerable !== false).length !== 80 || cases.filter((x) => x.answerable === false).length !== 120) throw new Error('Hard-v3 corpus shape mismatch')

const preflightRaw = await collectBenchmarkPreflight({ apiUrl, embeddingUrlOverride: process.env.BENCHMARK_EMBEDDING_URL, expectedBackend: 'sentence-transformers', expectedImplementation: 'python-fastapi' })
const preflight = assertCanonicalApiPreflight(preflightRaw, { expectedPoints: EXPECTED_POINTS })
if (Number(preflight.productionScoreThreshold) !== THRESHOLD) throw new Error(`production threshold must remain ${THRESHOLD}`)

const rows = []
for (const item of cases) {
  const started = performance.now()
  const response = await fetch(`${apiUrl}/api/v1/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: item.query, language: item.language, limit: RESULT_LIMIT, score_threshold: 0 }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  })
  const body = await response.json()
  if (response.status !== 200 || !Array.isArray(body.results)) throw new Error(`public API request failed for ${item.id}: HTTP ${response.status}`)
  const responseMappingValid = body?.query?.text === item.query
    && body?.query?.language === item.language
    && body?.search?.mode === 'semantic'
    && body?.search?.embedding_model === preflight.embeddingModel
    && Number(body?.search?.vector_dimension) === preflight.embeddingDimension
    && String(body?.search?.distance ?? '').toLowerCase() === 'cosine'
  if (!responseMappingValid) throw new Error(`public API response mapping mismatch for ${item.id}`)
  const rawResults = body.results
  const verification = applyConsistencyVerification(item.query, rawResults)
  rows.push({
    id: item.id, language: item.language, category: item.category, challenge: item.challenge ?? null,
    query: item.query, answerable: item.answerable !== false, expectedIds: item.expected_ids,
    constraints: verification.constraints,
    rawResults,
    verifiedResults: verification.acceptedResults,
    rejectedResults: verification.rejectedResults,
    timingMs: { ...(body.meta?.timing_ms ?? {}), client: Number((performance.now() - started).toFixed(3)) }
  })
}
const assessment = assessConsistencyExperiment(rows, { threshold: THRESHOLD })
const report = {
  generatedAt: new Date().toISOString(), experiment: 'v21_post_retrieval_consistency_verification',
  inputs: { apiUrl, queryPath, datasetPath, queryCorpusSha256: sha },
  policy: { endpoint: 'POST /api/v1/search', retrievalScoreThreshold: 0, evaluatedProductionThreshold: THRESHOLD, resultLimit: RESULT_LIMIT, productionMutation: false },
  preflight: { raw: preflightRaw, verified: preflight }, cases: rows.length, rows, assessment
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ output: outputPath, experiment: report.experiment, corpusSha256: sha, preflight, assessment }, null, 2))
if (!assessment.accepted) process.exitCode = 1
