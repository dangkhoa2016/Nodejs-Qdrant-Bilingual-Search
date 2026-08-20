import test from 'node:test'
import assert from 'node:assert/strict'
import { entityPointId, uuidV5 } from '../../src/seed/ids.js'

test('uuidV5 matches RFC-known DNS example', () => {
  assert.equal(uuidV5('www.widgets.com'), '21f7f8de-8051-5b89-8680-0195ef798b6a')
})

test('entityPointId is deterministic from canonical entity identity', () => {
  assert.equal(entityPointId({ id: 'Q869', source: 'wikidata', sourceId: 'Q869' }), entityPointId('Q869'))
  assert.equal(
    entityPointId({ id: 'Q869', source: 'geonames', sourceId: '1605651' }),
    entityPointId({ id: 'Q869', source: 'wikidata', sourceId: 'Q869' })
  )
  assert.notEqual(entityPointId('Q869'), entityPointId('geonames:country:1605651'))
})
