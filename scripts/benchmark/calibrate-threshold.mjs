#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { calibrateThresholds } from '../../src/evaluation/threshold-calibration.js'

const inputArg = process.argv[2]
if (!inputArg) {
  console.error('usage: npm run benchmark:calibrate-threshold -- <benchmark-report.json>')
  process.exit(2)
}

const input = resolve(inputArg)
const report = JSON.parse(await readFile(input, 'utf8'))
if (!Array.isArray(report.rows)) throw new TypeError('benchmark report must contain rows')

const calibration = calibrateThresholds(report.rows)
const output = resolve(process.env.THRESHOLD_OUTPUT ?? input.replace(/\.json$/i, '') + '-threshold-calibration.json')
const result = {
  generatedAt: new Date().toISOString(),
  input,
  sourceBenchmark: {
    queryPath: report.queryPath ?? null,
    collection: report.preflight?.info?.config?.qdrantCollection ?? null,
    embeddingModel: report.preflight?.embedding?.model ?? null,
    cases: report.cases ?? report.rows.length
  },
  ...calibration
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({
  output,
  cases: result.cases,
  answerableCases: result.answerableCases,
  noAnswerCases: result.noAnswerCases,
  recommended: result.recommended
}, null, 2))
