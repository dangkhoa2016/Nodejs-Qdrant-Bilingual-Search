#!/usr/bin/env node
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const MODEL_SLUG = 'qwen-qwen3-embedding-4b'
const EXPECTED_MODEL_TYPE = 'qwen3'
const EXPECTED_HIDDEN_SIZE = 2560
const EXPECTED_LAYERS = 36
const DEFAULT_INPUT_ROOT = '/kaggle/input'

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`)
  process.exitCode = 2
  return null
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function isReadableFile(file) {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0) return false
    await access(file)
    return true
  } catch {
    return false
  }
}

async function validateCandidate(candidate, inputRoot) {
  let resolved
  try {
    resolved = await realpath(candidate)
  } catch {
    return { ok: false, candidate, reason: 'candidate does not resolve' }
  }

  if (!isWithin(inputRoot, resolved)) {
    return { ok: false, candidate: resolved, reason: 'candidate resolves outside KAGGLE_INPUT_ROOT' }
  }

  const normalized = resolved.split(path.sep).join('/')
  if (!normalized.includes(`/${MODEL_SLUG}/`)) {
    return { ok: false, candidate: resolved, reason: `path does not contain ${MODEL_SLUG}` }
  }
  if (!normalized.includes('/transformers/')) {
    return { ok: false, candidate: resolved, reason: 'path is not a transformers variation' }
  }
  if (normalized.includes('/pytorch/')) {
    return { ok: false, candidate: resolved, reason: 'pytorch variation is not accepted for this profile' }
  }

  const configPath = path.join(resolved, 'config.json')
  const tokenizerConfigPath = path.join(resolved, 'tokenizer_config.json')
  const indexPath = path.join(resolved, 'model.safetensors.index.json')

  let config
  let index
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    return { ok: false, candidate: resolved, reason: `invalid config.json: ${error.message}` }
  }

  if (String(config.model_type || '').toLowerCase() !== EXPECTED_MODEL_TYPE) {
    return { ok: false, candidate: resolved, reason: `model_type=${config.model_type ?? 'missing'}` }
  }
  if (Number(config.hidden_size) !== EXPECTED_HIDDEN_SIZE) {
    return { ok: false, candidate: resolved, reason: `hidden_size=${config.hidden_size ?? 'missing'}` }
  }
  if (config.num_hidden_layers != null && Number(config.num_hidden_layers) !== EXPECTED_LAYERS) {
    return { ok: false, candidate: resolved, reason: `num_hidden_layers=${config.num_hidden_layers}` }
  }

  if (!(await isReadableFile(tokenizerConfigPath))) {
    return { ok: false, candidate: resolved, reason: 'missing/empty tokenizer_config.json' }
  }

  try {
    index = JSON.parse(await readFile(indexPath, 'utf8'))
  } catch (error) {
    return { ok: false, candidate: resolved, reason: `invalid model.safetensors.index.json: ${error.message}` }
  }

  const weightMap = index?.weight_map
  if (!weightMap || typeof weightMap !== 'object' || Object.keys(weightMap).length === 0) {
    return { ok: false, candidate: resolved, reason: 'safetensors weight_map is empty' }
  }

  const shards = [...new Set(Object.values(weightMap).map(String))].sort()
  if (shards.length === 0) {
    return { ok: false, candidate: resolved, reason: 'no safetensors shards referenced' }
  }

  for (const shard of shards) {
    if (path.isAbsolute(shard) || shard.includes('..')) {
      return { ok: false, candidate: resolved, reason: `unsafe shard path: ${shard}` }
    }
    if (!(await isReadableFile(path.join(resolved, shard)))) {
      return { ok: false, candidate: resolved, reason: `missing/empty shard: ${shard}` }
    }
  }

  return {
    ok: true,
    path: resolved,
    model_type: config.model_type,
    hidden_size: Number(config.hidden_size),
    num_hidden_layers: config.num_hidden_layers == null ? null : Number(config.num_hidden_layers),
    shard_count: shards.length,
    shards
  }
}

async function walkForConfigs(root, maxDepth = 12) {
  const found = []
  async function walk(dir, depth) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const normalized = dir.split(path.sep).join('/')
    if (normalized.includes(`/${MODEL_SLUG}/pytorch/`)) return

    for (const entry of entries) {
      if (entry.name === 'config.json' && normalized.includes(`/${MODEL_SLUG}/`) && normalized.includes('/transformers/')) {
        found.push(dir)
        continue
      }
      if (!entry.isDirectory()) continue
      if (entry.name === '.git' || entry.name === '__pycache__') continue
      await walk(path.join(dir, entry.name), depth + 1)
    }
  }
  await walk(root, 0)
  return [...new Set(found)]
}

async function main() {
  const pathOnly = process.argv.includes('--path-only')
  const rawRoot = process.env.KAGGLE_INPUT_ROOT || DEFAULT_INPUT_ROOT
  let inputRoot
  try {
    inputRoot = await realpath(rawRoot)
  } catch {
    return fail(`KAGGLE_INPUT_ROOT is not readable: ${rawRoot}`)
  }

  const explicit = process.env.EMBEDDING_MODEL_PATH?.trim()
  if (explicit) {
    const validated = await validateCandidate(explicit, inputRoot)
    if (!validated.ok) return fail(`EMBEDDING_MODEL_PATH rejected: ${validated.reason}: ${validated.candidate}`)
    if (pathOnly) process.stdout.write(`${validated.path}\n`)
    else process.stdout.write(`${JSON.stringify({ source: 'explicit', input_root: inputRoot, ...validated }, null, 2)}\n`)
    return
  }

  const discovered = await walkForConfigs(inputRoot)
  const validations = []
  for (const candidate of discovered) validations.push(await validateCandidate(candidate, inputRoot))
  const valid = validations.filter((item) => item.ok)

  if (valid.length === 0) {
    const reasons = validations.map((item) => `${item.candidate}: ${item.reason}`).join('\n  ')
    return fail(`no unique valid Qwen3 Transformers artifact found under ${inputRoot}${reasons ? `\n  ${reasons}` : ''}`)
  }
  if (valid.length > 1) {
    return fail(`ambiguous Qwen3 Transformers artifacts (${valid.length}); set EMBEDDING_MODEL_PATH explicitly:\n  ${valid.map((item) => item.path).join('\n  ')}`)
  }

  const selected = valid[0]
  if (pathOnly) process.stdout.write(`${selected.path}\n`)
  else process.stdout.write(`${JSON.stringify({ source: 'discovered', input_root: inputRoot, ...selected }, null, 2)}\n`)
}

await main()
