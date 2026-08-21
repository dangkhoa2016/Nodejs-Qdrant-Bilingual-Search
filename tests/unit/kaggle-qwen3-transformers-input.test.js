import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../..')
const resolver = path.join(projectRoot, 'scripts/kaggle/resolve-qwen3-transformers-input.mjs')
const wrapper = path.join(projectRoot, 'scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh')

async function makeArtifact(dir, { dangling = false, modelType = 'qwen3', hiddenSize = 2560 } = {}) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'config.json'), JSON.stringify({
    model_type: modelType,
    hidden_size: hiddenSize,
    num_hidden_layers: 36
  }))
  await writeFile(path.join(dir, 'tokenizer_config.json'), '{}\n')
  const shards = ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors']
  await writeFile(path.join(dir, 'model.safetensors.index.json'), JSON.stringify({
    metadata: { total_size: 123 },
    weight_map: { 'a.weight': shards[0], 'b.weight': shards[1] }
  }))
  await writeFile(path.join(dir, shards[0]), 'fake-a')
  if (!dangling) await writeFile(path.join(dir, shards[1]), 'fake-b')
}

async function resolveWith(inputRoot, extraEnv = {}) {
  return execFileAsync(process.execPath, [resolver, '--path-only'], {
    env: { ...process.env, KAGGLE_INPUT_ROOT: inputRoot, EMBEDDING_MODEL_PATH: '', ...extraEnv }
  })
}

test('discovers the unique read-only Transformers/default artifact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    const expected = path.join(root, 'models', 'dangkhoa2016', 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root)
    assert.equal(stdout.trim(), await (await import('node:fs/promises')).realpath(expected))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('supports a shallower Kaggle mount layout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    const expected = path.join(root, 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root)
    assert.equal(stdout.trim(), await (await import('node:fs/promises')).realpath(expected))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ignores the old pytorch/fp32 variation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    await makeArtifact(path.join(root, 'qwen-qwen3-embedding-4b', 'pytorch', 'fp32', '1'))
    await assert.rejects(resolveWith(root), /no unique valid Qwen3 Transformers artifact/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fails closed when a safetensors shard referenced by the index is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    await makeArtifact(path.join(root, 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1'), { dangling: true })
    await assert.rejects(resolveWith(root), /missing\/empty shard/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fails closed on ambiguous valid Transformers artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    await makeArtifact(path.join(root, 'a', 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1'))
    await makeArtifact(path.join(root, 'b', 'qwen-qwen3-embedding-4b', 'transformers', 'default', '2'))
    await assert.rejects(resolveWith(root), /ambiguous Qwen3 Transformers artifacts/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('accepts an explicit structurally valid model path under KAGGLE_INPUT_ROOT', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    const expected = path.join(root, 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(expected)
    const { stdout } = await resolveWith(root, { EMBEDDING_MODEL_PATH: expected })
    assert.equal(stdout.trim(), await (await import('node:fs/promises')).realpath(expected))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects an explicit model path outside KAGGLE_INPUT_ROOT', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-root-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-outside-'))
  try {
    const candidate = path.join(outside, 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(candidate)
    await assert.rejects(resolveWith(root, { EMBEDDING_MODEL_PATH: candidate }), /outside KAGGLE_INPUT_ROOT/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('wrapper exports the frozen CPU FP16 runtime contract in dry-run mode', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    const candidate = path.join(root, 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(candidate)
    const { stdout } = await execFileAsync('bash', [wrapper], {
      env: {
        ...process.env,
        KAGGLE_INPUT_ROOT: root,
        EMBEDDING_MODEL_PATH: '',
        QWEN3_TRANSFORMERS_DRY_RUN: '1'
      }
    })
    assert.match(stdout, /QWEN3_TRANSFORMERS_VARIATION=transformers\/default/)
    assert.match(stdout, /EMBEDDING_DTYPE=float16/)
    assert.match(stdout, /EMBEDDING_DEVICE=cpu/)
    assert.match(stdout, /EMBEDDING_DIMENSION=2560/)
    assert.match(stdout, /EMBEDDING_TRANSPORT=binary-f32/)
    assert.match(stdout, /HF_HUB_OFFLINE=1/)
    assert.match(stdout, /TRANSFORMERS_OFFLINE=1/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('wrapper rejects a float32 override instead of silently changing the profile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-transformers-'))
  try {
    const candidate = path.join(root, 'qwen-qwen3-embedding-4b', 'transformers', 'default', '1')
    await makeArtifact(candidate)
    await assert.rejects(execFileAsync('bash', [wrapper], {
      env: {
        ...process.env,
        KAGGLE_INPUT_ROOT: root,
        EMBEDDING_MODEL_PATH: '',
        QWEN3_TRANSFORMERS_DRY_RUN: '1',
        EMBEDDING_DTYPE: 'float32'
      }
    }), /requires.*float16/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
