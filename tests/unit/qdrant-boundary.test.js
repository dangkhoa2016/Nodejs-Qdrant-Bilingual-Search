import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = [
  'src/server.js',
  'scripts/seed/seed.mjs',
  'src/qdrant/qdrant-service.js',
  'src/search/search-service.js',
  'src/entities/entity-service.js',
  'src/http/app.js'
]

test('raw QdrantClient construction is isolated to the production connection factory', async () => {
  for (const file of files) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.equal(source.includes("from '@qdrant/js-client-rest'"), false, `${file} imports raw Qdrant SDK`)
    assert.equal(source.includes('new QdrantClient'), false, `${file} constructs raw Qdrant SDK`)
  }
})

test('provider-specific branching is confined to configuration/connection infrastructure', async () => {
  const upperLayerFiles = [
    'src/qdrant/qdrant-service.js',
    'src/search/search-service.js',
    'src/entities/entity-service.js',
    'src/http/app.js',
    'scripts/seed/seed.mjs'
  ]
  for (const file of upperLayerFiles) {
    const source = (await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')).toLowerCase()
    assert.equal(/qdrant_provider|provider\s*===?\s*['"](?:beam|modal)['"]/.test(source), false, `${file} contains provider-specific branching`)
  }
})
