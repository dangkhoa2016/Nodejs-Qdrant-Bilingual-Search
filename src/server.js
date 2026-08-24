import { serve } from '@hono/node-server'
import { createApp } from './http/app.js'
import { loadConfig } from './config.js'
import { createRuntime } from './runtime/create-runtime.js'
import { environmentSnapshot } from './runtime/environment.js'

const config = loadConfig()
const runtime = await createRuntime({ config })
const app = createApp({
  readiness: runtime.readiness,
  searchService: runtime.searchService,
  entityService: runtime.entityService,
  info: () => environmentSnapshot({ config })
})

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`API listening on http://${config.host}:${info.port}`)
})
