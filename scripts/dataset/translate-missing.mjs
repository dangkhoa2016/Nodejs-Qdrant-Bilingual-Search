#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseTranslationArgs } from '../../src/cli/options.js'
import { loadEntities } from '../../src/dataset/io.js'
import { translateDataset } from '../../src/dataset/translation.js'
import { countTranslationCandidates } from '../../src/seed/public-seed-orchestrator.js'
import { loadTranslationConfig } from '../../src/translation/config.js'
import { createTranslationProvider } from '../../src/translation/create-provider.js'
import { JsonlTranslationCache } from '../../src/translation/cache.js'
import { TranslationService } from '../../src/translation/service.js'

const options = parseTranslationArgs(process.argv.slice(2))
const input = resolve(options.input)
const output = resolve(options.output)
const entities = await loadEntities(input)
const env = { ...process.env }
if (options.provider) env.TRANSLATION_PROVIDER = options.provider
if (options.model) env.TRANSLATION_MODEL = options.model
if (options.cache) env.TRANSLATION_CACHE_PATH = options.cache
if (options.concurrency) env.TRANSLATION_CONCURRENCY = String(options.concurrency)

const providerName = String(env.TRANSLATION_PROVIDER ?? 'none').toLowerCase()
const candidates = providerName === 'none' ? 0 : countTranslationCandidates(entities, options.fields)
if (options.dryRun) {
  console.log(JSON.stringify({ dryRun: true, input, entities: entities.length, provider: providerName, fields: options.fields, translationCandidates: candidates }, null, 2))
  process.exit(0)
}

const config = loadTranslationConfig(env)
let translated = entities
if (config.provider !== 'none') {
  const provider = createTranslationProvider({ config, env })
  const cache = new JsonlTranslationCache(resolve(config.cachePath))
  const translator = new TranslationService({ provider, cache, translationVersion: config.version })
  translated = await translateDataset(entities, {
    translator,
    fields: options.fields,
    model: config.model,
    translationVersion: config.version,
    concurrency: options.concurrency ?? config.concurrency
  })
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(translated, null, 2)}\n`, 'utf8')
const remaining = config.provider === 'none' ? 0 : countTranslationCandidates(translated, options.fields)
console.log(JSON.stringify({
  input,
  output,
  entities: translated.length,
  provider: config.provider,
  model: config.model ?? null,
  fields: options.fields,
  translationCandidates: candidates,
  translatedCandidates: Math.max(0, candidates - remaining),
  remainingCandidates: remaining,
  cache: config.provider === 'none' ? null : resolve(config.cachePath)
}, null, 2))
