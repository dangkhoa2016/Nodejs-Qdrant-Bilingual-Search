#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'

const KIB = 1024
const GIB = 1024 ** 3

const kibToBytes = (kib) => kib * KIB
const bytesToGiB = (bytes) => bytes / GIB

function parseArgs(argv) {
  const args = { resourceLog: null, resultJson: null, resultTxt: null, memorySummary: null, classification: null, metaJson: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--resource-log': args.resourceLog = value; i += 1; break
      case '--result-json': args.resultJson = value; i += 1; break
      case '--result-txt': args.resultTxt = value; i += 1; break
      case '--memory-summary': args.memorySummary = value; i += 1; break
      case '--classification': args.classification = value; i += 1; break
      case '--meta-json': args.metaJson = value; i += 1; break
      default:
        throw new Error(`unknown argument: ${flag}`)
    }
  }
  for (const key of ['resourceLog', 'resultJson', 'resultTxt', 'memorySummary']) {
    if (!args[key]) throw new Error(`missing required argument: --${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`)
  }
  return args
}

function parseResourceLog(content) {
  const memTotalKb = []
  const memAvailableKb = []
  const rssKb = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const memTotal = line.match(/^MemTotal:\s*(\d+)\s*kB/i)
    if (memTotal) {
      memTotalKb.push(Number(memTotal[1]))
      continue
    }
    const mem = line.match(/^MemAvailable:\s*(\d+)\s*kB/i)
    if (mem) {
      memAvailableKb.push(Number(mem[1]))
      continue
    }
    // ps -eo pid,ppid,%cpu,%mem,rss,vsz,etime,stat,cmd rows; rss is the 5th field (kB/KiB).
    const psRow = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+.*$/)
    if (psRow) {
      rssKb.push(Number(psRow[5]))
    }
  }
  return { memTotalKb, memAvailableKb, rssKb }
}

function buildMemoryAccounting(memTotalKb, memAvailableKb, rssKb) {
  const accounting = {
    mem_total_bytes: null,
    mem_total_gib: null,
    sampled_min_mem_available_bytes: null,
    sampled_min_mem_available_gib: null,
    sampled_max_process_rss_bytes: null,
    sampled_max_process_rss_gib: null,
    sampled_max_process_rss_exceeds_mem_total: false,
    sampled_process_rss_interpretation: null,
    resource_monitor_samples: null,
  }
  if (memTotalKb.length > 0) {
    // First MemTotal line is the authoritative one from /proc/meminfo.
    const totalBytes = kibToBytes(memTotalKb[0])
    accounting.mem_total_bytes = totalBytes
    accounting.mem_total_gib = Math.round(bytesToGiB(totalBytes) * 100) / 100
  }
  if (memAvailableKb.length > 0) {
    const minKb = Math.min(...memAvailableKb)
    const bytes = kibToBytes(minKb)
    accounting.sampled_min_mem_available_bytes = bytes
    accounting.sampled_min_mem_available_gib = Math.round(bytesToGiB(bytes) * 1000) / 1000
  }
  if (rssKb.length > 0) {
    const maxKb = Math.max(...rssKb)
    const bytes = kibToBytes(maxKb)
    accounting.sampled_max_process_rss_bytes = bytes
    accounting.sampled_max_process_rss_gib = Math.round(bytesToGiB(bytes) * 1000) / 1000
  }
  if (accounting.sampled_max_process_rss_bytes !== null && accounting.mem_total_bytes !== null
      && accounting.sampled_max_process_rss_bytes > accounting.mem_total_bytes) {
    accounting.sampled_max_process_rss_exceeds_mem_total = true
    accounting.sampled_process_rss_interpretation = 'not_physical_footprint_when_exceeds_mem_total'
  }
  return accounting
}

function buildMemorySummary(accounting) {
  const lines = []
  lines.push(`resource_monitor_samples=${accounting.resource_monitor_samples}`)
  if (accounting.mem_total_bytes !== null) {
    lines.push(`mem_total_bytes=${accounting.mem_total_bytes}`)
    lines.push(`mem_total_gib=${accounting.mem_total_gib}`)
    lines.push(`sampled_max_process_rss_exceeds_mem_total=${accounting.sampled_max_process_rss_exceeds_mem_total}`)
  }
  lines.push(`sampled_max_process_rss_bytes=${accounting.sampled_max_process_rss_bytes}`)
  lines.push(`sampled_max_process_rss_gib=${accounting.sampled_max_process_rss_gib}`)
  if (accounting.sampled_process_rss_interpretation !== null) {
    lines.push(`sampled_process_rss_interpretation=${accounting.sampled_process_rss_interpretation}`)
  }
  lines.push(`sampled_min_mem_available_bytes=${accounting.sampled_min_mem_available_bytes}`)
  lines.push(`sampled_min_mem_available_gib=${accounting.sampled_min_mem_available_gib}`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const resourceLogContent = await readFile(args.resourceLog, 'utf8')
  const { memTotalKb, memAvailableKb, rssKb } = parseResourceLog(resourceLogContent)
  const memory = buildMemoryAccounting(memTotalKb, memAvailableKb, rssKb)
  memory.resource_monitor_samples = Math.max(memAvailableKb.length, rssKb.length)

  let result = {
    classification: args.classification,
    memory,
  }
  if (args.metaJson) {
    const meta = JSON.parse(await readFile(args.metaJson, 'utf8'))
    result = { ...result, ...meta, memory: { ...(meta.memory || {}), ...memory } }
  }

  await writeFile(args.resultJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  await writeFile(args.memorySummary, buildMemorySummary(memory), 'utf8')
  await writeFile(args.resultTxt, `RESULT=${args.classification}\n`, 'utf8')
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`)
  process.exit(1)
})
