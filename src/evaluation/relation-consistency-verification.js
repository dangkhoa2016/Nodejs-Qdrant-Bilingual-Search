import {
  applyConsistencyVerification,
  extractStructuredQueryConstraints,
  verifyResultAgainstConstraints
} from '../search/relation-consistency-verifier.js'

export {
  applyConsistencyVerification,
  extractStructuredQueryConstraints,
  verifyResultAgainstConstraints
}

function expectedRank(results, expectedIds) {
  const expected = new Set(expectedIds ?? [])
  const index = (results ?? []).findIndex((result) => expected.has(result?.id))
  return index < 0 ? null : index + 1
}

function hasThresholdResult(results, threshold) {
  return (results ?? []).some((result) => Number.isFinite(result?.score) && result.score >= threshold)
}

export function assessConsistencyExperiment(rows, { threshold = 0.55 } = {}) {
  const answerableRows = rows.filter((row) => row.answerable !== false)
  const noAnswerRows = rows.filter((row) => row.answerable === false)
  const answerableRegressions = []
  for (const row of answerableRows) {
    const rawRank = expectedRank(row.rawResults, row.expectedIds)
    const verifiedRank = expectedRank(row.verifiedResults, row.expectedIds)
    if (rawRank != null && (verifiedRank == null || verifiedRank > rawRank)) {
      answerableRegressions.push({ id: row.id, rawRank, verifiedRank })
    }
  }

  const answerableThresholdMisses = answerableRows.filter((row) => {
    const expected = new Set(row.expectedIds ?? [])
    return !(row.verifiedResults ?? []).some((result) => expected.has(result?.id) && Number.isFinite(result?.score) && result.score >= threshold)
  }).map((row) => ({ id: row.id, challenge: row.challenge ?? null }))
  const rawFp = noAnswerRows.filter((row) => hasThresholdResult(row.rawResults, threshold)).length
  const verifiedFp = noAnswerRows.filter((row) => hasThresholdResult(row.verifiedResults, threshold)).length
  const targetedChallenges = {}
  for (const challenge of ['contradictory-geography', 'plausible-absent-entity']) {
    const group = noAnswerRows.filter((row) => row.challenge === challenge)
    targetedChallenges[challenge] = {
      cases: group.length,
      rawFalsePositives: group.filter((row) => hasThresholdResult(row.rawResults, threshold)).length,
      verifiedFalsePositives: group.filter((row) => hasThresholdResult(row.verifiedResults, threshold)).length
    }
  }

  const contradiction = targetedChallenges['contradictory-geography']
  const absent = targetedChallenges['plausible-absent-entity']
  const targetedImproved = contradiction.verifiedFalsePositives < contradiction.rawFalsePositives && absent.verifiedFalsePositives <= absent.rawFalsePositives
  return {
    accepted: answerableRegressions.length === 0 && answerableThresholdMisses.length === 0 && verifiedFp < rawFp && targetedImproved,
    threshold,
    answerableCases: answerableRows.length,
    noAnswerCases: noAnswerRows.length,
    answerableRegressions,
    answerableThresholdMisses,
    falsePositiveComparison: { raw: rawFp, verified: verifiedFp, delta: verifiedFp - rawFp },
    targetedChallenges,
    checks: {
      zeroAnswerableRankRegressions: answerableRegressions.length === 0,
      zeroAnswerableThresholdMisses: answerableThresholdMisses.length === 0,
      overallFalsePositivesReduced: verifiedFp < rawFp,
      contradictoryGeographyImproved: contradiction.verifiedFalsePositives < contradiction.rawFalsePositives,
      plausibleAbsentNotWorse: absent.verifiedFalsePositives <= absent.rawFalsePositives
    }
  }
}
