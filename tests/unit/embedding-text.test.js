import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntity } from '../../src/domain/entity.js'
import { buildEmbeddingText } from '../../src/domain/embedding-text.js'

test('buildEmbeddingText is bilingual, deterministic and excludes null fields', () => {
  const entity = normalizeEntity({
    id: 'Q869', type: 'country', name: { en: 'Thailand', vi: 'Thái Lan' },
    description: { en: 'country in Southeast Asia', vi: 'quốc gia ở Đông Nam Á' },
    continent: 'Asia', region: 'Southeast Asia', countryCode: 'TH',
    facts: { capital: 'Bangkok', currency: 'Thai baht', languages: ['Thai'] }
  })
  const first = buildEmbeddingText(entity)
  const second = buildEmbeddingText(entity)
  assert.deepEqual(first, second)
  assert.equal(first.version, 'v1')
  assert.match(first.text, /Thailand\. Thái Lan\./)
  assert.match(first.text, /Currency: Thai baht\./)
  assert.doesNotMatch(first.text, /null|undefined/)
})


test('embedding text includes normalized country facts for city and landmark retrieval', () => {
  const entity = normalizeEntity({ id: 'Q1490', type: 'city', name: { en: 'Tokyo' }, facts: { country: 'Japan' } })
  assert.match(buildEmbeddingText(entity).text, /Country: Japan\./)
})


test('embedding text v2 builder is available without changing the v1 API', async () => {
  const module = await import('../../src/domain/embedding-text.js')
  assert.equal(typeof module.buildEmbeddingTextV2, 'function')
})


test('embedding text v1 remains byte-for-byte stable for the canonical country shape', () => {
  const entity = normalizeEntity({
    id: 'geonames:country:1605651', type: 'country', name: { en: 'Thailand', vi: 'Thái Lan' },
    description: { en: 'country in Southeast Asia', vi: 'quốc gia ở Đông Nam Á' },
    continent: 'Asia', region: 'Southeast Asia', countryCode: 'TH',
    facts: { capital: 'Bangkok', currency: 'Thai baht', languages: ['Thai'] }, source: 'geonames'
  })
  assert.deepEqual(buildEmbeddingText(entity), {
    version: 'v1',
    text: [
      'Thailand. Thái Lan.',
      'country in Southeast Asia',
      'quốc gia ở Đông Nam Á',
      'Region: Southeast Asia.',
      'Continent: Asia.',
      'Country code: TH.',
      'Capital: Bangkok.',
      'Currency: Thai baht.',
      'Languages: Thai.'
    ].join('\n')
  })
})

test('embedding text v2 expresses country type, capital and currency as explicit bilingual relations', async () => {
  const { buildEmbeddingTextV2 } = await import('../../src/domain/embedding-text.js')
  const entity = normalizeEntity({
    id: 'geonames:country:1861060', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' },
    continent: 'Asia', facts: { capital: 'Tokyo', currency: 'Japanese yen' }, source: 'geonames'
  })
  const result = buildEmbeddingTextV2(entity)
  assert.equal(result.version, 'v2')
  assert.match(result.text, /^Japan\. Nhật Bản\./m)
  assert.match(result.text, /Japan is a country\./)
  assert.match(result.text, /Nhật Bản là một quốc gia\./)
  assert.match(result.text, /The capital city of Japan is Tokyo\./)
  assert.match(result.text, /Thủ đô của Nhật Bản là Tokyo\./)
  assert.match(result.text, /Japan uses Japanese yen as its currency\./)
  assert.match(result.text, /Nhật Bản sử dụng Japanese yen làm tiền tệ\./)
  assert.doesNotMatch(result.text, /Capital: Tokyo\.|Currency: Japanese yen\./)
})

test('embedding text v2 distinguishes a capital city from its country with explicit relations', async () => {
  const { buildEmbeddingTextV2 } = await import('../../src/domain/embedding-text.js')
  const tokyo = normalizeEntity({
    id: 'geonames:city:1850147', type: 'city', name: { en: 'Tokyo', vi: 'Tokyo' },
    facts: { country: 'Japan', capital: true }, source: 'geonames'
  })
  const osaka = normalizeEntity({
    id: 'geonames:city:1853909', type: 'city', name: { en: 'Osaka', vi: 'Osaka' },
    facts: { country: 'Japan', capital: false }, source: 'geonames'
  })
  const tokyoText = buildEmbeddingTextV2(tokyo).text
  const osakaText = buildEmbeddingTextV2(osaka).text
  assert.match(tokyoText, /Tokyo is a city in Japan\./)
  assert.match(tokyoText, /Tokyo is the capital city of Japan\./)
  assert.match(tokyoText, /Tokyo là một thành phố ở Japan\./)
  assert.match(tokyoText, /Tokyo là thủ đô của Japan\./)
  assert.match(osakaText, /Osaka is a city in Japan\./)
  assert.doesNotMatch(osakaText, /capital city of Japan|là thủ đô của Japan/)
})

test('embedding text v2.1 makes country capital relations self-oriented without changing v2', async () => {
  const { buildEmbeddingTextV2, buildEmbeddingTextV21 } = await import('../../src/domain/embedding-text.js')
  assert.equal(typeof buildEmbeddingTextV21, 'function')
  const entity = normalizeEntity({
    id: 'geonames:country:1861060', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' },
    continent: 'Asia', facts: { capital: 'Tokyo', currency: 'Japanese yen' }, source: 'geonames'
  })

  const v2 = buildEmbeddingTextV2(entity)
  const v21 = buildEmbeddingTextV21(entity)

  assert.equal(v21.version, 'v2.1')
  assert.match(v2.text, /The capital city of Japan is Tokyo\./)
  assert.match(v21.text, /Japan has Tokyo as its capital\./)
  assert.match(v21.text, /Nhật Bản có thủ đô là Tokyo\./)
  assert.doesNotMatch(v21.text, /The capital city of Japan is Tokyo\./)
  assert.doesNotMatch(v21.text, /Thủ đô của Nhật Bản là Tokyo\./)
})

test('embedding text v2.1 keeps capital-city document semantics identical to v2', async () => {
  const { buildEmbeddingTextV2, buildEmbeddingTextV21 } = await import('../../src/domain/embedding-text.js')
  const tokyo = normalizeEntity({
    id: 'geonames:city:1850147', type: 'city', name: { en: 'Tokyo', vi: 'Tokyo' },
    facts: { country: 'Japan', capital: true }, source: 'geonames'
  })

  assert.equal(buildEmbeddingTextV21(tokyo).version, 'v2.1')
  assert.equal(buildEmbeddingTextV21(tokyo).text, buildEmbeddingTextV2(tokyo).text)
})

test('embedding text version selector exposes only canonical v1 and approved v2.1 seed profiles', async () => {
  const module = await import('../../src/domain/embedding-text.js')
  assert.equal(typeof module.buildEmbeddingTextByVersion, 'function')

  const entity = normalizeEntity({
    id: 'Q17', type: 'country', name: { en: 'Japan', vi: 'Nhật Bản' },
    facts: { capital: 'Tokyo', currency: 'Japanese yen' }
  })

  assert.deepEqual(module.buildEmbeddingTextByVersion(entity, 'v1'), module.buildEmbeddingText(entity))
  assert.deepEqual(module.buildEmbeddingTextByVersion(entity, 'v2.1'), module.buildEmbeddingTextV21(entity))
  assert.throws(() => module.buildEmbeddingTextByVersion(entity, 'v2'), /unsupported embedding text version/i)
})
