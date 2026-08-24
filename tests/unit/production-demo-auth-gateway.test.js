import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createAuthGateway } from '../../scripts/kaggle/production-demo-auth-gateway.mjs'

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
async function close(server) { await new Promise((resolve) => server.close(resolve)) }
function backend({ searchDelayMs = 0 } = {}) {
  return http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.url === '/api/v1/search' && searchDelayMs) await new Promise((resolve) => setTimeout(resolve, searchDelayMs))
    if (res.destroyed) return
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ path: req.url, method: req.method, body }))
  })
}
async function withPair(options, fn) {
  const backendServer = backend(options)
  const backendPort = await listen(backendServer)
  const gateway = createAuthGateway({ upstream: `http://127.0.0.1:${backendPort}`, token: TOKEN, ...options })
  const gatewayPort = await listen(gateway)
  try { await fn(gatewayPort) } finally { await close(gateway); await close(backendServer) }
}
const auth = { authorization: `Bearer ${TOKEN}` }

test('missing bearer token returns 401', async () => withPair({}, async (port) => {
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 401)
}))

test('authorized allowlisted route is proxied', async () => withPair({}, async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: auth })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).path, '/health')
}))

test('non-allowlisted route returns 404', async () => withPair({}, async (port) => {
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin/reset`, { headers: auth })).status, 404)
}))

test('oversized request body returns 413', async () => withPair({ bodyLimitBytes: 32 }, async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/search`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'x'.repeat(200) })
  })
  assert.equal(response.status, 413)
}))

test('rate limit returns 429', async () => withPair({ rateLimitPerMinute: 1 }, async (port) => {
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers: auth })).status, 200)
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers: auth })).status, 429)
}))

test('search concurrency is one while health remains responsive', async () => withPair({ searchDelayMs: 250, maxSearchConcurrent: 1 }, async (port) => {
  const first = fetch(`http://127.0.0.1:${port}/api/v1/search`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const second = await fetch(`http://127.0.0.1:${port}/api/v1/search`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })
  assert.equal(second.status, 429)
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers: auth })).status, 200)
  assert.equal((await first).status, 200)
}))

test('landing page is public and never embeds the bearer token', async () => withPair({}, async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /Qdrant/)
  assert.doesNotMatch(html, new RegExp(TOKEN))
}))
