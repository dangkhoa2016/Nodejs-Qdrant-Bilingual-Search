import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { formatSeedProgressLine, progressEveryBatches } from './progress.js'

async function writeAtomicJson(path, value) {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, absolute)
}

export function createSeedProgressOutput({
  collection,
  embeddingModel,
  progressPath = 'reports/seed-progress.json',
  eventsPath = 'reports/seed-progress.jsonl',
  everyBatches = 0,
  stream = process.stderr,
  now = () => new Date(),
  seedRunId = randomUUID()
} = {}) {
  let resolvedEvery = null

  return async (event) => {
    if (!event || typeof event !== 'object') return
    if (resolvedEvery == null && event.totalBatches > 0) {
      resolvedEvery = progressEveryBatches({ totalBatches: event.totalBatches, configured: everyBatches })
    }

    const isBatch = event.stage === 'seeding'
    const shouldPublish = !isBatch ||
      event.batch === 1 ||
      event.batch === event.totalBatches ||
      event.batch % (resolvedEvery ?? 1) === 0
    if (!shouldPublish) return

    const record = {
      timestamp: now().toISOString(),
      seedRunId,
      collection,
      embeddingModel,
      ...event
    }
    await writeAtomicJson(progressPath, record)
    const absoluteEvents = resolve(eventsPath)
    await mkdir(dirname(absoluteEvents), { recursive: true })
    await appendFile(absoluteEvents, `${JSON.stringify(record)}\n`, 'utf8')
    stream.write(`${formatSeedProgressLine(event)}\n`)
  }
}
