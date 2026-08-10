import { createServer } from 'node:http'
import { URL } from 'node:url'

const PORT = 8001
const MODEL = 'intfloat/multilingual-e5-small'
const DIMENSION = 384
const RUNTIME = { backend: 'mock-deterministic', implementation: 'node-mock', semantic: false }

function generateVector(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  const vec = new Array(DIMENSION)
  for (let i = 0; i < DIMENSION; i++) {
    hash = (hash * 1664525 + 1013904223) >>> 0
    vec[i] = (hash / 0xFFFFFFFF) * 2 - 1
  }
  return vec
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  res.setHeader('Content-Type', 'application/json')

  if (path === '/health') {
    res.writeHead(200)
    res.end(JSON.stringify({ ready: true, model: MODEL, dimension: DIMENSION, ...RUNTIME }))
    return
  }

  if (path === '/model') {
    res.writeHead(200)
    res.end(JSON.stringify({ model: MODEL, dimension: DIMENSION, ...RUNTIME }))
    return
  }

  if (path === '/embed/query' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const { text } = JSON.parse(body)
    const vector = generateVector(text)
    res.writeHead(200)
    res.end(JSON.stringify({ vector }))
    return
  }

  if (path === '/embed/documents' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const { texts } = JSON.parse(body)
    const vectors = texts.map(text => generateVector(text))
    res.writeHead(200)
    res.end(JSON.stringify({ vectors }))
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`Mock embedding server running on http://127.0.0.1:${PORT}`)
})