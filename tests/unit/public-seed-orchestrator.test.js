import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicSeedOrchestrator, countTranslationCandidates } from '../../src/seed/public-seed-orchestrator.js'

const baseEntities = [
  { id: 'Q1', description: { en: 'one', vi: null }, name: { en: 'One', vi: 'Một' } },
  { id: 'Q2', description: { en: 'two', vi: 'hai' }, name: { en: 'Two', vi: null } },
  { id: 'Q3', description: { en: null, vi: null }, name: { en: 'Three', vi: null } }
]

test('countTranslationCandidates counts only missing target text with English source', () => {
  assert.equal(countTranslationCandidates(baseEntities, ['description']), 1)
  assert.equal(countTranslationCandidates(baseEntities, ['description', 'name']), 3)
})

test('dry-run builds real source dataset but never creates cloud translator or touches Qdrant', async () => {
  const calls = []
  const orchestrator = new PublicSeedOrchestrator({
    buildDataset: async () => { calls.push('build'); return { entities: baseEntities, manifest: { mergedCount: 3 } } },
    createTranslator: async () => { calls.push('translator'); throw new Error('must not happen') },
    translateEntities: async () => { calls.push('translate'); throw new Error('must not happen') },
    seedEntities: async () => { calls.push('seed'); throw new Error('must not happen') },
    clock: () => new Date('2026-08-21T03:30:00.000Z')
  })
  const result = await orchestrator.run({
    buildOptions: {}, translation: { provider: 'groq', fields: ['description'] }, dryRun: true
  })
  assert.deepEqual(calls, ['build'])
  assert.equal(result.dryRun, true)
  assert.equal(result.plan.entities, 3)
  assert.equal(result.plan.translationCandidates, 1)
  assert.equal(result.plan.translationProvider, 'groq')
  assert.equal(result.seed, null)
})

test('normal run lazily creates selected translator enriches entities and seeds final dataset', async () => {
  const calls = []
  const orchestrator = new PublicSeedOrchestrator({
    buildDataset: async () => ({ entities: baseEntities, manifest: { mergedCount: 3 } }),
    createTranslator: async ({ provider }) => { calls.push(`create:${provider}`); return { provider } },
    translateEntities: async (entities, { translator, fields }) => {
      calls.push(`translate:${translator.provider}:${fields.join(',')}`)
      return entities.map((item) => item.id === 'Q1' ? { ...item, description: { ...item.description, vi: 'một' } } : item)
    },
    seedEntities: async (entities) => { calls.push(`seed:${entities.length}`); return { upserted: entities.length, batches: 1 } }
  })
  const result = await orchestrator.run({
    buildOptions: {}, translation: { provider: 'nvidia', fields: ['description'] }, dryRun: false
  })
  assert.deepEqual(calls, ['create:nvidia', 'translate:nvidia:description', 'seed:3'])
  assert.equal(result.entities[0].description.vi, 'một')
  assert.deepEqual(result.seed, { upserted: 3, batches: 1 })
})

test('provider none skips translator creation but still seeds built dataset', async () => {
  let translatorCreated = false
  const orchestrator = new PublicSeedOrchestrator({
    buildDataset: async () => ({ entities: baseEntities, manifest: {} }),
    createTranslator: async () => { translatorCreated = true },
    translateEntities: async () => { throw new Error('must not translate') },
    seedEntities: async (entities) => ({ upserted: entities.length })
  })
  const result = await orchestrator.run({ buildOptions: {}, translation: { provider: 'none', fields: ['description'] } })
  assert.equal(translatorCreated, false)
  assert.equal(result.seed.upserted, 3)
})

test('normal run performs infrastructure preflight before dataset build', async () => {
  const calls = []
  const orchestrator = new PublicSeedOrchestrator({
    preflightInfrastructure: async () => { calls.push('preflight') },
    buildDataset: async () => { calls.push('build'); return { entities: baseEntities, manifest: {} } },
    createTranslator: async () => { throw new Error('must not translate') },
    translateEntities: async () => { throw new Error('must not translate') },
    seedEntities: async (entities) => { calls.push(`seed:${entities.length}`); return { upserted: entities.length } }
  })
  await orchestrator.run({ buildOptions: {}, translation: { provider: 'none', fields: ['description'] }, dryRun: false })
  assert.deepEqual(calls, ['preflight', 'build', 'seed:3'])
})

test('infrastructure preflight failure aborts before expensive dataset build', async () => {
  let buildCalls = 0
  const orchestrator = new PublicSeedOrchestrator({
    preflightInfrastructure: async () => { throw new Error('Qdrant schema incompatible') },
    buildDataset: async () => { buildCalls += 1; return { entities: baseEntities, manifest: {} } },
    createTranslator: async () => ({}),
    translateEntities: async (entities) => entities,
    seedEntities: async () => ({})
  })
  await assert.rejects(
    () => orchestrator.run({ buildOptions: {}, translation: { provider: 'none', fields: ['description'] }, dryRun: false }),
    /Qdrant schema incompatible/
  )
  assert.equal(buildCalls, 0)
})

test('dry-run skips infrastructure preflight so dataset build remains offline from runtime services', async () => {
  const calls = []
  const orchestrator = new PublicSeedOrchestrator({
    preflightInfrastructure: async () => { calls.push('preflight'); throw new Error('must not happen') },
    buildDataset: async () => { calls.push('build'); return { entities: baseEntities, manifest: {} } },
    createTranslator: async () => { throw new Error('must not happen') },
    translateEntities: async () => { throw new Error('must not happen') },
    seedEntities: async () => { throw new Error('must not happen') }
  })
  const result = await orchestrator.run({ buildOptions: {}, translation: { provider: 'none', fields: ['description'] }, dryRun: true })
  assert.deepEqual(calls, ['build'])
  assert.equal(result.dryRun, true)
})
