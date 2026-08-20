import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const loadScript = async () => readFile(new URL('../../scripts/benchmark/calibrate-v21-full20k-threshold.mjs', import.meta.url), 'utf8').catch(() => '')

test('package exposes a dedicated v2.1 full-20k threshold calibration command without replacing generic calibration', () => {
  assert.equal(packageJson.scripts['benchmark:calibrate-threshold'], 'node scripts/benchmark/calibrate-threshold.mjs')
  assert.equal(packageJson.scripts['benchmark:calibrate-v21-full20k-threshold'], 'node scripts/benchmark/calibrate-v21-full20k-threshold.mjs')
})

test('v2.1 full-20k threshold CLI defaults to the A/B evidence report and a separate calibration report', async () => {
  const source = await loadScript()
  assert.match(source, /qwen3-4b-text-v1-v21-full20k-collection-ab\.json/)
  assert.match(source, /qwen3-4b-text-v21-full20k-threshold-calibration\.json/)
  assert.match(source, /calibrateFull20kV21Threshold/)
  assert.match(source, /currentProductionThreshold:\s*0\.55/)
})
