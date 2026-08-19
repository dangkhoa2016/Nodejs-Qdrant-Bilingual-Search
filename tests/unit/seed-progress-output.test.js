import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSeedProgressOutput } from '../../src/seed/progress-output.js'

test('seed progress output throttles batch logs and persists machine-readable snapshot/events', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'seed-progress-'))
  const progressPath = path.join(dir, 'progress.json')
  const eventsPath = path.join(dir, 'events.jsonl')
  let stdout = ''
  const handler = createSeedProgressOutput({
    collection: 'collection-v1',
    embeddingModel: 'model-v1',
    progressPath,
    eventsPath,
    everyBatches: 2,
    stream: { write: (line) => { stdout += line } },
    now: () => new Date('2026-08-25T06:00:00.000Z')
  })

  const base = {
    stage: 'seeding', total: 40, totalBatches: 4, embedded: 0, upserted: 0,
    percent: 0, elapsedMs: 0, rateEntitiesPerSecond: 0, etaMs: 0,
    embeddingMs: 0, qdrantUpsertMs: 0
  }
  await handler({ ...base, batch: 1, embedded: 10, upserted: 10, percent: 25 })
  await handler({ ...base, batch: 2, embedded: 20, upserted: 20, percent: 50 })
  await handler({ ...base, batch: 3, embedded: 30, upserted: 30, percent: 75 })
  await handler({ ...base, batch: 4, embedded: 40, upserted: 40, percent: 100 })
  await handler({ ...base, stage: 'completed', batch: 4, embedded: 40, upserted: 40, percent: 100 })

  const snapshot = JSON.parse(await readFile(progressPath, 'utf8'))
  const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(snapshot.stage, 'completed')
  assert.equal(snapshot.collection, 'collection-v1')
  assert.equal(snapshot.embeddingModel, 'model-v1')
  assert.equal(typeof snapshot.seedRunId, 'string')
  assert.ok(snapshot.seedRunId.length > 0)
  assert.equal(new Set(events.map((item) => item.seedRunId)).size, 1)
  assert.deepEqual(events.map((item) => `${item.stage}:${item.batch}`), [
    'seeding:1', 'seeding:2', 'seeding:4', 'completed:4'
  ])
  assert.doesNotMatch(stdout, /seeding.*3\/4/)
})
