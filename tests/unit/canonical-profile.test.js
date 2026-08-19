import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadConfig } from '../../src/config.js'
import { assertCanonicalRuntimeConfig, CANONICAL_QWEN_PROFILE } from '../../src/canonical-profile.js'

const repoFile = (path) => new URL(`../../${path}`, import.meta.url)

test('canonical runtime guard accepts only the promoted Qwen v2.1 defaults and keeps threshold at 0.55', () => {
  const config = loadConfig({})
  assert.equal(CANONICAL_QWEN_PROFILE.searchDefaultScoreThreshold, 0.55)
  assert.doesNotThrow(() => assertCanonicalRuntimeConfig(config))

  const rollback = loadConfig({
    QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
    EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
    EMBEDDING_DIMENSION: '2560',
    EMBEDDING_TEXT_VERSION: 'v1'
  })
  assert.throws(() => assertCanonicalRuntimeConfig(rollback), /canonical runtime config mismatch/i)

  const staleTimeout = { ...config, embeddingTimeoutMs: 15_000 }
  assert.throws(() => assertCanonicalRuntimeConfig(staleTimeout), /embeddingTimeoutMs=15000/)
})

test('package exposes a fail-closed canonical config verification command', async () => {
  const pkg = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))
  assert.equal(pkg.scripts['verify:canonical-config'], 'NODE_ENV=development node scripts/verify/canonical-config.mjs')
  const source = await readFile(repoFile('scripts/verify/canonical-config.mjs'), 'utf8')
  assert.match(source, /assertCanonicalRuntimeConfig/)
  assert.match(source, /canonical:\s*true/)
})

test('canonical runtime requires consistency verification enabled at multiplier 5', () => {
  const config = loadConfig({})
  assert.equal(CANONICAL_QWEN_PROFILE.searchConsistencyVerificationEnabled, true)
  assert.equal(CANONICAL_QWEN_PROFILE.searchConsistencyCandidateMultiplier, 5)
  assert.doesNotThrow(() => assertCanonicalRuntimeConfig(config))
  assert.throws(
    () => assertCanonicalRuntimeConfig({ ...config, searchConsistencyVerificationEnabled: false }),
    /searchConsistencyVerificationEnabled=false/
  )
  assert.throws(
    () => assertCanonicalRuntimeConfig({ ...config, searchConsistencyCandidateMultiplier: 1 }),
    /searchConsistencyCandidateMultiplier=1/
  )
})

test('canonical runtime requires the domain/entity-intent gate enabled', () => {
  const config = loadConfig({})
  assert.equal(CANONICAL_QWEN_PROFILE.searchDomainEntityIntentGateEnabled, true)
  assert.doesNotThrow(() => assertCanonicalRuntimeConfig(config))
  assert.throws(
    () => assertCanonicalRuntimeConfig({ ...config, searchDomainEntityIntentGateEnabled: false }),
    /searchDomainEntityIntentGateEnabled=false/
  )
})
