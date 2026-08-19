import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const script = path.join(projectRoot, 'scripts/seed/status.sh')

test('seed status curl sends Qdrant api-key header without leaking the key to stdout', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qdrant-status-'))
  const argsPath = path.join(dir, 'curl.args')
  const fakeCurl = path.join(dir, 'curl')
  await writeFile(fakeCurl, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\nprintf '%s\\n' '{"result":{"status":"green","points_count":4096,"indexed_vectors_count":3000}}'\n`)
  await chmod(fakeCurl, 0o755)

  const { stdout } = await execFileAsync('bash', [script, '--once', '--expected', '20000'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      QDRANT_PROVIDER: 'local',
      QDRANT_URL: 'https://qdrant.example.test',
      QDRANT_API_KEY: 'super-secret',
      QDRANT_COLLECTION: 'knowledge_entities_qwen3_4b_v1'
    }
  })

  const args = await readFile(argsPath, 'utf8')
  assert.match(args, /-H/)
  assert.match(args, /api-key: super-secret/)
  assert.match(args, /https:\/\/qdrant\.example\.test\/collections\/knowledge_entities_qwen3_4b_v1/)
  assert.match(stdout, /4096 \/ 20000/)
  assert.match(stdout, /20\.48%/)
  assert.doesNotMatch(stdout, /super-secret/)
})


test('seed status defaults to the promoted canonical v2.1 collection when no collection override is supplied', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qdrant-status-canonical-'))
  const argsPath = path.join(dir, 'curl.args')
  const fakeCurl = path.join(dir, 'curl')
  await writeFile(fakeCurl, `#!/usr/bin/env bash
printf '%s\n' "$@" > ${JSON.stringify(argsPath)}
printf '%s\n' '{"result":{"status":"green","points_count":20000,"indexed_vectors_count":20000}}'
`)
  await chmod(fakeCurl, 0o755)

  await execFileAsync('bash', [script, '--once', '--expected', '20000'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      QDRANT_PROVIDER: 'local',
      QDRANT_URL: 'https://qdrant.example.test',
      QDRANT_API_KEY: 'secret',
      QDRANT_COLLECTION: ''
    }
  })

  const args = await readFile(argsPath, 'utf8')
  assert.match(args, /collections\/knowledge_entities_qwen3_4b_text_v21/)
})
