import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = [
  'src/runtime/create-runtime.js',
  'scripts/seed/seed.mjs',
  'scripts/seed/public.mjs',
  'scripts/verify/semantic-index.mjs'
]

test('all production HttpEmbeddingProvider call sites propagate configured request timeout and transport', async () => {
  for (const file of files) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.match(source, /timeoutMs:\s*config\.embeddingTimeoutMs/, `${file} must propagate embedding timeout`)
    assert.match(source, /transport:\s*config\.embeddingTransport/, `${file} must propagate embedding transport`)
  }
})
