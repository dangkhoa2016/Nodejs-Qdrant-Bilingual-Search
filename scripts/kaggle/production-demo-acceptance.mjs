#!/usr/bin/env node
import fs from 'node:fs'
import {
  assertCanonicalInfo,
  displayName,
  fetchJson
} from '../../src/demo/production-demo.js'

const SEMANTIC_SENTINEL_CHECKS = 10
const LOCAL_ACCEPTANCE_CHECKS = 13
const PUBLIC_ACCEPTANCE_CHECKS = 14

const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const tokenFile = process.env.DEMO_BEARER_TOKEN_FILE ?? ''
const token = process.env.DEMO_BEARER_TOKEN ?? (tokenFile ? fs.readFileSync(tokenFile, 'utf8').trim() : '')
const isLocalDirect = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):3000$/i.test(apiUrl)
if (!isLocalDirect && !token) throw new Error('public acceptance requires DEMO_BEARER_TOKEN or DEMO_BEARER_TOKEN_FILE')

const authHeaders = token ? { authorization: `Bearer ${token}` } : {}
const machineMarkers = []
let checks = 0
let semanticChecks = 0

const groups = {
  runtime: 0,
  en: 0,
  vi: 0,
  negative: 0,
  public: 0
}

const positiveEvidence = []
const negativeEvidence = []

const positiveCases = Object.freeze([
  Object.freeze({
    id: 'VIETNAM_COUNTRY_EN',
    language: 'en',
    label: 'Country relation: Vietnam',
    query: 'Southeast Asian country with Hanoi as capital and dong as currency',
    expectedName: 'Vietnam',
    expectedId: 'geonames:country:1562822'
  }),
  Object.freeze({
    id: 'SOUTH_KOREA_COUNTRY_EN',
    language: 'en',
    label: 'Country relation: South Korea',
    query: 'East Asian country with Seoul as capital and won as currency',
    expectedName: 'South Korea',
    expectedId: 'geonames:country:1835841'
  }),
  Object.freeze({
    id: 'HO_CHI_MINH_CITY_ALIAS_EN',
    language: 'en',
    label: 'City alias: Ho Chi Minh City',
    query: 'Vietnamese city also known by the Vietnamese alias Sài Gòn',
    expectedName: 'Ho Chi Minh City',
    expectedId: 'geonames:city:1566083'
  }),
  Object.freeze({
    id: 'PARIS_COMPRESSED_EN',
    language: 'en',
    label: 'Compressed capital relation: Paris',
    query: 'France → national capital city',
    expectedName: 'Paris',
    expectedId: 'geonames:city:2988507'
  }),
  Object.freeze({
    id: 'FRANCE_COUNTRY_VI',
    language: 'vi',
    label: 'Quan hệ quốc gia: France',
    query: 'quốc gia châu Âu có thủ đô Paris và sử dụng đồng euro',
    expectedName: 'France',
    expectedId: 'geonames:country:3017382'
  }),
  Object.freeze({
    id: 'LONDON_CAPITAL_VI',
    language: 'vi',
    label: 'Quan hệ thủ đô: London',
    query: 'Thành phố nào là thủ đô Vương quốc Anh?',
    expectedName: 'London',
    expectedId: 'geonames:city:2643743'
  }),
  Object.freeze({
    id: 'BERLIN_CAPITAL_VI',
    language: 'vi',
    label: 'Quan hệ thủ đô: Berlin',
    query: 'thành phố thủ đô của Đức',
    expectedName: 'Berlin',
    expectedId: 'geonames:city:2950159'
  }),
  Object.freeze({
    id: 'UNITED_KINGDOM_COUNTRY_VI',
    language: 'vi',
    label: 'Quan hệ quốc gia: United Kingdom',
    query: 'quốc gia châu Âu có thủ đô Luân Đôn và dùng đồng bảng',
    expectedName: 'United Kingdom',
    expectedId: 'geonames:country:2635167'
  })
])

const negativeCases = Object.freeze([
  Object.freeze({
    id: 'CASABLANCA_MEDIA_EN_NEGATIVE',
    language: 'en',
    label: 'Media-work ambiguity: Casablanca',
    query: 'What is the plot of the movie Casablanca?',
    passNote: 'geographic lexical collision rejected'
  }),
  Object.freeze({
    id: 'CHELSEA_CLUB_VI_NEGATIVE',
    language: 'vi',
    label: 'Sports-club ambiguity: Chelsea',
    query: 'Chelsea Football Club đã giành những danh hiệu nào?',
    passNote: 'non-geographic entity intent rejected'
  })
])

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

function recordPass(marker, group) {
  machineMarkers.push(`PASS ${marker}`)
  checks++
  groups[group]++
}

function assertExpectedTopId(payload, item) {
  const top = payload?.results?.[0]
  if (!top || top.id !== item.expectedId) {
    const observed = top?.id ?? 'no result'
    const name = top ? displayName(top) : ''
    throw new Error(
      `${item.id}: expected top entity ${item.expectedId}, got ${observed}${name ? ` (${name})` : ''}`
    )
  }
  return top
}

