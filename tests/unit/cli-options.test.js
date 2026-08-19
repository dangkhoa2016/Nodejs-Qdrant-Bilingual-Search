import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDatasetBuildArgs, parseTranslationArgs, parsePublicSeedArgs } from '../../src/cli/options.js'

test('parseDatasetBuildArgs defaults public geography to GeoNames plus WOF', () => {
  assert.deepEqual(parseDatasetBuildArgs([
    '--sources', 'geonames,wof', '--types', 'country,city', '--limit', '1000',
    '--wof-cache-dir', '/cache/wof', '--output', 'out.json'
  ]), {
    sources: 'geonames,wof', types: 'country,city', limit: '1000',
    wofCacheDir: '/cache/wof', wofRefresh: false, output: 'out.json', manifest: 'out.manifest.json'
  })
})

test('parseDatasetBuildArgs supports singular --source alias and derives manifest path', () => {
  const result = parseDatasetBuildArgs(['--source', 'geonames', '--output', 'data/generated/base.json'])
  assert.equal(result.sources, 'geonames')
  assert.equal(result.manifest, 'data/generated/base.manifest.json')
})

test('parseDatasetBuildArgs default source selection is geonames,wof', () => {
  const result = parseDatasetBuildArgs([])
  assert.equal(result.sources, 'geonames,wof')
  assert.equal(result.types, 'country,city')
  assert.equal(result.wofCacheDir, 'data/cache/wof')
  assert.equal(result.wofRefresh, false)
})

test('parseTranslationArgs supports provider model cache concurrency fields and dry-run', () => {
  assert.deepEqual(parseTranslationArgs([
    '--input', 'base.json', '--output', 'translated.json', '--provider', 'groq', '--model', 'model-x',
    '--cache', 'cache.jsonl', '--concurrency', '8', '--fields', 'description,name', '--dry-run'
  ]), {
    input: 'base.json', output: 'translated.json', provider: 'groq', model: 'model-x', cache: 'cache.jsonl',
    concurrency: 8, fields: ['description', 'name'], dryRun: true
  })
})

test('parseTranslationArgs preserves legacy positional input/output for existing users', () => {
  const result = parseTranslationArgs(['base.json', 'translated.json'])
  assert.equal(result.input, 'base.json')
  assert.equal(result.output, 'translated.json')
})

test('parsePublicSeedArgs captures GeoNames build translation and safety controls', () => {
  const result = parsePublicSeedArgs([
    '--sources', 'geonames,wof', '--types', 'country,city', '--limit', '5000',
    '--wof-cache-dir', '/cache/wof', '--wof-refresh',
    '--translate', 'nvidia', '--model', 'nvidia/riva-translate-4b-instruct-v2', '--dry-run',
    '--dataset-output', 'final.json', '--report', 'report.json'
  ])
  assert.equal(result.sources, 'geonames,wof')
  assert.equal(result.wofCacheDir, '/cache/wof')
  assert.equal(result.wofRefresh, true)
  assert.equal(result.translationProvider, 'nvidia')
  assert.equal(result.translationModel, 'nvidia/riva-translate-4b-instruct-v2')
  assert.equal(result.dryRun, true)
  assert.equal(result.datasetOutput, 'final.json')
  assert.equal(result.report, 'report.json')
})

test('CLI option parsers reject conflicting source aliases, retired Natural Earth flags and invalid concurrency', () => {
  assert.throws(() => parseDatasetBuildArgs(['--source', 'geonames', '--sources', 'geonames,wof']), /only one of --source or --sources/)
  assert.throws(() => parseDatasetBuildArgs(['--natural-earth-resolution', '10m']), /Unknown option/)
  assert.throws(() => parseTranslationArgs(['--concurrency', '0']), /positive integer/)
})
