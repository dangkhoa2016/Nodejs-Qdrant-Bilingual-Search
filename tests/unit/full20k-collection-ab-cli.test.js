import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const loadScript = async () => readFile(new URL('../../scripts/benchmark/full20k-v21-collection-ab.mjs', import.meta.url), 'utf8').catch(() => '')

test('package exposes a dedicated full-20k v1-v2.1 collection A/B command without replacing historical runners', () => {
  assert.equal(packageJson.scripts['benchmark:text-ab-v21'], 'node scripts/benchmark/focused-text-v21-ab.mjs')
  assert.equal(packageJson.scripts['benchmark:text-ab-v21-stress'], 'node scripts/benchmark/stress-text-v21-ab.mjs')
  assert.equal(packageJson.scripts['benchmark:full20k-v21-ab'], 'NODE_ENV=development node scripts/benchmark/full20k-v21-collection-ab.mjs')
})

test('full-20k CLI defaults to canonical collections, Hard-v2, 20k provenance audits and a wider rank probe', async () => {
  const source = await loadScript()
  assert.match(source, /knowledge_entities_qwen3_4b_v1/)
  assert.match(source, /knowledge_entities_qwen3_4b_text_v21/)
  assert.match(source, /bilingual-hard-v2\.json/)
  assert.match(source, /FULL20K_AB_EXPECTED_POINTS[^\n]*20000/)
  assert.match(source, /FULL20K_AB_RANK_PROBE_LIMIT[^\n]*100/)
  assert.match(source, /embeddingTextVersion:\s*'v1'/)
  assert.match(source, /embeddingTextVersion:\s*'v2\.1'/)
  assert.match(source, /verifyEmbeddingRuntime/)
  assert.match(source, /createIndexFingerprint/)
  assert.match(source, /verifySeed/)
  assert.match(source, /entities\.length !== expectedPoints/)
  assert.match(source, /embeddingVersion: process\.env\.FULL20K_AB_EMBEDDING_VERSION \?\? 'qwen3-4b-v1'/)
  assert.match(source, /qwen3-4b-text-v1-v21-full20k-collection-ab\.json/)
  assert.match(source, /3f0ebee543de7fe93ef3add07fef390e88ab56f03f4b1b57ef71f8588e44bacc/)
  assert.match(source, /answerableCount !== 80/)
  assert.match(source, /noAnswerCount !== 20/)
})
