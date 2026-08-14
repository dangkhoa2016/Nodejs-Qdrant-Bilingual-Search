const ALLOWED_LANGUAGES = new Set(['en', 'vi'])
const ALLOWED_ENTITY_TYPES = new Set(['country', 'city'])
const CATEGORY_ENTITY_TYPES = new Map([
  ['country-factual', 'country'],
  ['city-capital', 'city'],
  ['city-alias', 'city'],
  ['no-answer', null]
])

export function validateBenchmarkCases(cases, entities) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('benchmark cases must not be empty')
  if (!Array.isArray(entities) || !entities.length) throw new TypeError('benchmark dataset entities must not be empty')

  const entityById = new Map(entities.map((entity) => [entity?.id, entity]))
  const seenCaseIds = new Set()

  for (const item of cases) {
    const id = String(item?.id ?? '').trim()
    const query = String(item?.query ?? '').trim()
    const category = String(item?.category ?? '').trim()
    const answerable = item?.answerable !== false
    if (!id) throw new TypeError('benchmark case id is required')
    if (seenCaseIds.has(id)) throw new Error(`duplicate benchmark case id: ${id}`)
    seenCaseIds.add(id)
    if (!ALLOWED_LANGUAGES.has(item?.language)) throw new Error(`unsupported benchmark language for ${id}: ${item?.language ?? 'missing'}`)
    if (!category) throw new TypeError(`benchmark category is required for ${id}`)
    if (!CATEGORY_ENTITY_TYPES.has(category)) throw new Error(`unsupported benchmark category for ${id}: ${category}`)
    if (!query) throw new TypeError(`benchmark query is required for ${id}`)
    if (!Array.isArray(item?.expected_ids)) throw new TypeError(`expected_ids is required for ${id}`)

    if (category === 'no-answer') {
      if (answerable) throw new Error(`no-answer benchmark ${id} must declare answerable=false`)
      if (item.expected_ids.length) throw new Error(`no-answer benchmark ${id} must not define expected_ids`)
      continue
    }

    if (!answerable) throw new Error(`answerable benchmark category ${category} cannot declare answerable=false for ${id}`)
    if (!item.expected_ids.length) throw new TypeError(`expected_ids is required for ${id}`)

    const requiredType = CATEGORY_ENTITY_TYPES.get(category)
    for (const expectedId of item.expected_ids) {
      if (/^Q\d+$/i.test(String(expectedId))) {
        throw new Error(`stale Wikidata QID in benchmark ${id}: ${expectedId}`)
      }
      const entity = entityById.get(expectedId)
      if (!entity) throw new Error(`benchmark expected id not present in benchmark dataset: ${expectedId}`)
      if (!ALLOWED_ENTITY_TYPES.has(entity.type)) {
        throw new Error(`unsupported benchmark entity type for ${expectedId}: ${entity.type}`)
      }
      if (entity.type !== requiredType) {
        throw new Error(`benchmark category ${category} requires ${requiredType} expected entity, got ${entity.type} for ${expectedId}`)
      }
    }
  }

  return cases
}
