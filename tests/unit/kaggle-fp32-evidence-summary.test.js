import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const helper = path.join(projectRoot, 'scripts/kaggle/summarize-fp32-evidence.mjs')

const FIXTURE_RESOURCE_LOG = `meminfo junk line
MemAvailable:       10501628 kB
MemFree:            999999 kB
MemTotal:           33659383808 kB
ps header line pid ppid %cpu %mem rss vsz etime stat cmd
123 1 99.0 50.0 15265780 40000000 00:01 R python scripts/seed/seed.mjs
456 1 20.0 10.0  5000000 30000000 00:01 S qdrant
MemAvailable:    10502000 kB
789 2 30.0 5.0   4000000 20000000 00:01 R node src/server.js
MemAvailable:       10501628 kB
`

test('fp32 evidence summary converts KiB to correct bytes and GiB values', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'kaggle-fp32-evidence-'))
  const resourceLog = path.join(temp, 'resource-monitor.log')
  const resultJson = path.join(temp, 'result.json')
  const resultTxt = path.join(temp, 'RESULT.txt')
  const memorySummary = path.join(temp, 'memory-summary.txt')
  await writeFile(resourceLog, FIXTURE_RESOURCE_LOG, 'utf8')
  try {
    await execFileAsync(process.execPath, [helper,
      '--resource-log', resourceLog,
      '--result-json', resultJson,
      '--result-txt', resultTxt,
      '--memory-summary', memorySummary,
      '--classification', 'PASS'
    ], { cwd: projectRoot })

    const result = JSON.parse(await readFile(resultJson, 'utf8'))
    assert.equal(result.memory.sampled_min_mem_available_bytes, 10501628 * 1024)
    assert.equal(result.memory.sampled_max_process_rss_bytes, 15265780 * 1024)
    assert.ok(Math.abs(result.memory.sampled_min_mem_available_gib - 10.015) < 0.02,
      `giB available expected ~10.015, got ${result.memory.sampled_min_mem_available_gib}`)
    assert.ok(Math.abs(result.memory.sampled_max_process_rss_gib - 14.558) < 0.02,
      `giB rss expected ~14.558, got ${result.memory.sampled_max_process_rss_gib}`)

    const resultTxtContent = await readFile(resultTxt, 'utf8')
    assert.equal(resultTxtContent, 'RESULT=PASS\n')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('fp32 evidence summary emits MemTotal and flags impossible sampled RSS', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'kaggle-fp32-evidence-'))
  const resourceLog = path.join(temp, 'resource-monitor.log')
  const resultJson = path.join(temp, 'result.json')
  const resultTxt = path.join(temp, 'RESULT.txt')
  const memorySummary = path.join(temp, 'memory-summary.txt')
  await writeFile(resourceLog, `MemTotal:       33659384 kB
MemAvailable:   10501628 kB
MemFree:         2000000 kB
123 1 99.0 50.0 40000000 90000000 00:01 R python scripts/seed/seed.mjs
`, 'utf8')
  try {
    await execFileAsync(process.execPath, [helper,
      '--resource-log', resourceLog,
      '--result-json', resultJson,
      '--result-txt', resultTxt,
      '--memory-summary', memorySummary,
      '--classification', 'PASS_CORRECTIVE_HARDENING_FINAL'
    ], { cwd: projectRoot })

    const result = JSON.parse(await readFile(resultJson, 'utf8'))
    assert.equal(result.memory.mem_total_bytes, 33659384 * 1024)
    assert.equal(result.memory.sampled_min_mem_available_bytes, 10501628 * 1024)
    assert.equal(result.memory.sampled_max_process_rss_exceeds_mem_total, true)
    assert.equal(result.memory.sampled_process_rss_interpretation, 'not_physical_footprint_when_exceeds_mem_total')

    const resultTxtContent = await readFile(resultTxt, 'utf8')
    assert.match(resultTxtContent, /RESULT=PASS_CORRECTIVE_HARDENING_FINAL/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
