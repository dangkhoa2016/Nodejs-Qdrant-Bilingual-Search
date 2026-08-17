#!/usr/bin/env node
import { DEMO_QUERIES, assertExpectedTopEntity, assertNoGeographicFalsePositive, search } from '../../src/demo/production-demo.js'

const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
console.log(`Production demo API: ${apiUrl}`)
for (const item of DEMO_QUERIES) {
  const payload = await search(apiUrl, item)
  if (item.negative) {
    assertNoGeographicFalsePositive(payload, item.expected)
    console.log(`PASS [${item.language}] ${item.query} -> no geographic false positive`)
  } else {
    const top = assertExpectedTopEntity(payload, item.expected)
    console.log(`PASS [${item.language}] ${item.query} -> ${item.expected} score=${top.score ?? 'n/a'}`)
  }
}
console.log(`DEMO_PASS=${DEMO_QUERIES.length}/${DEMO_QUERIES.length}`)
