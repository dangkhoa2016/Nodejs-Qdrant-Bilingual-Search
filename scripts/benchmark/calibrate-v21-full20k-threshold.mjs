#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { calibrateFull20kV21Threshold } from '../../src/evaluation/full20k-v21-threshold-calibration.js'

const inputPath = resolve(
  process.argv[2] ??
  process.env.FULL20K_V21_THRESHOLD_INPUT ??
  'reports/qwen3-4b-text-v1-v21-full20k-collection-ab.json'
)
const outputPath = resolve(
  process.env.FULL20K_V21_THRESHOLD_OUTPUT ??
  'reports/qwen3-4b-text-v21-full20k-threshold-calibration.json'
)

const sourceReport = JSON.parse(await readFile(inputPath, 'utf8'))
const calibration = calibrateFull20kV21Threshold(sourceReport, { currentProductionThreshold: 0.55 })
const report = {
  generatedAt: new Date().toISOString(),
  input: inputPath,
  ...calibration
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify({
  output: outputPath,
  experiment: report.experiment,
  sourceCollection: report.sourceCollection,
  cases: report.cases,
  answerableCases: report.answerableCases,
  noAnswerCases: report.noAnswerCases,
  scoreDistribution: report.scoreDistribution,
  candidates: report.candidates.map((candidate) => ({
    threshold: candidate.threshold,
    answerability: candidate.answerability,
    answerableTop1Accuracy: candidate.answerableTop1Accuracy,
    noAnswerAccuracy: candidate.noAnswerAccuracy,
    decisionAccuracy: candidate.decisionAccuracy,
    falsePositiveIds: candidate.falsePositives.map((item) => item.id),
    falseNegativeIds: candidate.falseNegatives.map((item) => item.id),
    answerableHeadroom: candidate.answerableHeadroom,
    noAnswerHeadroom: candidate.noAnswerHeadroom,
    guardBand: candidate.guardBand
  })),
  semanticTop1ErrorIds: report.semanticTop1Errors.map((item) => item.id),
  existingFrameworkRecommendedThreshold: report.existingFrameworkRecommendedThreshold,
  recommendation: report.recommendation,
  note: 'Calibration is evidence only. This command never changes SEARCH_DEFAULT_SCORE_THRESHOLD or promotes a collection.'
}, null, 2))
