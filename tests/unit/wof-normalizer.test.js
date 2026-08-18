import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWofFeature } from '../../src/dataset/wof-normalizer.js'

function feature(properties = {}) {
  return { type: 'Feature', properties, geometry: null }
}

test('normalizeWofFeature extracts exact GeoNames concordance and explicit EN/VI preferred names', () => {
  const result = normalizeWofFeature(feature({
    'wof:id': 101736545,
    'wof:placetype': 'locality',
    'wof:concordances': { 'gn:id': '6077243' },
    'name:eng_x_preferred': ['Montreal'],
    'name:eng_x_variant': ['Montréal city'],
    'name:vie_x_preferred': ['Montréal'],
    'name:vie_x_variant': ['Thành phố Montréal']
  }), { type: 'city' })

  assert.deepEqual(result, {
    wofId: '101736545',
    placetype: 'locality',
    geonamesIds: ['6077243'],
    name: { en: 'Montreal', vi: 'Montréal' },
    aliases: { en: ['Montréal city'], vi: ['Thành phố Montréal'] }
  })
})

test('normalizeWofFeature uses only the primary GeoNames concordance for canonical identity', () => {
  const result = normalizeWofFeature(feature({
    'wof:id': 123,
    'wof:placetype': 'locality',
    'wof:concordances': { 'gn:id': 10 },
    'wof:concordances_alt': { 'gn:id': ['20', 30] },
    'gn:geonameid': '40',
    'name:eng_x_preferred': ['Example']
  }), { type: 'city' })
  assert.deepEqual(result.geonamesIds, ['10'])
})

test('normalizeWofFeature quarantines a WOF record with multiple primary GeoNames identities', () => {
  const result = normalizeWofFeature(feature({
    'wof:id': 126,
    'wof:placetype': 'locality',
    'wof:concordances': { 'gn:id': ['10', '20'] },
    'name:eng_x_preferred': ['Ambiguous']
  }), { type: 'city' })

  assert.equal(result, null)
})

test('normalizeWofFeature does not join records that only expose alternate or imported GeoNames IDs', () => {
  for (const properties of [
    { 'wof:id': 123, 'wof:placetype': 'locality', 'wof:concordances_alt': { 'gn:id': '20' }, 'name:eng_x_preferred': ['Alt'] },
    { 'wof:id': 124, 'wof:placetype': 'locality', 'gn:geonameid': '40', 'name:eng_x_preferred': ['Imported'] }
  ]) {
    assert.equal(normalizeWofFeature(feature(properties), { type: 'city' }), null)
  }
})

test('normalizeWofFeature drops WOF Vietnamese names and aliases containing legacy Eth characters', () => {
  const result = normalizeWofFeature(feature({
    'wof:id': 125,
    'wof:placetype': 'locality',
    'wof:concordances': { 'gn:id': '1584071' },
    'name:eng_x_preferred': ['Da Lat'],
    'name:vie_x_preferred': ['Ðà Lạt', 'Đà Lạt'],
    'name:vie_x_variant': ['Ðalat', 'Thành phố Đà Lạt', 'Hafnarfjörður']
  }), { type: 'city' })

  assert.equal(result.name.vi, 'Đà Lạt')
  assert.deepEqual(result.aliases.vi, ['Thành phố Đà Lạt'])
})

test('normalizeWofFeature rejects incompatible and explicitly non-current records', () => {
  assert.equal(normalizeWofFeature(feature({
    'wof:id': 1, 'wof:placetype': 'region', 'wof:concordances': { 'gn:id': '1' }, 'name:eng_x_preferred': ['Region']
  }), { type: 'city' }), null)
  assert.equal(normalizeWofFeature(feature({
    'wof:id': 2, 'wof:placetype': 'locality', 'mz:is_current': 0, 'wof:concordances': { 'gn:id': '2' }, 'name:eng_x_preferred': ['Old']
  }), { type: 'city' }), null)
})

test('normalizeWofFeature supports country and dependency placetypes only for canonical country entities', () => {
  for (const placetype of ['country', 'dependency']) {
    const result = normalizeWofFeature(feature({
      'wof:id': placetype === 'country' ? 1 : 2,
      'wof:placetype': placetype,
      'wof:concordances': { 'gn:id': placetype === 'country' ? '100' : '200' },
      'name:eng_x_preferred': [placetype]
    }), { type: 'country' })
    assert.equal(result.placetype, placetype)
  }
})
