import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEntities } from '../../src/dataset/io.js'

test('loadEntities validates and rejects duplicate IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dataset-'))
  const file = join(dir, 'data.json')
  await writeFile(file, JSON.stringify([{ id: 'Q1', type: 'city', name: { en: 'A' } }, { id: 'Q1', type: 'city', name: { en: 'B' } }]))
  await assert.rejects(() => loadEntities(file), /duplicate entity id/)
})

test('committed tiny fixture is valid bilingual seed data', async () => {
  const entities = await loadEntities('data/fixtures/tiny.json')
  assert.equal(entities.length, 4)
  assert.equal(entities.find((entity) => entity.id === 'Q869').name.vi, 'Thái Lan')
})
