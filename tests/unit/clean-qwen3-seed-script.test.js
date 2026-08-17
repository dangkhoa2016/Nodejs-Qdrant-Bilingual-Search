import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const script = path.join(projectRoot, 'scripts/seed/clean-qwen3-seed.sh')

async function exists(filePath) {
  try { await stat(filePath); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function writeExecutable(filePath, body) {
  await writeFile(filePath, body)
  await chmod(filePath, 0o755)
}

test('clean Qwen seed refuses destructive delete without exact confirmation', async () => {
  await assert.rejects(
    execFileAsync('bash', [script], {
      cwd: projectRoot,
      env: {
        ...process.env,
        QDRANT_PROVIDER: 'local',
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'secret',
        QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
        EMBEDDING_URL: 'https://embed.example.test',
        EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
        EMBEDDING_DIMENSION: '2560'
      }
    }),
    /--confirm-delete/
  )
})

test('clean Qwen seed deletes authenticated Qdrant collection, purges old progress, verifies absence, and starts fresh seed with HTTP batch 64', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qwen-clean-seed-'))
  const fakeBin = path.join(dir, 'bin')
  const calls = path.join(dir, 'curl.calls')
  const npmCalls = path.join(dir, 'npm.calls')
  const progressPath = path.join(dir, 'seed-progress.json')
  const eventsPath = path.join(dir, 'seed-progress.jsonl')
  const runDir = path.join(dir, 'run')
  const dataset = path.join(dir, 'entities.final.json')
  await mkdir(fakeBin, { recursive: true })
  await writeFile(progressPath, '{"old":true}\n')
  await writeFile(eventsPath, '{"old":true}\n')
  await writeFile(dataset, '[]\n')

  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(calls)}
method=GET
out=''
write_code=0
url="${'${!#}'}"
args=("$@")
for ((i=0; i<${'$#'}; i++)); do
  case "${'${args[$i]}'}" in
    -X) method="${'${args[$((i+1))]}'}" ;;
    -o) out="${'${args[$((i+1))]}'}" ;;
    -w) write_code=1 ;;
  esac
done
body=''
code=200
state_file=${JSON.stringify(path.join(dir, 'deleted.state'))}
if [[ "$url" == *'/collections/knowledge_entities_qwen3_4b_v1' ]]; then
  if [[ "$method" == DELETE ]]; then
    body='{"result":true,"status":"ok"}'
    code=200
    : > "$state_file"
  elif [[ -f "$state_file" ]]; then
    body='{"status":{"error":"Not found"}}'
    code=404
  else
    body='{"result":{"status":"green","points_count":8120,"indexed_vectors_count":8120}}'
    code=200
  fi
elif [[ "$url" == 'https://embed.example.test/model' ]]; then
  body='{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560,"semantic":true,"profile":"qwen3"}'
  code=200
else
  body='{"result":{}}'
fi
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
if [[ "$write_code" == 1 ]]; then printf '%s' "$code"; fi
`)

  await writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash
printf 'SEED_BATCH_SIZE=%s\\n' "${'${SEED_BATCH_SIZE:-}'}" > ${JSON.stringify(npmCalls)}
printf 'ARGS=%s\\n' "$*" >> ${JSON.stringify(npmCalls)}
printf '%s\\n' '[fake-seed] completed'
`)

  const { stdout } = await execFileAsync('bash', [script,
    '--confirm-delete', 'knowledge_entities_qwen3_4b_v1',
    '--dataset', dataset,
    '--run-dir', runDir
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      QDRANT_PROVIDER: 'local',
      QDRANT_URL: 'https://qdrant.example.test',
      QDRANT_API_KEY: 'super-secret',
      QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
      EMBEDDING_URL: 'https://embed.example.test',
      EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
      EMBEDDING_DIMENSION: '2560',
      SEED_PROGRESS_PATH: progressPath,
      SEED_PROGRESS_EVENTS_PATH: eventsPath,
      DELETE_WAIT_ATTEMPTS: '3',
      DELETE_WAIT_INTERVAL_SECONDS: '0.01'
    },
    timeout: 5_000
  })

  const curlCalls = await readFile(calls, 'utf8')
  const npmCallText = await readFile(npmCalls, 'utf8')
  assert.match(curlCalls, /-H api-key: super-secret/)
  assert.match(curlCalls, /-X DELETE/)
  assert.match(curlCalls, /collections\/knowledge_entities_qwen3_4b_v1/)
  assert.match(curlCalls, /https:\/\/embed\.example\.test\/model/)
  assert.doesNotMatch(stdout, /super-secret/)
  assert.match(stdout, /confirmed absent/)
  assert.match(stdout, /Starting fresh seed/)
  assert.match(npmCallText, /SEED_BATCH_SIZE=64/)
  assert.match(npmCallText, /run seed:existing --/)
  assert.equal(await exists(progressPath), false)
  assert.equal(await exists(eventsPath), false)
})

