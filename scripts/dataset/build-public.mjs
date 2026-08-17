#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseDatasetBuildArgs } from '../../src/cli/options.js'
import { buildPublicDataset } from '../../src/dataset/public-builder.js'

const options = parseDatasetBuildArgs(process.argv.slice(2))
const result = await buildPublicDataset({
  sources: options.sources,
  types: options.types,
  limit: options.limit,
  wofOptions: {
    cacheDir: resolve(options.wofCacheDir),
    refresh: options.wofRefresh
  }
})

const output = resolve(options.output)
const manifest = resolve(options.manifest)
await mkdir(dirname(output), { recursive: true })
await mkdir(dirname(manifest), { recursive: true })
await writeFile(output, `${JSON.stringify(result.entities, null, 2)}\n`, 'utf8')
await writeFile(manifest, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output, manifest, ...result.manifest }, null, 2))
