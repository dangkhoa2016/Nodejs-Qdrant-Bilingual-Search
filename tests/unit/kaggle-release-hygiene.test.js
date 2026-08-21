import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../..')
const nodeBootstrap = path.join(projectRoot, 'scripts/kaggle/ensure-node22.sh')
const qwenWrapper = path.join(projectRoot, 'scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh')
const evidencePackager = path.join(projectRoot, 'scripts/kaggle/package-review-evidence.sh')
const evidenceAssembler = path.join(projectRoot, 'scripts/kaggle/assemble-review-evidence.sh')

const apiSentinelSummary = (sentinelResponses) => ({
  generated_at: '2026-08-29T00:00:00.000Z',
  sentinels: [
    { id: 'thailand_en', query: 'Southeast Asian country whose currency is baht', expected: 'geonames:country:1605651', response: sentinelResponses.thailand_en },
    { id: 'thailand_vi', query: 'quốc gia Đông Nam Á sử dụng đồng baht', expected: 'geonames:country:1605651', response: sentinelResponses.thailand_vi },
    { id: 'tokyo_vi', query: 'thành phố thủ đô của Nhật Bản', expected: 'geonames:city:1850147', response: sentinelResponses.tokyo_vi },
    { id: 'beijing_vi', query: 'Bắc Kinh, thủ đô của Trung Quốc', expected: 'geonames:city:1816670', response: sentinelResponses.beijing_vi }
  ]
})

async function writeSentinelFixture(nodeDir, sentinelResponses) {
  await mkdir(path.join(nodeDir, 'sentinels'), { recursive: true })
  for (const [id, rel] of Object.entries(sentinelResponses)) {
    await writeFile(path.join(nodeDir, 'sentinels', `${id}.json`), `${JSON.stringify({ id, rank: 1 })}\n`)
  }
  await writeFile(path.join(nodeDir, 'api-sentinel-summary.json'), `${JSON.stringify(apiSentinelSummary(sentinelResponses))}\n`)
}

async function writeExecutable(file, body) {
  await writeFile(file, body, { mode: 0o755 })
}

