#!/usr/bin/env node
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

const CANONICAL_MODEL_SLUG = 'qwen-qwen3-embedding-4b'
const MAX_DISCOVERY_DEPTH = 10

function fail(message) {
  const error = new Error(message)
  error.code = 'QWEN3_FP32_INPUT_INVALID'
  throw error
}

async function exists(target) {
  try {
    await access(target, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function validateArtifact(candidate) {
  let root
  try {
    root = await realpath(candidate)
  } catch {
    fail(`Qwen3 FP32 model path does not exist: ${candidate}`)
  }

  const required = ['config.json', 'modules.json', 'model.safetensors.index.json']
  for (const file of required) {
    if (!(await exists(path.join(root, file)))) {
      fail(`Qwen3 FP32 artifact is incomplete: missing ${file} under ${root}`)
    }
  }

  let index
  try {
    index = JSON.parse(await readFile(path.join(root, 'model.safetensors.index.json'), 'utf8'))
  } catch (error) {
    fail(`Qwen3 FP32 artifact has an invalid model.safetensors.index.json under ${root}: ${error.message}`)
  }

  const weightMap = index?.weight_map
  if (!weightMap || typeof weightMap !== 'object' || Array.isArray(weightMap) || Object.keys(weightMap).length === 0) {
    fail(`Qwen3 FP32 artifact has an empty or invalid weight_map under ${root}`)
  }

  const shards = [...new Set(Object.values(weightMap).map(String))].sort()
  if (shards.length === 0 || shards.some((name) => !name.endsWith('.safetensors'))) {
    fail(`Qwen3 FP32 artifact has an invalid safetensors shard map under ${root}`)
  }

  for (const shard of shards) {
    const shardPath = path.join(root, shard)
    if (!(await exists(shardPath))) {
      fail(`Qwen3 FP32 artifact is missing safetensors shard ${shard} referenced by the index under ${root}`)
    }
  }

  return { root, shardCount: shards.length, tensorCount: Object.keys(weightMap).length }
}

function looksLikeFp32Variation(dir) {
  const normalized = dir.toLowerCase().split(path.sep).join('/')
  return normalized.includes(CANONICAL_MODEL_SLUG) && normalized.includes('/pytorch/') && normalized.includes('/fp32/')
}

async function discover(root, dir = root, depth = 0, found = []) {
  if (depth > MAX_DISCOVERY_DEPTH) return found
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }

  if (looksLikeFp32Variation(dir) && entries.some((entry) => entry.isFile() && entry.name === 'model.safetensors.index.json')) {
    try {
      const validated = await validateArtifact(dir)
      found.push(validated)
      return found
    } catch {
      // Keep walking. A broken look-alike is not a valid discovery candidate.
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    await discover(root, path.join(dir, entry.name), depth + 1, found)
  }
  return found
}

export async function resolveQwen3Fp32Input({ inputRoot = process.env.KAGGLE_INPUT_ROOT || '/kaggle/input', explicitPath = process.env.EMBEDDING_MODEL_PATH || process.env.QWEN3_FP32_MODEL_PATH } = {}) {
  if (explicitPath?.trim()) {
    const explicit = explicitPath.trim()
    if (!looksLikeFp32Variation(explicit)) {
      fail(`Explicit model path is not the Qwen3 PyTorch/fp32 variation: ${explicit}. Unset EMBEDDING_MODEL_PATH or point it at the fp32 variation.`)
    }
    const validated = await validateArtifact(explicit)
    return { ...validated, source: 'explicit' }
  }

  const preferred = [
    path.join(inputRoot, CANONICAL_MODEL_SLUG, 'pytorch', 'fp32', '1'),
    path.join(inputRoot, 'models', 'dangkhoa2016', CANONICAL_MODEL_SLUG, 'pytorch', 'fp32', '1')
  ]

  for (const candidate of preferred) {
    if (!(await exists(candidate))) continue
    const validated = await validateArtifact(candidate)
    return { ...validated, source: 'preferred' }
  }

  const found = await discover(inputRoot)
  const unique = new Map(found.map((item) => [item.root, item]))
  const candidates = [...unique.values()]

  if (candidates.length === 0) {
    fail(`No valid ${CANONICAL_MODEL_SLUG} PyTorch/fp32 Kaggle Input was found under ${inputRoot}`)
  }
  if (candidates.length > 1) {
    fail(`Multiple valid Qwen3 FP32 artifacts were found under ${inputRoot}; set EMBEDDING_MODEL_PATH explicitly:\n${candidates.map((item) => `- ${item.root}`).join('\n')}`)
  }
  return { ...candidates[0], source: 'discovered' }
}

async function main() {
  const result = await resolveQwen3Fp32Input()
  if (process.argv.includes('--path-only')) {
    process.stdout.write(`${result.root}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({
    model: 'Qwen/Qwen3-Embedding-4B',
    variation: 'pytorch/fp32',
    version: 1,
    model_path: result.root,
    source: result.source,
    shard_count: result.shardCount,
    indexed_tensor_keys: result.tensorCount
  }, null, 2)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`)
    process.exit(2)
  })
}
