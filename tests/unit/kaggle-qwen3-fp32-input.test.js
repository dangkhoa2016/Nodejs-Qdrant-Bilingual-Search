import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const resolver = path.join(projectRoot, 'scripts/kaggle/resolve-qwen3-fp32-input.mjs')
const wrapper = path.join(projectRoot, 'scripts/kaggle/run-qwen3-fp32-cpu.sh')

async function makeArtifact(dir, { dangling = false } = {}) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'config.json'), '{}\n')
  await writeFile(path.join(dir, 'modules.json'), '[]\n')
  const shards = ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors']
  const index = {
    metadata: { total_size: 123 },
    weight_map: {
      'a.weight': shards[0],
      'b.weight': shards[1]
    }
  }
  await writeFile(path.join(dir, 'model.safetensors.index.json'), JSON.stringify(index))
  await writeFile(path.join(dir, shards[0]), 'fake')
  if (!dangling) await writeFile(path.join(dir, shards[1]), 'fake')
}

async function resolveWith(inputRoot, extraEnv = {}) {
  return execFileAsync(process.execPath, [resolver, '--path-only'], {
    env: { ...process.env, KAGGLE_INPUT_ROOT: inputRoot, ...extraEnv }
  })
}

test('prefers the canonical Kaggle PyTorch/fp32/version-1 mount', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const expected = path.join(root, 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root)
    assert.equal(stdout.trim(), expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('supports the older /models/<owner>/... Kaggle mount layout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const expected = path.join(root, 'models', 'dangkhoa2016', 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root)
    assert.equal(stdout.trim(), expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('discovers a structurally valid fp32 variation when Kaggle changes the mount prefix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const expected = path.join(root, 'some-prefix', 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root)
    assert.equal(stdout.trim(), expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('explicit EMBEDDING_MODEL_PATH is accepted only after artifact validation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const expected = path.join(root, 'manual', 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root, { EMBEDDING_MODEL_PATH: expected })
    assert.equal(stdout.trim(), expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects a stale explicit non-fp32 model path even when it is structurally valid', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const stale = path.join(root, 'models', 'dangkhoa2016', 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(stale)
    await assert.rejects(resolveWith(root, { EMBEDDING_MODEL_PATH: stale }), /PyTorch\/fp32 variation/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects an artifact with a dangling safetensors shard reference', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const broken = path.join(root, 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(broken, { dangling: true })
    await assert.rejects(resolveWith(root), /missing safetensors shard/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fails closed when fallback discovery finds multiple fp32 artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    await makeArtifact(path.join(root, 'a', 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1'))
    await makeArtifact(path.join(root, 'b', 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1'))
    await assert.rejects(resolveWith(root), /multiple valid.*fp32/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CPU FP32 wrapper rejects a stale GPU-sized embedding batch from the caller environment', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const expected = path.join(root, 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(expected)
    await assert.rejects(
      execFileAsync('bash', [wrapper], {
        env: { ...process.env, KAGGLE_INPUT_ROOT: root, QWEN3_FP32_DRY_RUN: '1', EMBEDDING_BATCH_SIZE: '8' }
      }),
      /EMBEDDING_BATCH_SIZE=8 conflicts.*expected 1/i
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CPU FP32 wrapper exports the exact runtime contract in dry-run mode', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-fp32-'))
  try {
    const expected = path.join(root, 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1')
    await makeArtifact(expected)
    const { stdout } = await execFileAsync('bash', [wrapper], {
      env: { ...process.env, KAGGLE_INPUT_ROOT: root, QWEN3_FP32_DRY_RUN: '1' }
    })
    assert.match(stdout, /EMBEDDING_MODEL=Qwen\/Qwen3-Embedding-4B/)
    assert.match(stdout, /EMBEDDING_DEVICE=cpu/)
    assert.match(stdout, /EMBEDDING_DTYPE=float32/)
    assert.match(stdout, /EMBEDDING_BATCH_SIZE=1/)
    assert.match(stdout, /EMBEDDING_DIMENSION=2560/)
    assert.match(stdout, /EMBEDDING_PROFILE=qwen3/)
    assert.match(stdout, /EMBEDDING_REQUEST_TIMEOUT_MS=120000/)
    assert.match(stdout, /DEMO_STARTUP_ATTEMPTS=900/)
    assert.match(stdout, /DEMO_STARTUP_INTERVAL_SECONDS=1/)
    assert.match(stdout, /HF_HUB_OFFLINE=1/)
    assert.match(stdout, /TRANSFORMERS_OFFLINE=1/)
    assert.match(stdout, new RegExp(`EMBEDDING_MODEL_PATH=${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  } finally { await rm(root, { recursive: true, force: true }) }
})