test('Node bootstrap switches from Node 20 on PATH to a cached Node 22 runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'node22-bootstrap-'))
  try {
    const fakePath = path.join(root, 'path')
    const cachedRoot = path.join(root, 'node-v22.23.2')
    await mkdir(fakePath, { recursive: true })
    await mkdir(path.join(cachedRoot, 'bin'), { recursive: true })
    await writeExecutable(path.join(fakePath, 'node'), '#!/usr/bin/env bash\necho v20.19.0\n')
    await writeExecutable(path.join(cachedRoot, 'bin', 'node'), '#!/usr/bin/env bash\necho v22.23.2\n')

    const { stdout } = await execFileAsync('bash', ['-c', `source "${nodeBootstrap}"; printf 'ACTIVE=%s\\n' "$(node --version)"`], {
      env: {
        ...process.env,
        PATH: `${fakePath}:/usr/bin:/bin`,
        KAGGLE_NODE_ROOT: cachedRoot,
        KAGGLE_NODE_BOOTSTRAP_DOWNLOAD: '0'
      }
    })
    assert.match(stdout, /NODE_SOURCE=cached/)
    assert.match(stdout, /NODE_VERSION=v22\.23\.2/)
    assert.match(stdout, /ACTIVE=v22\.23\.2/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Node bootstrap downloads the pinned Node 22 archive and verifies its SHA256 manifest when no cache exists', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'node22-download-'))
  try {
    const fakePath = path.join(root, 'path')
    const dist = path.join(root, 'dist')
    const versionDir = path.join(dist, 'v22.23.2')
    const payload = path.join(root, 'payload', 'node-v22.23.2-linux-x64')
    const installRoot = path.join(root, 'installed-node')
    await mkdir(fakePath, { recursive: true })
    await mkdir(versionDir, { recursive: true })
    await mkdir(path.join(payload, 'bin'), { recursive: true })
    await writeExecutable(path.join(fakePath, 'node'), '#!/usr/bin/env bash\necho v20.19.0\n')
    await writeExecutable(path.join(payload, 'bin', 'node'), '#!/usr/bin/env bash\necho v22.23.2\n')

    const archiveName = 'node-v22.23.2-linux-x64.tar.xz'
    const archivePath = path.join(versionDir, archiveName)
    await execFileAsync('tar', ['-cJf', archivePath, '-C', path.dirname(payload), path.basename(payload)])
    const { stdout: digestLine } = await execFileAsync('sha256sum', [archivePath])
    const digest = digestLine.trim().split(/\s+/)[0]
    await writeFile(path.join(versionDir, 'SHASUMS256.txt'), `${digest}  ${archiveName}\n`)

    const { stdout } = await execFileAsync('bash', ['-c', `source "${nodeBootstrap}"; printf 'ACTIVE=%s\\n' "$(node --version)"`], {
      env: {
        ...process.env,
        PATH: `${fakePath}:/usr/bin:/bin`,
        KAGGLE_NODE_ROOT: installRoot,
        KAGGLE_NODE_DIST_BASE: `file://${dist}`,
        KAGGLE_NODE_BOOTSTRAP_DOWNLOAD: '1'
      }
    })
    assert.match(stdout, /NODE_SOURCE=downloaded/)
    assert.match(stdout, /NODE_VERSION=v22\.23\.2/)
    assert.match(stdout, /ACTIVE=v22\.23\.2/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fresh Node 22 download under set -euo pipefail (nounset-safe) exits 0', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'node22-fresh-nounset-'))
  try {
    const fakePath = path.join(root, 'path')
    const dist = path.join(root, 'dist')
    const versionDir = path.join(dist, 'v22.23.2')
    const payload = path.join(root, 'payload', 'node-v22.23.2-linux-x64')
    const installRoot = path.join(root, 'installed-node')
    await mkdir(fakePath, { recursive: true })
    await mkdir(versionDir, { recursive: true })
    await mkdir(path.join(payload, 'bin'), { recursive: true })
    await writeExecutable(path.join(fakePath, 'node'), '#!/usr/bin/env bash\necho v20.19.0\n')
    await writeExecutable(path.join(payload, 'bin', 'node'), '#!/usr/bin/env bash\necho v22.23.2\n')

    const archiveName = 'node-v22.23.2-linux-x64.tar.xz'
    const archivePath = path.join(versionDir, archiveName)
    await execFileAsync('tar', ['-cJf', archivePath, '-C', path.dirname(payload), path.basename(payload)])
    const { stdout: digestLine } = await execFileAsync('sha256sum', [archivePath])
    const digest = digestLine.trim().split(/\s+/)[0]
    await writeFile(path.join(versionDir, 'SHASUMS256.txt'), `${digest}  ${archiveName}\n`)

    const contract = [
      'set -euo pipefail',
      'source scripts/kaggle/ensure-node22.sh',
      'printf \'NODE_SOURCE=%s\\n\' "$NODE_SOURCE"',
      'printf \'NODE_VERSION=%s\\n\' "$NODE_VERSION"',
      'printf \'NODE_BINARY=%s\\n\' "$NODE_BINARY"',
      '"$NODE_BINARY" --version'
    ].join('\n')

    const { stdout } = await execFileAsync('bash', ['-c', contract], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakePath}:/usr/bin:/bin`,
        KAGGLE_NODE_ROOT: installRoot,
        KAGGLE_NODE_DIST_BASE: `file://${dist}`,
        KAGGLE_NODE_BOOTSTRAP_DOWNLOAD: '1'
      }
    })
    assert.match(stdout, /NODE_SOURCE=downloaded/)
    assert.match(stdout, /NODE_VERSION=v22\.23\.2/)
    assert.match(stdout, /NODE_BINARY=.*\/installed-node\/bin\/node/)
    assert.match(stdout, /v22\.23\.2/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Node bootstrap fails closed for a fresh download with a bad SHA256 manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'node22-bad-checksum-'))
  try {
    const fakePath = path.join(root, 'path')
    const dist = path.join(root, 'dist')
    const versionDir = path.join(dist, 'v22.23.2')
    const payload = path.join(root, 'payload', 'node-v22.23.2-linux-x64')
    const installRoot = path.join(root, 'installed-node')
    await mkdir(fakePath, { recursive: true })
    await mkdir(versionDir, { recursive: true })
    await mkdir(path.join(payload, 'bin'), { recursive: true })
    await writeExecutable(path.join(fakePath, 'node'), '#!/usr/bin/env bash\necho v20.19.0\n')
    await writeExecutable(path.join(payload, 'bin', 'node'), '#!/usr/bin/env bash\necho v22.23.2\n')

    const archiveName = 'node-v22.23.2-linux-x64.tar.xz'
    const archivePath = path.join(versionDir, archiveName)
    await execFileAsync('tar', ['-cJf', archivePath, '-C', path.dirname(payload), path.basename(payload)])
    await writeFile(path.join(versionDir, 'SHASUMS256.txt'), `${'0'.repeat(64)}  ${archiveName}\n`)

    const contract = [
      'set -euo pipefail',
      'source scripts/kaggle/ensure-node22.sh'
    ].join('\n')

    await assert.rejects(
      execFileAsync('bash', ['-c', contract], {
        cwd: projectRoot,
        env: {
          ...process.env,
          PATH: `${fakePath}:/usr/bin:/bin`,
          KAGGLE_NODE_ROOT: installRoot,
          KAGGLE_NODE_DIST_BASE: `file://${dist}`,
          KAGGLE_NODE_BOOTSTRAP_DOWNLOAD: '1'
        }
      }),
      /Command failed|sha256sum/
    )
    const installed = await readFile(path.join(installRoot, 'bin', 'node')).catch(() => null)
    assert.equal(installed, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Qwen Kaggle wrapper bootstraps Node before invoking the JavaScript resolver', async () => {
  const source = await readFile(qwenWrapper, 'utf8')
  const bootstrapIndex = source.indexOf('ensure-node22.sh')
  const resolverIndex = source.indexOf('node "$RESOLVER" --path-only')
  assert.ok(bootstrapIndex >= 0, 'wrapper must reference ensure-node22.sh')
  assert.ok(resolverIndex >= 0, 'wrapper must invoke resolver with node')
  assert.ok(bootstrapIndex < resolverIndex, 'Node bootstrap must happen before resolver execution')
})

test('evidence packager excludes SHA256SUMS.txt from its own manifest and verifies a re-extracted archive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'evidence-package-'))
  try {
    const review = path.join(root, 'review')
    const out = path.join(root, 'acceptance.zip')
    await mkdir(path.join(review, 'node'), { recursive: true })
    await writeFile(path.join(review, 'result.json'), '{"result":"PASS"}\n')
    await writeFile(path.join(review, 'node', 'health.json'), '{"status":"ok"}\n')

    await execFileAsync('bash', [evidencePackager, review, out])

    const extracted = path.join(root, 'extract')
    await mkdir(extracted)
    await execFileAsync('unzip', ['-q', out, '-d', extracted])
    const manifest = await readFile(path.join(extracted, 'review', 'SHA256SUMS.txt'), 'utf8')
    assert.doesNotMatch(manifest, /SHA256SUMS\.txt/)

    const { stdout } = await execFileAsync('sha256sum', ['-c', 'SHA256SUMS.txt'], {
      cwd: path.join(extracted, 'review')
    })
    assert.match(stdout, /result\.json: OK/)
    assert.match(stdout, /node\/health\.json: OK/)

    const internalVerify = await readFile(`${out}.internal-verify.log`, 'utf8')
    assert.match(internalVerify, /result\.json: OK/)
    assert.match(internalVerify, /node\/health\.json: OK/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('review evidence assembly copies the four sentinel responses before packaging', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'review-assemble-'))
  try {
    const runRoot = path.join(root, 'run')
    const review = path.join(runRoot, 'review')
    const nodeDir = path.join(runRoot, 'node')
    const sentinelResponses = {
      thailand_en: 'node/sentinels/thailand_en.json',
      thailand_vi: 'node/sentinels/thailand_vi.json',
      tokyo_vi: 'node/sentinels/tokyo_vi.json',
      beijing_vi: 'node/sentinels/beijing_vi.json'
    }
    await writeSentinelFixture(nodeDir, sentinelResponses)
    await writeFile(path.join(runRoot, 'result.json'), '{"result":"PASS"}\n')
    await writeFile(path.join(runRoot, 'SUMMARY.md'), '# summary\n')
    await mkdir(path.join(runRoot, 'qdrant'), { recursive: true })
    await writeFile(path.join(runRoot, 'qdrant', 'collection-info.json'), '{}')
    await mkdir(path.join(runRoot, 'memory'), { recursive: true })
    await writeFile(path.join(runRoot, 'memory', 'cgroup-final.txt'), 'oom=0\n')
    await mkdir(path.join(runRoot, 'tests'), { recursive: true })
    await writeFile(path.join(runRoot, 'tests', 'results.txt'), 'all pass\n')
    await mkdir(path.join(runRoot, 'embedding'), { recursive: true })
    await writeFile(path.join(runRoot, 'embedding', 'model.json'), '{}')

    await execFileAsync('bash', [evidenceAssembler, runRoot, review])

    assert.match(await readFile(path.join(review, 'node', 'api-sentinel-summary.json'), 'utf8'), /thailand_en/)
    for (const f of ['thailand_en', 'thailand_vi', 'tokyo_vi', 'beijing_vi']) {
      assert.equal((await readFile(path.join(review, 'node', 'sentinels', `${f}.json`), 'utf8')).trim().length > 0, true, f)
    }

    const out = path.join(root, 'acceptance.zip')
    await execFileAsync('bash', [evidencePackager, review, out])
    const extracted = path.join(root, 'extract')
    await mkdir(extracted)
    await execFileAsync('unzip', ['-q', out, '-d', extracted])
    for (const f of ['thailand_en', 'thailand_vi', 'tokyo_vi', 'beijing_vi']) {
      assert.equal((await readFile(path.join(extracted, 'review', 'node', 'sentinels', `${f}.json`), 'utf8')).trim().length > 0, true, `extracted ${f}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('review evidence assembly fails closed when the summary references a missing sentinel response', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'review-assemble-ref-'))
  try {
    const runRoot = path.join(root, 'run')
    const review = path.join(runRoot, 'review')
    const nodeDir = path.join(runRoot, 'node')
    const sentinelResponses = {
      thailand_en: 'node/sentinels/thailand_en.json',
      thailand_vi: 'node/sentinels/thailand_vi.json',
      tokyo_vi: 'node/sentinels/tokyo_vi.json',
      beijing_vi: 'node/sentinels/beijing_vi.json'
    }
    await writeSentinelFixture(nodeDir, sentinelResponses)
    await rm(path.join(nodeDir, 'sentinels', 'beijing_vi.json'))

    await assert.rejects(
      execFileAsync('bash', [evidenceAssembler, runRoot, review]),
      (error) => {
        assert.match(`${error.stderr}\n${error.message}`, /missing or empty|references a response missing/)
        return true
      }
    )
    assert.equal((await readFile(path.join(review, 'node', 'sentinels', 'beijing_vi.json'), 'utf8').catch(() => null)), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('active Qwen v2.1 acceptance scripts default benchmark provenance to transformers', async () => {
  const files = [
    'scripts/benchmark/v21-production-consistency-acceptance.mjs',
    'scripts/benchmark/post-promotion-v21-api-acceptance.mjs',
    'scripts/benchmark/v21-production-domain-entity-intent-acceptance.mjs',
    'scripts/benchmark/v21-domain-entity-intent.mjs',
    'scripts/benchmark/expanded-noanswer-v21-api.mjs',
    'scripts/benchmark/v21-consistency-verification.mjs'
  ]
  for (const relative of files) {
    const source = await readFile(path.join(projectRoot, relative), 'utf8')
    assert.doesNotMatch(source, /expectedBackend:\s*['"]sentence-transformers['"]/, relative)
    assert.match(source, /BENCHMARK_EMBEDDING_BACKEND\s*\?\?\s*['"]transformers['"]/, relative)
  }
})
