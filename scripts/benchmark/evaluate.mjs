#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateBenchmarkCases } from '../../src/evaluation/benchmark-corpus.js'
import { collectBenchmarkPreflight } from '../../src/evaluation/benchmark-preflight.js'
import { evaluateQueryCases } from '../../src/evaluation/metrics.js'

const queryPath = resolve(process.argv[2] ?? 'benchmarks/queries/bilingual.json')
const datasetPath = resolve(process.env.BENCHMARK_DATASET ?? 'data/generated/entities.final.json')
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const rawCases = JSON.parse(await readFile(queryPath, 'utf8'))
const entities = JSON.parse(await readFile(datasetPath, 'utf8'))
const cases = validateBenchmarkCases(rawCases, entities)
const preflight = await collectBenchmarkPreflight({
  apiUrl,
  embeddingUrlOverride: process.env.BENCHMARK_EMBEDDING_URL,
  expectedBackend: process.env.BENCHMARK_EMBEDDING_BACKEND ?? 'sentence-transformers',
  expectedImplementation: process.env.BENCHMARK_EMBEDDING_IMPLEMENTATION ?? 'python-fastapi'
})

const configuredDecisionThreshold = Number(process.env.BENCHMARK_DECISION_THRESHOLD ?? preflight.info?.config?.searchDefaultScoreThreshold)
const decisionThreshold = Number.isFinite(configuredDecisionThreshold) ? configuredDecisionThreshold : null

const report = await evaluateQueryCases(cases, async (item) => {
  const response = await fetch(`${apiUrl}/api/v1/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: item.query, language: item.language, limit: 5, score_threshold: 0 })
  })
  if (!response.ok) throw new Error(`search failed for ${item.id}: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}, { decisionThreshold })

const stamp = new Date().toISOString().replaceAll(/[-:.]/g, '').replace('Z', 'Z')
const output = resolve(process.env.BENCHMARK_OUTPUT ?? `reports/benchmark-${stamp}.json`)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), apiUrl, queryPath, datasetPath, preflight, ...report }, null, 2)}\n`)
console.log(JSON.stringify({
  output,
  cases: report.cases,
  preflight: {
    collection: preflight.info?.config?.qdrantCollection ?? null,
    points: preflight.stats?.points_count ?? preflight.stats?.pointsCount ?? null,
    embedding: {
      model: preflight.embedding?.model ?? null,
      dimension: preflight.embedding?.dimension ?? null,
      backend: preflight.embedding?.backend ?? null,
      implementation: preflight.embedding?.implementation ?? null,
      semantic: preflight.embedding?.semantic === true
    }
  },
  answerableCases: report.answerableCases,
  noAnswerCases: report.noAnswerCases,
  quality: report.quality,
  qualityByLanguage: report.qualityByLanguage,
  qualityByCategory: report.qualityByCategory,
  qualityByChallenge: report.qualityByChallenge,
  qualityByLanguageAndCategory: report.qualityByLanguageAndCategory,
  rankingMargins: report.rankingMargins,
  decisionQuality: report.decisionQuality,
  latencyMs: report.latencyMs,
  latencyMsByComponent: report.latencyMsByComponent
}, null, 2))