function assertNoAnswer(payload, item) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  if (results.length !== 0) {
    const top = results[0]
    throw new Error(
      `${item.id}: expected no production result, got ${top?.id ?? 'unknown'}${displayName(top) ? ` (${displayName(top)})` : ''}`
    )
  }
}

const PRESENTATION_RULE = '─'.repeat(72)
const PRESENTATION_HEADER = '═'.repeat(72)

function printSection(title, items) {
  console.log(title)
  for (const item of items) console.log(`  ✓ ${item}`)
}

function formatScore(value) {
  const score = Number(value)
  return Number.isFinite(score) ? score.toFixed(4) : String(value ?? 'N/A')
}

function printPositiveEvidence(title, evidence) {
  console.log(title)
  console.log(PRESENTATION_RULE)
  for (const { item, top } of evidence) {
    console.log('Query:')
    console.log(`  ${item.query}`)
    console.log('Expected:')
    console.log(`  ${item.expectedName}  [${item.expectedId}]`)
    console.log('Actual:')
    console.log(`  ${displayName(top) || '(unnamed)'}  [${top.id}]`)
    console.log('Score:')
    console.log(`  ${formatScore(top.score)}`)
    console.log('Result:')
    console.log('  ✓ PASS')
    console.log()
  }
}

function printNegativeEvidence(title, evidence) {
  console.log(title)
  console.log(PRESENTATION_RULE)
  for (const { item } of evidence) {
    console.log('Query:')
    console.log(`  ${item.query}`)
    console.log('Expected:')
    console.log('  NO GEOGRAPHIC RESULT')
    console.log('Actual:')
    console.log('  NO RESULT')
    console.log('Result:')
    console.log(`  ✓ PASS — ${item.passNote}`)
    console.log()
  }
}

console.log(PRESENTATION_HEADER)
console.log(' Stable Local Semantic Acceptance — Canonical 20K')
console.log(PRESENTATION_HEADER)

if (!isLocalDirect) {
  const unauth = await fetch(`${apiUrl}/health`)
  if (unauth.status !== 401) throw new Error(`public unauthenticated /health expected 401, got ${unauth.status}`)
  recordPass('public unauthenticated request = 401', 'public')
}

const health = await requestJson('/health')
if (health?.status !== 'ok') throw new Error('/health is not ok')
recordPass('/health', 'runtime')

const ready = await requestJson('/ready')
if (ready?.ready !== true) throw new Error('/ready is not true')
recordPass('/ready', 'runtime')

const info = await requestJson('/api/v1/info')
assertCanonicalInfo(info)
recordPass('canonical /api/v1/info', 'runtime')

for (const item of positiveCases) {
  const payload = await search(item)
  const top = assertExpectedTopId(payload, item)
  positiveEvidence.push({ item, top })
  semanticChecks++
  recordPass(item.id, item.language)
}

for (const item of negativeCases) {
  const payload = await search(item)
  assertNoAnswer(payload, item)
  negativeEvidence.push({ item })
  semanticChecks++
  recordPass(item.id, 'negative')
}

if (semanticChecks !== SEMANTIC_SENTINEL_CHECKS) {
  throw new Error(`semantic sentinel count mismatch: ${semanticChecks} != ${SEMANTIC_SENTINEL_CHECKS}`)
}

const expectedTotal = isLocalDirect ? LOCAL_ACCEPTANCE_CHECKS : PUBLIC_ACCEPTANCE_CHECKS
if (checks !== expectedTotal) {
  throw new Error(`acceptance count mismatch: ${checks} != ${expectedTotal}`)
}

console.log()
printSection('Runtime & API', [
  'Health endpoint',
  'Readiness endpoint',
  'Canonical Qwen3 / 2560d / binary-f32 configuration'
])
console.log()
printPositiveEvidence('English retrieval', positiveEvidence.filter(({ item }) => item.language === 'en'))
printPositiveEvidence('Vietnamese retrieval', positiveEvidence.filter(({ item }) => item.language === 'vi'))
printNegativeEvidence('Intent / no-answer protection', negativeEvidence)

console.log(PRESENTATION_RULE)
console.log(`Runtime & API          ${groups.runtime} / 3 PASS`)
console.log(`English retrieval      ${groups.en} / 4 PASS`)
console.log(`Vietnamese retrieval   ${groups.vi} / 4 PASS`)
console.log(`Intent protection      ${groups.negative} / 2 PASS`)
console.log(`Semantic sentinels    ${semanticChecks} / ${SEMANTIC_SENTINEL_CHECKS} PASS`)
if (!isLocalDirect) console.log(`Public auth gate        ${groups.public} / 1 PASS`)
console.log(`Overall                ${checks} / ${expectedTotal} PASS`)
console.log(PRESENTATION_RULE)

console.log()
console.log('Machine-verifiable markers')
for (const marker of machineMarkers) console.log(marker)
console.log(`PRODUCTION_DEMO_SEMANTIC_PASS=${semanticChecks}`)
console.log(`PRODUCTION_DEMO_ACCEPTANCE_PASS=${checks}`)
