#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { calibrateExpandedNoAnswerThreshold } from '../../src/evaluation/expanded-noanswer-threshold.js'

const HARD_V3_THRESHOLD_CORPUS_SHA256 = '0f245ca3921d702fd88322bd34b68763ac8fc48f4ae055be4126a46fe20d6557'
const inputPath = resolve(process.argv[2] ?? process.env.EXPANDED_THRESHOLD_INPUT ?? 'reports/expanded-noanswer-v21-api.json')
const outputPath = resolve(process.env.EXPANDED_THRESHOLD_OUTPUT ?? 'reports/expanded-v21-threshold-calibration.json')

const sourceReport = JSON.parse(await readFile(inputPath, 'utf8'))
const calibration = calibrateExpandedNoAnswerThreshold(sourceReport, {
  expectedCorpusSha256: HARD_V3_THRESHOLD_CORPUS_SHA256,
  currentProductionThreshold: 0.55,
  lowerCandidateThreshold: 0.53
})
const report = { generatedAt: new Date().toISOString(), input: inputPath, ...calibration }

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
    falsePositiveRate: candidate.falsePositiveRate,
    falsePositiveRateWilson95: candidate.falsePositiveRateWilson95,
    falsePositiveIds: candidate.falsePositives.map((item) => item.id),
    falseNegativeIds: candidate.falseNegatives.map((item) => item.id),
    falsePositiveByChallenge: candidate.falsePositiveByChallenge
  })),
  recommendation: report.recommendation,
  note: 'Offline calibration only. No model, collection, query instruction, embedding_text version, or SEARCH_DEFAULT_SCORE_THRESHOLD is changed.'
}, null, 2))
