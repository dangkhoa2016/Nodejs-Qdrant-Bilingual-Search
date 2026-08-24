#!/usr/bin/env node
import http from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, ...headers })
  res.end(payload)
}

function tokenEqual(actual, expected) {
  if (!actual || !expected) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function routeAllowed(method, pathname) {
  if (method === 'GET' && ['/health', '/ready', '/api/v1/info', '/api/v1/stats'].includes(pathname)) return true
  if (method === 'GET' && pathname.startsWith('/api/v1/entities/')) return true
  if (method === 'POST' && pathname === '/api/v1/search') return true
  return false
}

function landingPage() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Node.js + Qdrant + Qwen3 Demo</title><style>body{font:16px system-ui;max-width:850px;margin:48px auto;padding:0 18px;line-height:1.5}input,select,button{font:inherit;padding:10px;margin:4px 0}input{width:min(620px,95%)}pre{white-space:pre-wrap;background:#f3f3f3;padding:14px;border-radius:8px}</style><h1>Node.js + Qdrant + Qwen3 Bilingual Search</h1><p>Authenticated production-oriented demo. Paste the Bearer token shown only inside your private Kaggle session.</p><label>Token<br><input id=t type=password autocomplete=off></label><br><label>Language <select id=l><option>en</option><option>vi</option></select></label><br><label>Query<br><input id=q value="Southeast Asian country whose currency is baht"></label><br><button id=b>Search</button><pre id=o>Ready.</pre><script>b.onclick=async()=>{o.textContent='Searching...';try{const r=await fetch('/api/v1/search',{method:'POST',headers:{authorization:'Bearer '+t.value,'content-type':'application/json'},body:JSON.stringify({query:q.value,language:l.value,limit:5})});o.textContent=JSON.stringify(await r.json(),null,2)}catch(e){o.textContent=String(e)}}</script>`
}

export function createAuthGateway({ upstream = 'http://127.0.0.1:3000', token, maxSearchConcurrent = 1, rateLimitPerMinute = 30, bodyLimitBytes = 32768, upstreamTimeoutMs = 180000, allowedOrigin = '*' } = {}) {
  if (!token || token.length < 32) throw new Error('DEMO_BEARER_TOKEN must contain at least 32 characters')
  const upstreamUrl = new URL(upstream)
  if (!['127.0.0.1', 'localhost', '::1'].includes(upstreamUrl.hostname)) throw new Error('gateway upstream must remain localhost-only')
  let activeSearches = 0
  const buckets = new Map()

  return http.createServer(async (req, res) => {
    const requestId = String(req.headers['x-request-id'] || randomUUID())
    const url = new URL(req.url || '/', 'http://gateway.local')
    const cors = { 'x-request-id': requestId }
    const origin = req.headers.origin
    if (origin && (allowedOrigin === '*' || origin === allowedOrigin)) {
      cors['access-control-allow-origin'] = allowedOrigin === '*' ? '*' : origin
      cors['access-control-allow-headers'] = 'authorization, content-type, x-request-id'
      cors['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const payload = Buffer.from(landingPage())
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': payload.length, ...cors })
      res.end(payload)
      return
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    if (!routeAllowed(req.method, url.pathname)) { sendJson(res, 404, { error: { code: 'NOT_FOUND', request_id: requestId } }, cors); return }

    const authorization = String(req.headers.authorization || '')
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!tokenEqual(supplied, token)) { sendJson(res, 401, { error: { code: 'UNAUTHORIZED', request_id: requestId } }, { 'www-authenticate': 'Bearer', ...cors }); return }

    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
    const minute = Math.floor(Date.now() / 60000)
    const bucketKey = `${ip}:${minute}`
    const used = (buckets.get(bucketKey) || 0) + 1
    buckets.set(bucketKey, used)
    if (used > rateLimitPerMinute) { sendJson(res, 429, { error: { code: 'RATE_LIMITED', request_id: requestId } }, cors); return }

    const isSearch = req.method === 'POST' && url.pathname === '/api/v1/search'
    if (isSearch && activeSearches >= maxSearchConcurrent) { sendJson(res, 429, { error: { code: 'BUSY', request_id: requestId } }, cors); return }
    const declaredLength = Number(req.headers['content-length'] || 0)
    if (declaredLength > bodyLimitBytes) { sendJson(res, 413, { error: { code: 'BODY_TOO_LARGE', request_id: requestId } }, cors); return }

    if (isSearch) activeSearches++
    try {
      const chunks = []
      let total = 0
      for await (const chunk of req) {
        total += chunk.length
        if (total > bodyLimitBytes) { sendJson(res, 413, { error: { code: 'BODY_TOO_LARGE', request_id: requestId } }, cors); return }
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      const headers = { 'x-request-id': requestId }
      for (const name of ['content-type', 'accept', 'user-agent']) if (req.headers[name]) headers[name] = req.headers[name]
      const target = new URL(url.pathname + url.search, upstreamUrl)
      const options = { method: req.method, headers, signal: AbortSignal.timeout(upstreamTimeoutMs) }
      if (!['GET', 'HEAD'].includes(req.method) && body.length) options.body = body
      const upstreamResponse = await fetch(target, options)
      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer())
      const responseHeaders = { ...cors, 'content-length': responseBody.length }
      const contentType = upstreamResponse.headers.get('content-type')
      if (contentType) responseHeaders['content-type'] = contentType
      res.writeHead(upstreamResponse.status, responseHeaders)
      res.end(responseBody)
    } catch (error) {
      if (!res.headersSent) sendJson(res, 502, { error: { code: 'UPSTREAM_ERROR', request_id: requestId } }, cors)
      else res.destroy()
      console.error(JSON.stringify({ event: 'gateway_error', request_id: requestId, message: String(error?.message || error) }))
    } finally {
      if (isSearch) activeSearches--
    }
  })
}

function main() {
  const host = process.env.DEMO_GATEWAY_HOST || '127.0.0.1'
  const port = Number(process.env.DEMO_GATEWAY_PORT || 8090)
  const server = createAuthGateway({
    upstream: process.env.DEMO_GATEWAY_UPSTREAM || 'http://127.0.0.1:3000',
    token: process.env.DEMO_BEARER_TOKEN,
    maxSearchConcurrent: Number(process.env.DEMO_MAX_SEARCH_CONCURRENT || 1),
    rateLimitPerMinute: Number(process.env.DEMO_RATE_LIMIT_PER_MINUTE || 30),
    bodyLimitBytes: Number(process.env.DEMO_BODY_LIMIT_BYTES || 32768),
    upstreamTimeoutMs: Number(process.env.DEMO_UPSTREAM_TIMEOUT_MS || 180000),
    allowedOrigin: process.env.DEMO_ALLOWED_ORIGIN || '*'
  })
  server.listen(port, host, () => console.log(JSON.stringify({ event: 'gateway_ready', host, port })))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
