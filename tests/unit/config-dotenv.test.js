import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const PROJECT_ROOT = new URL('../../', import.meta.url)

test('development config waits for dotenv before module import resolves', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qdrant-config-dotenv-'))
  try {
    const source = await readFile(new URL('../../src/config.js', import.meta.url), 'utf8')
    const canonicalProfile = await readFile(new URL('../../src/canonical-profile.js', import.meta.url), 'utf8')
    await writeFile(join(temp, 'config.js'), source)
    await writeFile(join(temp, 'canonical-profile.js'), canonicalProfile)

    const dotenvDir = join(temp, 'node_modules', 'dotenv')
    await mkdir(dotenvDir, { recursive: true })
    await writeFile(join(dotenvDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
    await writeFile(join(dotenvDir, 'index.js'), `
      await new Promise((resolve) => setTimeout(resolve, 75))
      export function config() { process.env.PORT = '4321' }
    `)

    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `
        const { loadConfig } = await import('./config.js')
        process.stdout.write(String(loadConfig().port))
      `],
      {
        cwd: temp,
        env: { ...process.env, NODE_ENV: 'development', PORT: '' },
        encoding: 'utf8'
      }
    )

    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout, '4321')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
