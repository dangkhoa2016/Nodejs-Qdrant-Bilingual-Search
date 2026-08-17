import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../..');
const runner = path.join(projectRoot, 'scripts/colab/run-qwen3-embedding-t4.sh');

async function writeExecutable(filePath, content) {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}

async function killPidFile(filePath) {
  try {
    const pid = Number((await readFile(filePath, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

test('Colab Qwen runner backgrounds cloudflared, prints the tunnel URL, and returns control', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'qwen-colab-runner-'));
  const fakeBin = path.join(tempRoot, 'bin');
  const runtimeDir = path.join(tempRoot, 'runtime');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(fakeBin, { recursive: true }));

  await writeExecutable(path.join(fakeBin, 'nvidia-smi'), `#!/usr/bin/env bash
if [[ "$*" == *"--query-gpu="* ]]; then
  echo "Tesla T4, 15360 MiB, 550.54"
fi
exit 0
`);

  await writeExecutable(path.join(fakeBin, 'python'), `#!/usr/bin/env bash
trap 'exit 0' TERM INT
while true; do sleep 1; done
`);

  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
url="${'${!#}'}"
case "$url" in
  */health) exit 0 ;;
  */model) printf '%s\\n' '{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560}' ;;
  *) echo "unexpected curl: $*" >&2; exit 2 ;;
esac
`);

  await writeExecutable(path.join(fakeBin, 'cloudflared'), `#!/usr/bin/env bash
printf '%s\\n' '2026-08-25 INF Requesting new quick Tunnel on trycloudflare.com...' >&2
sleep 0.2
printf '%s\\n' '2026-08-25 INF https://qwen-test.trycloudflare.com' >&2
trap 'exit 0' TERM INT
while true; do sleep 1; done
`);

  try {
    const { stdout } = await execFileAsync('bash', [runner], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        INSTALL_DEPS: '0',
        RUNTIME_DIR: runtimeDir,
        EMBEDDING_STARTUP_ATTEMPTS: '3',
        TUNNEL_STARTUP_ATTEMPTS: '30',
        TUNNEL_STARTUP_INTERVAL_SECONDS: '0.1',
      },
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
    });

    assert.match(stdout, /https:\/\/qwen-test\.trycloudflare\.com/);
    assert.match(stdout, /Embedding URL:/);

    const tunnelUrl = (await readFile(path.join(runtimeDir, 'cloudflared.url'), 'utf8')).trim();
    assert.equal(tunnelUrl, 'https://qwen-test.trycloudflare.com');

    const tunnelPid = Number((await readFile(path.join(runtimeDir, 'cloudflared.pid'), 'utf8')).trim());
    assert.ok(Number.isInteger(tunnelPid) && tunnelPid > 1);
    assert.doesNotThrow(() => process.kill(tunnelPid, 0));
  } finally {
    await killPidFile(path.join(runtimeDir, 'cloudflared.pid'));
    await killPidFile(path.join(runtimeDir, 'embedding.pid'));
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test('Colab Qwen runner fully detaches background services from notebook-owned file descriptors', { timeout: 8_000 }, async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'qwen-colab-detach-'));
  const fakeBin = path.join(tempRoot, 'bin');
  const runtimeDir = path.join(tempRoot, 'runtime');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(fakeBin, { recursive: true }));

  await writeExecutable(path.join(fakeBin, 'nvidia-smi'), `#!/usr/bin/env bash
if [[ "$*" == *"--query-gpu="* ]]; then
  echo "Tesla T4, 15360 MiB, 550.54"
fi
exit 0
`);

  await writeExecutable(path.join(fakeBin, 'python'), `#!/usr/bin/env bash
trap 'exit 0' TERM INT
while true; do sleep 1; done
`);

  await writeExecutable(path.join(fakeBin, 'curl'), `#!/usr/bin/env bash
url="${'${!#}'}"
case "$url" in
  */health) exit 0 ;;
  */model) printf '%s\\n' '{"model":"Qwen/Qwen3-Embedding-4B","dimension":2560}' ;;
  *) echo "unexpected curl: $*" >&2; exit 2 ;;
esac
`);

  await writeExecutable(path.join(fakeBin, 'cloudflared'), `#!/usr/bin/env bash
printf '%s\\n' '2026-08-25 INF https://qwen-detach.trycloudflare.com' >&2
trap 'exit 0' TERM INT
while true; do sleep 1; done
`);

  // fd 3 deliberately duplicates the notebook's stdout capture pipe. A
  // background child that inherits fd 3 can keep a notebook cell busy even
  // after the runner shell itself has exited and printed its final line.
  const child = spawn('bash', ['-c', 'exec 3>&1; exec bash "$1"', 'colab-wrapper', runner], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      INSTALL_DEPS: '0',
      RUNTIME_DIR: runtimeDir,
      EMBEDDING_STARTUP_ATTEMPTS: '3',
      TUNNEL_STARTUP_ATTEMPTS: '30',
      TUNNEL_STARTUP_INTERVAL_SECONDS: '0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const closePromise = new Promise((resolve) => child.once('close', () => resolve(true)));

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.resume();

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runner did not print final message')), 3_000);
      const poll = () => {
        if (stdout.includes('This cell can now return')) {
          clearTimeout(timer);
          resolve();
          return;
        }
        setTimeout(poll, 25);
      };
      poll();
    });

    const closedQuickly = await Promise.race([
      closePromise,
      new Promise((resolve) => setTimeout(() => resolve(false), 500)),
    ]);

    assert.equal(closedQuickly, true, 'runner descendants kept the notebook stdout capture descriptor open');
  } finally {
    await killPidFile(path.join(runtimeDir, 'cloudflared.pid'));
    await killPidFile(path.join(runtimeDir, 'embedding.pid'));
    if (child.exitCode === null) child.kill('SIGTERM');
    await rm(tempRoot, { recursive: true, force: true });
  }
});
