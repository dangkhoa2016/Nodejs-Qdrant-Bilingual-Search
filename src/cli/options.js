import { parseArgs } from 'node:util'
import { extname } from 'node:path'

function positiveInt(value, name) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
  return parsed
}

function commaList(value, fallback) {
  const items = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  return items.length ? items : fallback
}

function manifestPath(output) {
  const extension = extname(output)
  return extension ? `${output.slice(0, -extension.length)}.manifest${extension}` : `${output}.manifest.json`
}

export function parseDatasetBuildArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      source: { type: 'string' },
      sources: { type: 'string' },
      types: { type: 'string' },
      limit: { type: 'string' },
      'wof-cache-dir': { type: 'string' },
      'wof-refresh': { type: 'boolean', default: false },
      output: { type: 'string' },
      manifest: { type: 'string' }
    }
  })
  if (values.source && values.sources) throw new TypeError('use only one of --source or --sources')
  const output = values.output ?? 'data/generated/entities.base.json'
  return {
    sources: values.sources ?? values.source ?? 'geonames,wof',
    types: values.types ?? 'country,city',
    limit: values.limit,
    wofCacheDir: values['wof-cache-dir'] ?? 'data/cache/wof',
    wofRefresh: values['wof-refresh'],
    output,
    manifest: values.manifest ?? manifestPath(output)
  }
}

export function parseTranslationArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      cache: { type: 'string' },
      concurrency: { type: 'string' },
      fields: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }
    }
  })
  if (positionals.length > 2) throw new TypeError('dataset:translate accepts at most positional input and output paths')
  const concurrency = values.concurrency == null ? undefined : positiveInt(values.concurrency, 'concurrency')
  return {
    input: values.input ?? positionals[0] ?? 'data/generated/entities.base.json',
    output: values.output ?? positionals[1] ?? 'data/generated/entities.translated.json',
    provider: values.provider,
    model: values.model,
    cache: values.cache,
    concurrency,
    fields: commaList(values.fields, ['description']),
    dryRun: values['dry-run']
  }
}

export function parsePublicSeedArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      source: { type: 'string' },
      sources: { type: 'string' },
      types: { type: 'string' },
      limit: { type: 'string' },
      'wof-cache-dir': { type: 'string' },
      'wof-refresh': { type: 'boolean', default: false },
      translate: { type: 'string' },
      model: { type: 'string' },
      fields: { type: 'string' },
      'dataset-output': { type: 'string' },
      manifest: { type: 'string' },
      report: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }
    }
  })
  if (values.source && values.sources) throw new TypeError('use only one of --source or --sources')
  const limit = values.limit == null ? undefined : positiveInt(values.limit, 'limit')
  return {
    sources: values.sources ?? values.source ?? 'geonames,wof',
    types: values.types ?? 'country,city',
    limit,
    wofCacheDir: values['wof-cache-dir'] ?? 'data/cache/wof',
    wofRefresh: values['wof-refresh'],
    translationProvider: values.translate ?? 'none',
    translationModel: values.model,
    translationFields: commaList(values.fields, ['description']),
    datasetOutput: values['dataset-output'] ?? 'data/generated/entities.final.json',
    manifest: values.manifest ?? 'data/generated/dataset-manifest.json',
    report: values.report ?? 'data/generated/seed-report.json',
    dryRun: values['dry-run']
  }
}
