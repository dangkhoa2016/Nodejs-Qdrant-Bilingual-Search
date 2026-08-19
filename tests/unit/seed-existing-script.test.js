import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const repoFile = (path) => new URL(`../../${path}`, import.meta.url)

test('package exposes fail-closed existing-dataset semantic seed command', async () => {
  const pkg = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))
  assert.equal(pkg.scripts.seed, 'QDRANT_COLLECTION=knowledge_entities_fixture_v1 EMBEDDING_MODEL=intfloat/multilingual-e5-small EMBEDDING_DIMENSION=384 EMBEDDING_TRANSPORT=json EMBEDDING_TEXT_VERSION=v1 EMBEDDING_VERSION=v1 EMBEDDING_REQUEST_TIMEOUT_MS=15000 DATASET_VERSION=fixture-v1 NODE_ENV=development node scripts/seed/seed.mjs')
  assert.equal(pkg.scripts['seed:existing'], 'NODE_ENV=development node scripts/seed/existing.mjs')
  assert.equal(pkg.scripts['seed:status'], 'bash scripts/seed/status.sh')
  assert.equal(pkg.scripts['seed:clean:qwen3'], 'bash scripts/seed/clean-qwen3-seed.sh')
  assert.equal(pkg.scripts['seed:shadow:v21'], 'QDRANT_COLLECTION=knowledge_entities_qwen3_4b_text_v21 EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B EMBEDDING_DIMENSION=2560 EMBEDDING_TRANSPORT=binary-f32 EMBEDDING_TEXT_VERSION=v2.1 EMBEDDING_VERSION=qwen3-4b-v1 EMBEDDING_REQUEST_TIMEOUT_MS=120000 NODE_ENV=development node scripts/seed/existing.mjs')
  assert.equal(pkg.scripts['seed:canonical'], 'QDRANT_COLLECTION=knowledge_entities_qwen3_4b_text_v21 EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B EMBEDDING_DIMENSION=2560 EMBEDDING_TRANSPORT=binary-f32 EMBEDDING_TEXT_VERSION=v2.1 EMBEDDING_VERSION=qwen3-4b-v1 EMBEDDING_REQUEST_TIMEOUT_MS=120000 NODE_ENV=development node scripts/seed/existing.mjs')

  const source = await readFile(repoFile('scripts/seed/existing.mjs'), 'utf8')
  assert.match(source, /data\/generated\/entities\.final\.json/)
  assert.match(source, /requireSemanticBackend:\s*true/)
  assert.match(source, /timeoutMs:\s*config\.embeddingTimeoutMs/)
  assert.match(source, /DATASET_VERSION\s*\?\?\s*'public-v1'/)
  assert.match(source, /embeddingTextVersion:\s*config\.embeddingTextVersion/)
  assert.match(source, /assertEmbeddingTextCollectionSafety/)
  assert.match(source, /createSeedProgressOutput/)
  assert.match(source, /service\.seed\(entities, \{ onProgress \}\)/)
})


test('all semantic seed entry points propagate and guard the configured embedding text version', async () => {
  for (const file of ['scripts/seed/seed.mjs', 'scripts/seed/public.mjs', 'scripts/seed/existing.mjs']) {
    const source = await readFile(repoFile(file), 'utf8')
    assert.match(source, /embeddingTextVersion:\s*config\.embeddingTextVersion/, `${file} must propagate embeddingTextVersion`)
    assert.match(source, /assertEmbeddingTextCollectionSafety/, `${file} must guard collection/text-version pairing`)
  }
})

test('.env.example advertises promoted v2.1 canonical defaults and retains v1 rollback instructions', async () => {
  const source = await readFile(repoFile('.env.example'), 'utf8')
  assert.match(source, /^QDRANT_COLLECTION=knowledge_entities_qwen3_4b_text_v21$/m)
  assert.match(source, /^EMBEDDING_MODEL=Qwen\/Qwen3-Embedding-4B$/m)
  assert.match(source, /^EMBEDDING_DIMENSION=2560$/m)
  assert.match(source, /^EMBEDDING_TRANSPORT=binary-f32$/m)
  assert.match(source, /^EMBEDDING_TEXT_VERSION=v2\.1$/m)
  assert.match(source, /^SEARCH_DEFAULT_SCORE_THRESHOLD=0\.55$/m)
  assert.match(source, /rollback/i)
  assert.match(source, /knowledge_entities_qwen3_4b_v1/)
})
