import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const script = path.join(projectRoot, 'scripts/colab/stop-qwen3-embedding.sh')

async function exists(filePath) {
  try { await stat(filePath); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

test('Colab stop script terminates managed processes and purges runtime state without deleting Hugging Face cache', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qwen-colab-stop-'))
  const runtimeDir = path.join(dir, 'runtime')
  const homeDir = path.join(dir, 'home')
  const hfCache = path.join(homeDir, '.cache', 'huggingface')
  await mkdir(runtimeDir, { recursive: true })
  await mkdir(hfCache, { recursive: true })
  await writeFile(path.join(hfCache, 'model-cache-sentinel'), 'keep-me\n')

  const embedding = spawn('bash', ['-c', 'trap "exit 0" TERM INT; while true; do sleep 1; done'], { stdio: 'ignore' })
  const tunnel = spawn('bash', ['-c', 'trap "exit 0" TERM INT; while true; do sleep 1; done'], { stdio: 'ignore' })
  await writeFile(path.join(runtimeDir, 'embedding.pid'), `${embedding.pid}\n`)
  await writeFile(path.join(runtimeDir, 'cloudflared.pid'), `${tunnel.pid}\n`)
  await writeFile(path.join(runtimeDir, 'embedding.log'), 'old log\n')
  await writeFile(path.join(runtimeDir, 'cloudflared.url'), 'https://old.trycloudflare.com\n')

  try {
    const { stdout } = await execFileAsync('bash', [script], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: homeDir,
        RUNTIME_DIR: runtimeDir,
        STOP_FALLBACK_SCAN: '0',
        STOP_WAIT_ATTEMPTS: '20',
        STOP_WAIT_INTERVAL_SECONDS: '0.05'
      },
      timeout: 5_000
    })

    assert.match(stdout, /Hugging Face model cache preserved/)
    assert.equal(await exists(runtimeDir), false)
    assert.equal((await readFile(path.join(hfCache, 'model-cache-sentinel'), 'utf8')).trim(), 'keep-me')
    assert.throws(() => process.kill(embedding.pid, 0), /ESRCH/)
    assert.throws(() => process.kill(tunnel.pid, 0), /ESRCH/)
  } finally {
    for (const child of [embedding, tunnel]) {
      try { process.kill(child.pid, 'SIGKILL') } catch {}
    }
  }
})