test('clean Qwen seed hard-refuses deletion of the preserved E5 baseline collection', async () => {
  await assert.rejects(
    execFileAsync('bash', [script, '--confirm-delete', 'knowledge_entities_e5_real_v1'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        QDRANT_PROVIDER: 'local',
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'secret',
        QDRANT_COLLECTION: 'knowledge_entities_e5_real_v1',
        EMBEDDING_URL: 'https://embed.example.test',
        EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
        EMBEDDING_DIMENSION: '2560'
      }
    }),
    /protected E5 baseline/
  )
})

test('clean Qwen seed keeps explicit process environment values ahead of stale .env values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qwen-clean-env-precedence-'))
  const tempScriptDir = path.join(dir, 'scripts', 'seed')
  const fakeBin = path.join(dir, 'bin')
  const dataset = path.join(dir, 'data', 'generated', 'entities.final.json')
  const copiedScript = path.join(tempScriptDir, 'clean-qwen3-seed.sh')
  const curlCalls = path.join(dir, 'curl.calls')
  await mkdir(tempScriptDir, { recursive: true })
  await mkdir(fakeBin, { recursive: true })
  await mkdir(path.dirname(dataset), { recursive: true })
  await writeFile(copiedScript, await readFile(script))
  await chmod(copiedScript, 0o755)
  await writeFile(dataset, '[]\n')
  await writeFile(path.join(dir, '.env'), [
    'QDRANT_PROVIDER=local',
    'QDRANT_URL=https://stale-qdrant.example.test',
    'QDRANT_API_KEY=stale-key',
    'QDRANT_COLLECTION=stale_collection',
    'EMBEDDING_URL=https://stale-embed.example.test',
    'EMBEDDING_MODEL=stale-model',
    'EMBEDDING_DIMENSION=111',
    'EMBEDDING_TEXT_VERSION=v1'
  ].join('\n') + '\n')

  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(curlCalls)}
url="${'${!#}'}"
out=''
args=("$@")
for ((i=0; i<${'$#'}; i++)); do
  [[ "${'${args[$i]}'}" == '-o' ]] && out="${'${args[$((i+1))]}'}"
done
if [[ "$url" == 'https://fresh-embed.example.test/model' ]]; then
  body='{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560,"semantic":true}'
  code=200
elif [[ "$url" == *'/collections/fresh_collection' ]]; then
  body='{"status":{"error":"Not found"}}'
  code=404
else
  body='{"error":"unexpected stale endpoint"}'
  code=500
