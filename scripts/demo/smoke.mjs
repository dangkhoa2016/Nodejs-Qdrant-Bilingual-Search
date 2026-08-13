#!/usr/bin/env node
import { assertCanonicalInfo, assertExpectedTopEntity, assertNoGeographicFalsePositive, fetchJson, search } from '../../src/demo/production-demo.js'

const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
let checks = 0
const health = await fetchJson(`${apiUrl}/health`)
if (health?.status !== 'ok') throw new Error('/health is not ok')
console.log('PASS /health'); checks++

const ready = await fetchJson(`${apiUrl}/ready`)
if (ready?.ready !== true) throw new Error('/ready is not true')
console.log('PASS /ready'); checks++

const info = await fetchJson(`${apiUrl}/api/v1/info`)
assertCanonicalInfo(info)
console.log('PASS canonical /api/v1/info'); checks++

const en = await search(apiUrl, { language: 'en', query: 'Southeast Asian country whose capital is Bangkok' })
assertExpectedTopEntity(en, 'Thailand')
console.log('PASS EN semantic search'); checks++

const vi = await search(apiUrl, { language: 'vi', query: 'quốc gia châu Á nổi tiếng với núi Phú Sĩ' })
assertExpectedTopEntity(vi, 'Japan')
console.log('PASS VI semantic search'); checks++

const negative = await search(apiUrl, { language: 'en', query: 'What is the plot of the movie Casablanca?' })
assertNoGeographicFalsePositive(negative, 'Casablanca')
console.log('PASS domain/entity-intent negative'); checks++

const publicUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, '')
if (publicUrl) {
  await fetchJson(`${publicUrl}/health`)
  console.log('PASS public /health'); checks++
}
console.log(`SMOKE_PASS=${checks}`)
