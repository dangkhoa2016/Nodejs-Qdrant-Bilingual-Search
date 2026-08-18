import test from 'node:test'
import assert from 'node:assert/strict'

const loadModule = async () => import('../../src/evaluation/relation-consistency-verification.js').catch(() => ({}))

const country = (overrides = {}) => ({
  id: 'country:x', score: 0.7, type: 'country',
  name: { en: 'Japan', vi: 'Nhật Bản' },
  continent: 'Asia', region: 'Eastern Asia',
  facts: { capital: 'Tokyo', currency: 'Japanese yen' },
  ...overrides
})

const city = (overrides = {}) => ({
  id: 'city:x', score: 0.66, type: 'city',
  name: { en: 'Tokyo', vi: 'Tokyo' },
  continent: 'Asia', region: 'Tokyo',
  facts: { country: 'Japan', capital: true },
  ...overrides
})

test('extracts high-confidence country, continent, and capital constraints in EN and VI', async () => {
  const { extractStructuredQueryConstraints } = await loadModule()
  assert.equal(typeof extractStructuredQueryConstraints, 'function')
  assert.deepEqual(extractStructuredQueryConstraints('Which European country has Tokyo as its capital and uses the yen?'), {
    entityType: 'country', continent: 'Europe', capital: 'Tokyo'
  })
  assert.deepEqual(extractStructuredQueryConstraints('Quốc gia châu Âu nào có thủ đô Tokyo và sử dụng đồng yên?'), {
    entityType: 'country', continent: 'Europe', capital: 'Tokyo'
  })
  assert.deepEqual(extractStructuredQueryConstraints('Nước nào có Gotham City làm thủ đô quốc gia?'), {
    entityType: 'country', capital: 'Gotham City'
  })
})

test('does not infer country intent from a city question that merely names a country', async () => {
  const { extractStructuredQueryConstraints } = await loadModule()
  const constraints = extractStructuredQueryConstraints('Not the country Thailand; which city is the capital of Thailand?')
  assert.notEqual(constraints.entityType, 'country')
})

test('rejects contradictory geography while retaining the structurally consistent country', async () => {
  const { verifyResultAgainstConstraints } = await loadModule()
  const constraints = { entityType: 'country', continent: 'Europe', capital: 'Tokyo' }
  const rejected = verifyResultAgainstConstraints(country(), constraints)
  assert.equal(rejected.accepted, false)
  assert.ok(rejected.reasons.includes('continent-mismatch'))

  const accepted = verifyResultAgainstConstraints(country({ continent: 'Europe' }), constraints)
  assert.equal(accepted.accepted, true)
})

test('rejects wrong entity type and absent capital facts for plausible-absent queries', async () => {
  const { applyConsistencyVerification } = await loadModule()
  const query = 'Which country has Wakanda City as its capital?'
  const results = [
    city({ name: { en: 'El Wak', vi: null } }),
    country({ id: 'country:senegal', name: { en: 'Senegal', vi: 'Senegal' }, facts: { capital: 'Dakar' } })
  ]
  const verified = applyConsistencyVerification(query, results)
  assert.equal(verified.acceptedResults.length, 0)
  assert.equal(verified.rejectedResults.length, 2)
  assert.deepEqual(verified.constraints, { entityType: 'country', capital: 'Wakanda City' })
})

test('promotes a known rank-2 country when a city distractor violates explicit country intent', async () => {
  const { applyConsistencyVerification } = await loadModule()
  const query = 'Không phải thành phố Luân Đôn; nước nào có thủ đô Luân Đôn và dùng bảng Anh?'
  const results = [
    city({ id: 'london', name: { en: 'London', vi: 'Luân Đôn' }, continent: 'Europe', facts: { country: 'United Kingdom', capital: true } }),
    country({ id: 'uk', name: { en: 'United Kingdom', vi: 'Vương quốc Anh' }, continent: 'Europe', facts: { capital: 'London', currency: 'British pound' } })
  ]
  const verified = applyConsistencyVerification(query, results)
  assert.deepEqual(verified.acceptedResults.map((r) => r.id), ['uk'])
})

test('experiment assessment requires zero answerable regressions and reports targeted negative reductions', async () => {
  const { assessConsistencyExperiment } = await loadModule()
  assert.equal(typeof assessConsistencyExperiment, 'function')
  const rows = [
    { id: 'p1', answerable: true, expectedIds: ['japan'], rawResults: [country({ id: 'japan' })], verifiedResults: [country({ id: 'japan' })], challenge: 'country-factual' },
    { id: 'n1', answerable: false, expectedIds: [], rawResults: [country({ id: 'japan' })], verifiedResults: [], challenge: 'contradictory-geography' },
    { id: 'n2', answerable: false, expectedIds: [], rawResults: [city()], verifiedResults: [], challenge: 'plausible-absent-entity' }
  ]
  const result = assessConsistencyExperiment(rows, { threshold: 0.55 })
  assert.equal(result.accepted, true)
  assert.equal(result.answerableRegressions.length, 0)
  assert.equal(result.falsePositiveComparison.raw, 2)
  assert.equal(result.falsePositiveComparison.verified, 0)
  assert.equal(result.targetedChallenges['contradictory-geography'].rawFalsePositives, 1)
  assert.equal(result.targetedChallenges['plausible-absent-entity'].verifiedFalsePositives, 0)
})

test('high-confidence extraction avoids ambiguous capital fragments and recognizes American continent adjectives', async () => {
  const { extractStructuredQueryConstraints } = await loadModule()
  assert.deepEqual(extractStructuredQueryConstraints('Which country is associated with Bangkok as its national capital and the baht as its money?'), {
    entityType: 'country'
  })
  assert.deepEqual(extractStructuredQueryConstraints('Which South American country has Bangkok as its capital and uses the baht?'), {
    entityType: 'country', continent: 'South America', capital: 'Bangkok'
  })
  assert.deepEqual(extractStructuredQueryConstraints('Which North American country has Hanoi as its capital and uses the dong?'), {
    entityType: 'country', continent: 'North America', capital: 'Hanoi'
  })
})

test('capital comparison accepts a close Vietnamese alias but still rejects an unrelated capital', async () => {
  const { verifyResultAgainstConstraints } = await loadModule()
  assert.equal(verifyResultAgainstConstraints(country({ facts: { capital: 'London' } }), { entityType: 'country', capital: 'Luân Đôn' }).accepted, true)
  const mismatch = verifyResultAgainstConstraints(country({ facts: { capital: 'Washington' } }), { entityType: 'country', capital: 'Hà Nội' })
  assert.equal(mismatch.accepted, false)
  assert.ok(mismatch.reasons.includes('capital-mismatch'))
})