fi
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
if [[ "$*" == *'%{http_code}'* ]]; then printf '%s' "$code"; fi
exit 0
`)
  await writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash\nprintf 'EMBEDDING_TEXT_VERSION=%s\\n' "${'${EMBEDDING_TEXT_VERSION:-}'}"\nprintf '%s\\n' '[fake-seed] completed'\n`)

  const { stdout } = await execFileAsync('bash', [copiedScript,
    '--confirm-delete', 'fresh_collection',
    '--dataset', dataset,
    '--run-dir', path.join(dir, 'run')
  ], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      QDRANT_PROVIDER: 'local',
      QDRANT_URL: 'https://fresh-qdrant.example.test',
      QDRANT_API_KEY: 'fresh-key',
      QDRANT_COLLECTION: 'fresh_collection',
      EMBEDDING_URL: 'https://fresh-embed.example.test',
      EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
      EMBEDDING_DIMENSION: '2560',
      EMBEDDING_TEXT_VERSION: 'v2.1'
    },
    timeout: 5_000
  })

  const calls = await readFile(curlCalls, 'utf8')
  assert.match(calls, /https:\/\/fresh-qdrant\.example\.test\/collections\/fresh_collection/)
  assert.match(calls, /api-key: fresh-key/)
  assert.match(calls, /https:\/\/fresh-embed\.example\.test\/model/)
  assert.doesNotMatch(calls, /stale-/)
  assert.match(stdout, /fresh_collection/)
  assert.match(stdout, /EMBEDDING_TEXT_VERSION=v2\.1/)
})

test('clean Qwen seed requires an API key even for destructive local-provider cleanup', async () => {
  await assert.rejects(
    execFileAsync('bash', [script, '--confirm-delete', 'knowledge_entities_qwen3_4b_v1'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        QDRANT_PROVIDER: 'local',
        QDRANT_URL: 'http://127.0.0.1:6333',
        QDRANT_API_KEY: '',
        QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
        EMBEDDING_URL: 'https://embed.example.test',
        EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
        EMBEDDING_DIMENSION: '2560'
      }
    }),
    /Qdrant API key is required/
  )
})

test('clean Qwen seed stops an active previous seed process before deleting the collection', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qwen-clean-stop-old-seed-'))
  const fakeBin = path.join(dir, 'bin')
  const dataset = path.join(dir, 'entities.final.json')
  await mkdir(fakeBin, { recursive: true })
  await writeFile(dataset, '[]\n')

  const oldSeed = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'scripts/seed/existing.mjs'], { stdio: 'ignore' })
  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
url="${'${!#}'}"
out=''
args=("$@")
for ((i=0; i<${'$#'}; i++)); do
  [[ "${'${args[$i]}'}" == '-o' ]] && out="${'${args[$((i+1))]}'}"
done
if [[ "$url" == *'/collections/knowledge_entities_qwen3_4b_v1' ]]; then
  body='{"status":{"error":"Not found"}}'; code=404
else
  body='{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560,"semantic":true}'; code=200
fi
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
if [[ "$*" == *'%{http_code}'* ]]; then printf '%s' "$code"; fi
exit 0
`)
  await writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash\nprintf '%s\\n' '[fake-seed] completed'\n`)

  try {
    const { stdout } = await execFileAsync('bash', [script,
      '--confirm-delete', 'knowledge_entities_qwen3_4b_v1',
      '--dataset', dataset,
      '--run-dir', path.join(dir, 'run')
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        QDRANT_PROVIDER: 'local',
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'secret',
        QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
        EMBEDDING_URL: 'https://embed.example.test',
        EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
        EMBEDDING_DIMENSION: '2560',
        SEED_STOP_WAIT_ATTEMPTS: '20',
        SEED_STOP_WAIT_INTERVAL_SECONDS: '0.05'
      },
      timeout: 5_000
    })
    assert.match(stdout, /Stopping previous seed PID/)
    assert.throws(() => process.kill(oldSeed.pid, 0), /ESRCH/)
  } finally {
    try { process.kill(oldSeed.pid, 'SIGKILL') } catch {}
  }
})

