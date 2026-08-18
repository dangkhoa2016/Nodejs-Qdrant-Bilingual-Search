import test from 'node:test'
import assert from 'node:assert/strict'

const loadModule = async () => import('../../src/search/domain-entity-intent-gate.js').catch(() => ({}))

const city = (overrides = {}) => ({
  id: 'city:casablanca', score: 0.62, type: 'city',
  name: { en: 'Casablanca', vi: 'Casablanca' },
  ...overrides
})

const country = (overrides = {}) => ({
  id: 'country:x', score: 0.70, type: 'country',
  name: { en: 'Example', vi: 'Ví dụ' },
  ...overrides
})

test('infers high-confidence media-work intent in EN and VI without hard-coding entity names', async () => {
  const { inferHighConfidenceNonGeographicIntent } = await loadModule()
  assert.equal(typeof inferHighConfidenceNonGeographicIntent, 'function')
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('What is the plot of the movie Casablanca?'), {
    domain: 'media-work', reason: 'media-content-intent'
  })
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('Nội dung phim Casablanca nói về điều gì?'), {
    domain: 'media-work', reason: 'media-content-intent'
  })
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('What is the plot of the movie Metropolis?'), {
    domain: 'media-work', reason: 'media-content-intent'
  })
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('What is the plot of the movie City of God?'), {
    domain: 'media-work', reason: 'media-content-intent'
  })
})

test('infers high-confidence sports-club achievement intent in EN and VI without hard-coding club names', async () => {
  const { inferHighConfidenceNonGeographicIntent } = await loadModule()
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('What trophies has Chelsea Football Club won?'), {
    domain: 'sports-club', reason: 'sports-club-achievement-intent'
  })
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('Chelsea Football Club đã giành những danh hiệu nào?'), {
    domain: 'sports-club', reason: 'sports-club-achievement-intent'
  })
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('What titles has River Plate Football Club won?'), {
    domain: 'sports-club', reason: 'sports-club-achievement-intent'
  })
  assert.deepEqual(inferHighConfidenceNonGeographicIntent('What trophies has Manchester City Football Club won?'), {
    domain: 'sports-club', reason: 'sports-club-achievement-intent'
  })
})

test('stays conservative for geographic questions and weak domain mentions', async () => {
  const { inferHighConfidenceNonGeographicIntent } = await loadModule()
  for (const query of [
    'Where is Casablanca located?',
    'Which city is home to Chelsea Football Club?',
    'Which country hosted the movie festival?',
    'football cities in Europe',
    'Casablanca city population'
  ]) {
    assert.equal(inferHighConfidenceNonGeographicIntent(query), null, query)
  }
})

test('rejects only geographic results for a proven non-geographic intent', async () => {
  const { applyDomainEntityIntentGate } = await loadModule()
  const gated = applyDomainEntityIntentGate('What is the plot of the movie Casablanca?', [
    city(),
    country(),
    { id: 'film:1', score: 0.61, type: 'film', name: { en: 'Casablanca', vi: null } },
    { id: 'unknown:1', score: 0.60, type: null, name: { en: 'Unknown', vi: null } }
  ])
  assert.deepEqual(gated.acceptedResults.map((row) => row.id), ['film:1', 'unknown:1'])
  assert.equal(gated.rejectedResults.length, 2)
  assert.ok(gated.rejectedResults.every((row) => row.domain_intent_rejection_reasons.includes('geographic-entity-for-nongeographic-intent')))
  assert.deepEqual(gated.intent, { domain: 'media-work', reason: 'media-content-intent' })
})

test('does nothing when no high-confidence non-geographic intent is found', async () => {
  const { applyDomainEntityIntentGate } = await loadModule()
  const results = [city(), country()]
  const gated = applyDomainEntityIntentGate('Which city is the capital of Thailand?', results)
  assert.equal(gated.intent, null)
  assert.deepEqual(gated.acceptedResults, results)
  assert.deepEqual(gated.rejectedResults, [])
})
