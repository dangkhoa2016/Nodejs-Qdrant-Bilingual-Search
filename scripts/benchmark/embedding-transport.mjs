#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { benchmarkEmbeddingTransports } from '../../src/benchmarks/embedding-transport-benchmark.js'
import { loadConfig } from '../../src/config.js'
import { loadEntities } from '../../src/dataset/io.js'
import { HttpEmbeddingProvider } from '../../src/embeddings/http-embedding-provider.js'
import { prepareEntityForEmbedding } from '../../src/seed/point-mapper.js'

function parseArgs(argv) {
  const options = {
    dataset: 'data/generated/entities.final.json',
    count: 256,
    batchSize: 64,
    transports: ['json', 'binary-f32'],
    output: 'reports/embedding-transport-benchmark.json'
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i] ?? (() => { throw new Error(`${arg} requires a value`) })()
    if (arg === '--dataset') options.dataset = next()
    else if (arg === '--count') options.count = Number.parseInt(next(), 10)
    else if (arg === '--batch-size') options.batchSize = Number.parseInt(next(), 10)
    else if (arg === '--transports') options.transports = next().split(',').map((value) => value.trim()).filter(Boolean)
    else if (arg === '--output') options.output = next()
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run benchmark:embedding-transport -- [--dataset PATH] [--count 256] [--batch-size 64] [--transports json,binary-f32] [--output PATH]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (!Number.isInteger(options.count) || options.count < 1) throw new Error('--count must be a positive integer')
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 256) throw new Error('--batch-size must be between 1 and 256')
  return options
}

const options = parseArgs(process.argv.slice(2))
const config = loadConfig()
const entities = await loadEntities(options.dataset)
const selected = entities.slice(0, Math.min(options.count, entities.length))
const documents = selected.map((entity) => prepareEntityForEmbedding(entity).document.text)

const benchmark = await benchmarkEmbeddingTransports({
  documents,
  batchSize: options.batchSize,
  transports: options.transports,
  providerFactory: (transport) => new HttpEmbeddingProvider({
    baseUrl: config.embeddingUrl,
    model: config.embeddingModel,
    dimension: config.embeddingDimension,
    timeoutMs: config.embeddingTimeoutMs,
    transport
  })
})

const report = {
  generatedAt: new Date().toISOString(),
  dataset: options.dataset,
  requestedDocuments: options.count,
  ...benchmark
}
await mkdir(dirname(options.output), { recursive: true })
await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
console.error(`[benchmark] report: ${options.output}`)
