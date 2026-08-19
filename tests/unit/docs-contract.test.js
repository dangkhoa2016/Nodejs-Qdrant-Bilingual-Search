import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const requiredReadmeTokens = [
  'dataset:build', 'dataset:translate', 'seed:public', '--dry-run',
  "Who's On First", 'GeoNames', 'cities15000', 'local', 'openai', 'gemini', 'nvidia', 'groq',
  'OPENAI_KEY1', 'GEMINI_KEY1', 'NVIDIA_KEY1', 'GROQ_KEY1',
  'QDRANT_PROVIDER', 'beam', 'modal', '/ready'
]

test('English and Vietnamese READMEs document the same executable provider and seed surface', async () => {
  const [en, vi] = await Promise.all([readFile('README.md', 'utf8'), readFile('README.vi.md', 'utf8')])
  for (const token of requiredReadmeTokens) {
    assert.ok(en.includes(token), `README.md must document ${token}`)
    assert.ok(vi.includes(token), `README.vi.md must document ${token}`)
  }
})

test('bilingual dataset translation and Qdrant guides exist and cross-link operational commands', async () => {
  const paths = [
    'docs/dataset.md', 'docs/dataset.vi.md',
    'docs/translation.md', 'docs/translation.vi.md',
    'docs/qdrant-connection.md', 'docs/qdrant-connection.vi.md'
  ]
  for (const path of paths) {
    const text = await readFile(path, 'utf8')
    assert.ok(text.length > 1000, `${path} must be detailed rather than a placeholder`)
  }
  const translation = await readFile('docs/translation.md', 'utf8')
  assert.match(translation, /401\/403/)
  assert.match(translation, /429/)
  assert.match(translation, /round-robin/)
  assert.match(translation, /translation-cache\.jsonl/)
  const dataset = await readFile('docs/dataset.md', 'utf8')
  assert.match(dataset, /GeoNames/)
  assert.match(dataset, /cities15000/)
  assert.match(dataset, /CC BY 4\.0/)
  assert.match(dataset, /Who's On First/)
  assert.match(dataset, /best-effort/)
  const dataLicense = await readFile('data/LICENSE-DATA.md', 'utf8')
  assert.match(dataLicense, /Who's On First License/)
})

test('.env.example exposes multi-key cloud translation configuration without real secrets', async () => {
  const env = await readFile('.env.example', 'utf8')
  for (const token of ['TRANSLATION_PROVIDER', 'OPENAI_KEY1=', 'GEMINI_KEY1=', 'NVIDIA_KEY1=', 'GROQ_KEY1=', 'TRANSLATION_CACHE_PATH']) {
    assert.ok(env.includes(token), `.env.example must include ${token}`)
  }
  assert.equal(/(?:sk-|gsk_|nvapi-)[A-Za-z0-9_-]{12,}/.test(env), false)
})
