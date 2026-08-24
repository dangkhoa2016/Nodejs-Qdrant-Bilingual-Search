#!/usr/bin/env node
import fs from 'node:fs'
import {
  assertCanonicalInfo,
  assertExpectedTopEntity,
  assertNoGeographicFalsePositive,
  fetchJson
} from '../../src/demo/production-demo.js'

const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const tokenFile = process.env.DEMO_BEARER_TOKEN_FILE ?? ''
const token = process.env.DEMO_BEARER_TOKEN ?? (tokenFile ? fs.readFileSync(tokenFile, 'utf8').trim() : '')
const isLocalDirect = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):3000$/i.test(apiUrl)
if (!isLocalDirect && !token) throw new Error('public acceptance requires DEMO_BEARER_TOKEN or DEMO_BEARER_TOKEN_FILE')

const authHeaders = token ? { authorization: `Bearer ${token}` } : {}
let checks = 0

async function requestJson(path, options = {}) {
  return fetchJson(`${apiUrl}${path}`, {
    ...options,
    headers: { ...authHeaders, ...(options.headers ?? {}) }
  })
}

async function search(item) {
  return requestJson('/api/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: item.query, language: item.language, limit: 5 })
  })
}

if (!isLocalDirect) {
  const unauth = await fetch(`${apiUrl}/health`)
  if (unauth.status !== 401) throw new Error(`public unauthenticated /health expected 401, got ${unauth.status}`)
  console.log('PASS public unauthenticated request = 401'); checks++
}

const health = await requestJson('/health')
if (health?.status !== 'ok') throw new Error('/health is not ok')
console.log('PASS /health'); checks++

const ready = await requestJson('/ready')
if (ready?.ready !== true) throw new Error('/ready is not true')
console.log('PASS /ready'); checks++

const info = await requestJson('/api/v1/info')
assertCanonicalInfo(info)
console.log('PASS canonical /api/v1/info'); checks++

const cases = [
  { id: 'THAILAND_EN', language: 'en', query: 'Southeast Asian country whose currency is baht', expected: 'Thailand' },
  { id: 'TOKYO_VI', language: 'vi', query: 'thành phố thủ đô của Nhật Bản', expected: 'Tokyo' },
  { id: 'BEIJING_VI', language: 'vi', query: 'Bắc Kinh, thủ đô của Trung Quốc', expected: 'Beijing' }
]
for (const item of cases) {
  const payload = await search(item)
  assertExpectedTopEntity(payload, item.expected)
  console.log(`PASS ${item.id}`); checks++
}

const negative = await search({ language: 'en', query: 'What is the plot of the movie Casablanca?' })
assertNoGeographicFalsePositive(negative, 'Casablanca')
console.log('PASS CASABLANCA_NEGATIVE'); checks++
console.log(`PRODUCTION_DEMO_ACCEPTANCE_PASS=${checks}`)
