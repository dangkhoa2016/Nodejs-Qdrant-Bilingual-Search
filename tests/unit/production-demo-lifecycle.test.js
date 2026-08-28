import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const runScript = path.join(projectRoot, 'run.sh')
const lifecycle = path.join(projectRoot, 'scripts/demo/lifecycle.sh')

async function executable(file, content) {
  await writeFile(file, content, 'utf8')
  await chmod(file, 0o755)
}

test('production demo facade exposes start, stop, restart, and status without benchmark or seed commands', async () => {
  await access(runScript)
  const text = await readFile(runScript, 'utf8')
  assert.match(text, /start\|stop\|restart\|status/)
  assert.doesNotMatch(text, /benchmark:v21|acceptance:v21|seed:canonical/)
})

test('lifecycle binds Qdrant and embedding locally and tunnels only the Node API', async () => {
  const text = await readFile(lifecycle, 'utf8')
  assert.match(text, /QDRANT_PORT=\"\$\{QDRANT_PORT:-6333\}\"/)
  assert.match(text, /EMBEDDING_PORT=\"\$\{EMBEDDING_PORT:-8001\}\"/)
  assert.match(text, /API_PORT=\"\$\{PORT:-3000\}\"/)
  assert.match(text, /QDRANT_URL=.*127\.0\.0\.1/)
  assert.match(text, /EMBEDDING_URL=.*127\.0\.0\.1/)
  assert.match(text, /API_URL=.*127\.0\.0\.1/)
  assert.match(text, /cloudflared.*tunnel|tunnel.*cloudflared/s)
  assert.match(text, /--url[" ]+"?http:\/\/127\.0\.0\.1:\$\{?API_PORT/)
  assert.doesNotMatch(text, /--url[" ]+"?http:\/\/127\.0\.0\.1:\$\{?EMBEDDING_PORT/)
})

test('status removes a stale pid file instead of reporting the process as owned', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-status-'))
  const runtime = path.join(temp, 'runtime')
  const logs = path.join(temp, 'logs')
  await mkdir(runtime, { recursive: true })
  await mkdir(logs, { recursive: true })
  await writeFile(path.join(runtime, 'api.pid'), '999999\n')
  await writeFile(path.join(runtime, 'api.sig'), 'src/server.js\n')

  const fakeBin = path.join(temp, 'bin')
  await mkdir(fakeBin, { recursive: true })
  await executable(path.join(fakeBin, 'curl'), '#!/usr/bin/env bash\nexit 22\n')

  try {
    const { stdout } = await execFileAsync('bash', [runScript, 'status'], {
      cwd: projectRoot,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, DEMO_RUNTIME_DIR: runtime, DEMO_LOG_DIR: logs }
    })
    assert.match(stdout, /Node API\s+STOPPED/)
    await assert.rejects(readFile(path.join(runtime, 'api.pid'), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('production demo rejects non-local Qdrant and embedding topology', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-topology-'))
  try {
    const command = `source ${JSON.stringify(lifecycle)}; validate_demo_topology`
    await assert.rejects(
      execFileAsync('bash', ['-lc', command], {
        cwd: projectRoot,
        env: {
          ...process.env,
          DEMO_RUNTIME_DIR: path.join(temp, 'runtime'),
          DEMO_LOG_DIR: path.join(temp, 'logs'),
          QDRANT_URL: 'https://example.com:6333',
          EMBEDDING_URL: 'http://127.0.0.1:8001'
        }
      }),
      /localhost-only|127\.0\.0\.1/
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('failed public tunnel is non-fatal and leaves no owned tunnel process behind', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-tunnel-fail-'))
  const runtime = path.join(temp, 'runtime')
  const logs = path.join(temp, 'logs')
  const cloudflared = path.join(temp, 'cloudflared')
  await executable(cloudflared, '#!/usr/bin/env bash\ntrap "exit 0" TERM INT\nwhile true; do sleep 1; done\n')
  let pid
  try {
    const command = `source ${JSON.stringify(lifecycle)}; start_tunnel; echo TUNNEL_CALL_RC=$?`
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEMO_RUNTIME_DIR: runtime,
        DEMO_LOG_DIR: logs,
        CLOUDFLARED_BIN: cloudflared,
        DEMO_PUBLIC: '1',
        DEMO_TUNNEL_ATTEMPTS: '1',
        DEMO_STARTUP_INTERVAL_SECONDS: '0.01'
      },
      timeout: 3_000
    })
    assert.match(stdout, /TUNNEL_CALL_RC=0/)
    assert.match(stderr, /local demo remains ready/)
    try { pid = Number((await readFile(path.join(runtime, 'tunnel.pid'), 'utf8')).trim()) } catch {}
    await assert.rejects(readFile(path.join(runtime, 'tunnel.pid'), 'utf8'), { code: 'ENOENT' })
  } finally {
    if (Number.isInteger(pid) && pid > 1) { try { process.kill(pid, 'SIGKILL') } catch {} }
    await rm(temp, { recursive: true, force: true })
  }
})

test('production demo never shell-sources .env content', async () => {
  const text = await readFile(lifecycle, 'utf8')
  assert.doesNotMatch(text, /source\s+["']?\$DEMO_ROOT_DIR\/\.env/)
})

test('EMBEDDING_MODEL_PATH is an allowed dotenv key loaded by the explicit allowlist', async () => {
  const text = await readFile(lifecycle, 'utf8')
  assert.match(text, /allowed = new Set\(\[/)
  assert.doesNotMatch(text, /source\s+["']?\$DEMO_ROOT_DIR\/\.env/)
  assert.match(text, /'EMBEDDING_MODEL'/)
  assert.match(text, /'EMBEDDING_MODEL_PATH'/)
})

test('spawn helper that is readable but not executable is accepted because Python executes it', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-spawn-'))
  const runtime = path.join(temp, 'runtime')
  const logs = path.join(temp, 'logs')
  await mkdir(runtime, { recursive: true })
  await mkdir(logs, { recursive: true })
  const helper = path.join(temp, 'spawn-detached.py')
  await writeFile(helper, 'print(99998)\n', 'utf8')
  await chmod(helper, 0o644)

  try {
    const command = `source ${JSON.stringify(lifecycle)}; ` +
      `SPAWN_HELPER=${JSON.stringify(helper)}; ` +
      `pid=$(spawn_owned embed_svc "uvicorn app:app" "$DEMO_ROOT_DIR" python3 -c pass); ` +
      `echo "SPAWN_RC=$? PID=$pid"`
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: { ...process.env, DEMO_RUNTIME_DIR: runtime, DEMO_LOG_DIR: logs }
    })
    assert.match(stdout, /SPAWN_RC=0/)
    assert.match(stdout, /PID=99998/)
    assert.doesNotMatch(stderr, /missing or unreadable/)
    assert.equal((await readFile(path.join(runtime, 'embed_svc.pid'), 'utf8')).trim(), '99998')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('wait_ready returns failure promptly when an owned process has already died', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-deadpid-'))
  const runtime = path.join(temp, 'runtime')
  const logs = path.join(temp, 'logs')
  await mkdir(runtime, { recursive: true })
  await mkdir(logs, { recursive: true })
  await writeFile(path.join(runtime, 'embedding.pid'), '999999\n')
  await writeFile(path.join(runtime, 'embedding.sig'), 'uvicorn app:app\n')

  const start = Date.now()
  try {
    const command = `source ${JSON.stringify(lifecycle)}; ` +
      `DEMO_STARTUP_ATTEMPTS=100000; DEMO_STARTUP_INTERVAL_SECONDS=1; ` +
      `always_fail(){ return 1; }; ` +
      `wait_ready "Embedding service" always_fail embedding; echo "WAIT_RC=$?"`
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: { ...process.env, DEMO_RUNTIME_DIR: runtime, DEMO_LOG_DIR: logs },
      timeout: 5_000
    })
    const elapsed = Date.now() - start
    assert.match(stdout, /WAIT_RC=1/)
    assert.match(stderr, /process exited before readiness/)
    assert.ok(elapsed < 4_000, `expected fast failure, took ${elapsed}ms`)
    await assert.rejects(readFile(path.join(runtime, 'embedding.pid'), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

function canonicalCpuEmbeddingRuntime(overrides = {}) {
  return {
    model: 'Qwen/Qwen3-Embedding-4B',
    dimension: 2560,
    transports: { json: true, float32_binary: true },
    backend: 'sentence-transformers',
    implementation: 'python-fastapi',
    semantic: true,
    accelerator: 'cpu',
    device: 'cpu',
    dtype: 'float32',
    runtime: 'pytorch-cpu',
    profile: 'qwen3',
    query_strategy: 'prompt',
    query_instruction_id: 'geo-retrieval-v1:d014d3ec6df87e49',
    document_strategy: 'raw',
    runtime_contract: 'embedding-runtime-dtype-verified-v1',
    ...overrides
  }
}

async function writeFakeEmbeddingCurl(temp, modelBody) {
  const fakeBin = path.join(temp, 'bin')
  await mkdir(fakeBin, { recursive: true })
  const modelFile = path.join(temp, 'model.json')
  await writeFile(modelFile, `${JSON.stringify(modelBody)}\n`, 'utf8')
  await executable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash\nurl="\${!#}"\ncase "$url" in\n  */health) printf '%s\\n' '{"status":"ok","ready":true}' ;;\n  */model) cat ${JSON.stringify(modelFile)} ;;\n  *) exit 22 ;;\nesac\n`)
  return fakeBin
}

function cpuEmbeddingLifecycleEnv(temp, fakeBin) {
  return {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    DEMO_RUNTIME_DIR: path.join(temp, 'runtime'),
    DEMO_LOG_DIR: path.join(temp, 'logs'),
    DEMO_INSTALL_DEPS: '0',
    EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
    EMBEDDING_DIMENSION: '2560',
    EMBEDDING_PROFILE: 'qwen3',
    EMBEDDING_DEVICE: 'cpu',
    EMBEDDING_DTYPE: 'float32',
    EMBEDDING_BATCH_SIZE: '1',
    EMBEDDING_MAX_SEQ_LENGTH: '512'
  }
}

test('existing embedding service is reused only when the full truthful runtime contract matches', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-embedding-compatible-'))
  try {
    const fakeBin = await writeFakeEmbeddingCurl(temp, canonicalCpuEmbeddingRuntime())
    const command = `source ${JSON.stringify(lifecycle)}; start_embedding`
    const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
      cwd: projectRoot,
      env: cpuEmbeddingLifecycleEnv(temp, fakeBin)
    })
    assert.match(stdout, /Embedding service\s+READY \(external\/reused\)/)
    assert.doesNotMatch(stderr, /runtime contract mismatch/)
    await assert.rejects(readFile(path.join(temp, 'runtime', 'embedding.pid'), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('existing metadata-complete stale embedding service without the truthful runtime marker is refused', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-embedding-stale-'))
  try {
    const stale = canonicalCpuEmbeddingRuntime()
    delete stale.runtime_contract
    const fakeBin = await writeFakeEmbeddingCurl(temp, stale)
    const command = `source ${JSON.stringify(lifecycle)}; start_embedding`
    await assert.rejects(
      execFileAsync('bash', ['-c', command], {
        cwd: projectRoot,
        env: cpuEmbeddingLifecycleEnv(temp, fakeBin)
      }),
      /runtime contract mismatch|refusing reuse/
    )
    await assert.rejects(readFile(path.join(temp, 'runtime', 'embedding.pid'), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('existing embedding service with truthful marker but wrong dtype is refused', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-embedding-wrong-dtype-'))
  try {
    const fakeBin = await writeFakeEmbeddingCurl(temp, canonicalCpuEmbeddingRuntime({ dtype: 'bfloat16' }))
    const command = `source ${JSON.stringify(lifecycle)}; start_embedding`
    await assert.rejects(
      execFileAsync('bash', ['-c', command], {
        cwd: projectRoot,
        env: cpuEmbeddingLifecycleEnv(temp, fakeBin)
      }),
      /dtype expected=float32 actual=bfloat16|runtime contract mismatch|refusing reuse/
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('probe_qdrant_binary accepts a runnable expected-version qdrant binary', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-qdrant-compatible-'))
  try {
    const compatible = path.join(temp, 'qdrant-compatible')
    await executable(compatible, '#!/usr/bin/env bash\necho "qdrant 1.18.3"\n')
    const command = `source ${JSON.stringify(lifecycle)}; QDRANT_VERSION=1.18.3; probe_qdrant_binary ${JSON.stringify(compatible)}; echo "PROBE_RC=$?"`
    const { stdout } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: { ...process.env, DEMO_RUNTIME_DIR: path.join(temp, 'runtime'), DEMO_LOG_DIR: path.join(temp, 'logs') }
    })
    assert.match(stdout, /PROBE_RC=0/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('probe_qdrant_binary rejects a glibc-incompatible qdrant binary', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-qdrant-broken-'))
  try {
    const broken = path.join(temp, 'qdrant-broken')
    await executable(broken, '#!/usr/bin/env bash\necho "qdrant: /lib/x86_64-linux-gnu/libc.so.6: version GLIBC_2.38 not found" >&2\nexit 1\n')
    const command = `source ${JSON.stringify(lifecycle)}; QDRANT_VERSION=1.18.3; probe_qdrant_binary ${JSON.stringify(broken)}; echo "PROBE_RC=$?"`
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: { ...process.env, DEMO_RUNTIME_DIR: path.join(temp, 'runtime'), DEMO_LOG_DIR: path.join(temp, 'logs') }
    })
    assert.match(stdout, /PROBE_RC=1/)
    assert.match(stderr, /rejected Qdrant candidate/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('probe_qdrant_binary rejects a qdrant binary with a version mismatch', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-qdrant-mismatch-'))
  try {
    const mismatch = path.join(temp, 'qdrant-mismatch')
    await executable(mismatch, '#!/usr/bin/env bash\necho "qdrant 1.18.2"\n')
    const command = `source ${JSON.stringify(lifecycle)}; QDRANT_VERSION=1.18.3; probe_qdrant_binary ${JSON.stringify(mismatch)}; echo "PROBE_RC=$?"`
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: { ...process.env, DEMO_RUNTIME_DIR: path.join(temp, 'runtime'), DEMO_LOG_DIR: path.join(temp, 'logs') }
    })
    assert.match(stdout, /PROBE_RC=1/)
    assert.match(stderr, /version=1\.18\.2 expected=1\.18\.3/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('qdrant Linux x86_64 download resolves to the musl release, not the gnu build', async () => {
  const text = await readFile(lifecycle, 'utf8')
  assert.match(text, /qdrant-x86_64-unknown-linux-musl\.tar\.gz/)
  assert.doesNotMatch(text, /qdrant-x86_64-unknown-linux-gnu\.tar\.gz/)
})

test('lifecycle does not become embedding-ready until /health reflects warm-up completion', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'production-demo-warmouted-readiness-'))
  try {
    const fakeBin = path.join(temp, 'bin')
    await mkdir(fakeBin, { recursive: true })
    const callsFile = path.join(temp, 'health.calls')
    await executable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
url="\${!#}"
if [[ "$url" == *'/health' ]]; then
  count=0
  [[ -f ${JSON.stringify(callsFile)} ]] && count=\\"$(wc -l < ${JSON.stringify(callsFile)})\\"
  printf '%s\\n' "$count" >> ${JSON.stringify(callsFile)}
  if [[ "$count" -lt 2 ]]; then
    printf '%s\\n' '{"status":"starting","ready":false}'
    exit 22
  fi
  printf '%s\\n' '{"status":"ok","ready":true,"warmup":{"completed":true,"inference_ms":12.5}}'
  exit 0
else
  exit 22
fi
`)
    const command = `source ${JSON.stringify(lifecycle)}; wait_ready "Embedding service" embedding_ready embedding; echo "WAIT_RC=$?"`
    const { stdout } = await execFileAsync('bash', ['-lc', command], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DEMO_RUNTIME_DIR: path.join(temp, 'runtime'),
        DEMO_LOG_DIR: path.join(temp, 'logs'),
        DEMO_STARTUP_ATTEMPTS: '20',
        DEMO_STARTUP_INTERVAL_SECONDS: '0.01'
      },
      timeout: 5_000
    })
    assert.match(stdout, /WAIT_RC=0/)
    const calls = (await readFile(callsFile, 'utf8')).trim().split('\n')
    assert.ok(calls.length >= 2, `expected lifecycle to poll more than once, got ${calls.length}`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
