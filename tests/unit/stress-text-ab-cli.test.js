import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const loadScript = async () => readFile(new URL('../../scripts/benchmark/stress-text-v21-ab.mjs', import.meta.url), 'utf8').catch(() => '')

test('package exposes a dedicated v2.1 stress A/B command without changing focused commands', async () => {
  assert.equal(packageJson.scripts['benchmark:text-ab'], 'node scripts/benchmark/focused-text-ab.mjs')
  assert.equal(packageJson.scripts['benchmark:text-ab-v21'], 'node scripts/benchmark/focused-text-v21-ab.mjs')
  assert.equal(packageJson.scripts['benchmark:text-ab-v21-stress'], 'node scripts/benchmark/stress-text-v21-ab.mjs')
})

test('stress CLI defaults to a 750-candidate adversarial run and enforces the 500-1000 validation band', async () => {
  const source = await loadScript()
  assert.match(source, /STRESS_AB_TARGET_SIZE[^\n]*750/)
  assert.match(source, /STRESS_AB_MAX_SIZE[^\n]*1000/)
  assert.match(source, /targetSize < 500/)
  assert.match(source, /maxSize > 1000/)
  assert.match(source, /qwen3-4b-text-v1-v21-stress-ab\.json/)
  assert.match(source, /onlyChangedVariable: 'document embedding text: v1 vs v2\.1'/)
  assert.match(source, /selectedTierCounts: result\.candidateManifest\.selectedTierCounts/)
})