test('clean Qwen seed does not stop a non-Node process whose argv mentions a seed script', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qwen-clean-ignore-non-node-seed-'))
  const fakeBin = path.join(dir, 'bin')
  const dataset = path.join(dir, 'entities.final.json')
  await mkdir(fakeBin, { recursive: true })
  await writeFile(dataset, '[]\n')

  const decoy = spawn(
    'bash',
    ['-c', 'exec -a "scripts/seed/existing.mjs" sleep 30'],
    { stdio: 'ignore' }
  )

  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
url="${'${!#}'}"
out=''
args=("$@")
for ((i=0; i<${'$#'}; i++)); do
  [[ "${'${args[$i]}'}" == '-o' ]] && out="${'${args[$((i+1))]}'}"
done
if [[ "$url" == *'/collections/knowledge_entities_qwen3_4b_v1' ]]; then
  body='{"status":{"error":"Not found"}}'; code=404
else
  body='{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560,"semantic":true}'; code=200
fi
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
if [[ "$*" == *'%{http_code}'* ]]; then printf '%s' "$code"; fi
exit 0
`)

  await writeExecutable(
    path.join(fakeBin, 'npm'),
    `#!/usr/bin/env bash\nprintf '%s\\n' '[fake-seed] completed'\n`
  )

  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.doesNotThrow(() => process.kill(decoy.pid, 0))

    const { stdout } = await execFileAsync('bash', [script,
      '--confirm-delete', 'knowledge_entities_qwen3_4b_v1',
      '--dataset', dataset,
      '--run-dir', path.join(dir, 'run')
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        QDRANT_PROVIDER: 'local',
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'secret',
        QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
        EMBEDDING_URL: 'https://embed.example.test',
        EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
        EMBEDDING_DIMENSION: '2560',
        SEED_STOP_WAIT_ATTEMPTS: '20',
        SEED_STOP_WAIT_INTERVAL_SECONDS: '0.05'
      },
      timeout: 5_000
    })

    assert.doesNotMatch(
      stdout,
      new RegExp(`Stopping previous seed PID ${decoy.pid}`)
    )
    assert.doesNotThrow(() => process.kill(decoy.pid, 0))
  } finally {
    try { process.kill(decoy.pid, 'SIGKILL') } catch {}
  }
})

test('clean Qwen seed fails closed before seed when binary-f32 transport is not advertised', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qwen-clean-binary-preflight-'))
  const fakeBin = path.join(dir, 'bin')
  const dataset = path.join(dir, 'entities.final.json')
  const npmMarker = path.join(dir, 'npm.called')
  await mkdir(fakeBin, { recursive: true })
  await writeFile(dataset, '[]\n')

  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
url="${'${!#}'}"
out=''
args=("$@")
for ((i=0; i<${'$#'}; i++)); do
  [[ "${'${args[$i]}'}" == '-o' ]] && out="${'${args[$((i+1))]}'}"
done
if [[ "$url" == *'/collections/knowledge_entities_qwen3_4b_v1' ]]; then
  body='{"status":{"error":"Not found"}}'; code=404
elif [[ "$url" == 'https://embed.example.test/model' ]]; then
  body='{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560,"semantic":true,"transports":{"json":true,"float32_binary":false}}'; code=200
else
  body='{}'; code=200
fi
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
if [[ "$*" == *'%{http_code}'* ]]; then printf '%s' "$code"; fi
`)
  await writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash\n: > ${JSON.stringify(npmMarker)}\n`)

  await assert.rejects(
    execFileAsync('bash', [script,
      '--confirm-delete', 'knowledge_entities_qwen3_4b_v1',
      '--dataset', dataset,
      '--run-dir', path.join(dir, 'run')
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        QDRANT_PROVIDER: 'local',
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'secret',
        QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1',
        EMBEDDING_URL: 'https://embed.example.test',
        EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-4B',
        EMBEDDING_DIMENSION: '2560',
        EMBEDDING_TRANSPORT: 'binary-f32'
      },
      timeout: 5_000
    }),
    /binary-f32 transport/i
  )
  assert.equal(await exists(npmMarker), false)
})
