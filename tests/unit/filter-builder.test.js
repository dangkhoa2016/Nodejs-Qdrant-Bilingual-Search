import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQdrantFilter } from '../../src/qdrant/filter-builder.js'

test('buildQdrantFilter combines keyword and numeric constraints', () => {
  assert.deepEqual(buildQdrantFilter({ type: 'city', continent: 'Asia', population: { gte: 5000000 } }), {
    must: [
      { key: 'type', match: { value: 'city' } },
      { key: 'continent', match: { value: 'Asia' } },
      { key: 'population', range: { gte: 5000000 } }
    ]
  })
})

test('buildQdrantFilter rejects raw/unknown Qdrant fields', () => {
  assert.throws(() => buildQdrantFilter({ must: [] }), /unsupported/)
  assert.throws(() => buildQdrantFilter({ population: {} }), /empty/)
})
