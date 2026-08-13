function unique(values) {
  return [...new Set(values)]
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`)
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : ''
}

function entityTextHaystack(entity) {
  return [
    entity.name?.en,
    entity.name?.vi,
    ...(entity.aliases?.en ?? []),
    ...(entity.aliases?.vi ?? []),
    entity.region,
    entity.description?.en,
    entity.description?.vi
  ].map(normalizedText).filter(Boolean).join('\n')
}

function collectExpectedContext(expectedEntities) {
  const countryNames = new Set()
  const countryCodes = new Set()
  const regions = new Set()
  const capitalNames = new Set()

  for (const entity of expectedEntities) {
    if (entity.type === 'country') {
      if (entity.name?.en) countryNames.add(entity.name.en.trim())
      if (entity.name?.vi) countryNames.add(entity.name.vi.trim())
      if (typeof entity.facts?.capital === 'string' && entity.facts.capital.trim()) capitalNames.add(entity.facts.capital.trim())
    }
    if (entity.type === 'city') {
      if (typeof entity.facts?.country === 'string' && entity.facts.country.trim()) countryNames.add(entity.facts.country.trim())
      if (entity.facts?.capital === true) {
        if (entity.name?.en) capitalNames.add(entity.name.en.trim())
        if (entity.name?.vi) capitalNames.add(entity.name.vi.trim())
      }
    }
    if (entity.countryCode) countryCodes.add(entity.countryCode)
    if (entity.region) regions.add(entity.region)
  }

  return { countryNames, countryCodes, regions, capitalNames }
}

function isCapitalLocality(entity, capitalNames) {
  if (entity.type !== 'city' || entity.facts?.capital === true || !capitalNames.size) return false
  const haystack = entityTextHaystack(entity)
  return [...capitalNames].some((name) => {
    const needle = normalizedText(name)
    return needle && haystack.includes(needle)
  })
}

function isRelatedCity(entity, context) {
  if (entity.type !== 'city' || entity.facts?.capital === true) return false
  const country = typeof entity.facts?.country === 'string' ? entity.facts.country.trim() : ''
  return Boolean(
    (country && context.countryNames.has(country)) ||
    (entity.countryCode && context.countryCodes.has(entity.countryCode)) ||
    (entity.region && context.regions.has(entity.region))
  )
}

function populationSort(left, right) {
  const leftPopulation = Number.isFinite(left.population) ? left.population : -1
  const rightPopulation = Number.isFinite(right.population) ? right.population : -1
  return rightPopulation - leftPopulation || left.id.localeCompare(right.id)
}

export function buildStressCandidateSet({ cases, hardReport, entities, targetSize = 750, maxSize = 1000 }) {
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('cases must not be empty')
  if (!hardReport || !Array.isArray(hardReport.rows)) throw new TypeError('hardReport.rows must be an array')
  if (!Array.isArray(entities) || !entities.length) throw new TypeError('entities must not be empty')
  assertPositiveInteger(targetSize, 'targetSize')
  assertPositiveInteger(maxSize, 'maxSize')
  if (targetSize > maxSize) throw new RangeError('targetSize must be <= maxSize')

  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const caseById = new Map(cases.map((item) => [item.id, item]))
  const expectedIds = unique(cases.flatMap((item) => Array.isArray(item?.expected_ids) ? item.expected_ids : []))
  for (const id of expectedIds) {
    if (!entityById.has(id)) throw new Error(`expected entity is missing from dataset: ${id}`)
  }

  const observedDistractorIds = []
  for (const row of hardReport.rows) {
    const benchmarkCase = caseById.get(row?.id)
    if (!benchmarkCase) continue
    const expectedForCase = new Set(benchmarkCase.expected_ids ?? [])
    for (const result of row.topResults ?? []) {
      const id = result?.id
      if (!id || expectedForCase.has(id) || observedDistractorIds.includes(id)) continue
      if (!entityById.has(id)) throw new Error(`hard-report distractor is missing from dataset: ${id}`)
      observedDistractorIds.push(id)
    }
  }

  const allCountryIds = entities.filter((entity) => entity.type === 'country').map((entity) => entity.id).sort()
  const allCapitalCityIds = entities
    .filter((entity) => entity.type === 'city' && entity.facts?.capital === true)
    .map((entity) => entity.id)
    .sort()

  const expectedEntities = expectedIds.map((id) => entityById.get(id))
  const context = collectExpectedContext(expectedEntities)
  const capitalLocalityIds = entities
    .filter((entity) => isCapitalLocality(entity, context.capitalNames))
    .sort(populationSort)
    .map((entity) => entity.id)
  const relatedMajorCityIds = entities
    .filter((entity) => isRelatedCity(entity, context))
    .sort(populationSort)
    .map((entity) => entity.id)
  const globalMajorCityIds = entities
    .filter((entity) => entity.type === 'city' && entity.facts?.capital !== true)
    .sort(populationSort)
    .map((entity) => entity.id)
  const deterministicFillerIds = entities.map((entity) => entity.id).sort()

  const candidateReasons = {}
  const addReason = (ids, reason) => {
    for (const id of ids) {
      if (!candidateReasons[id]) candidateReasons[id] = []
      if (!candidateReasons[id].includes(reason)) candidateReasons[id].push(reason)
    }
  }
  addReason(expectedIds, 'expected')
  addReason(observedDistractorIds, 'hard-report-distractor')
  addReason(allCountryIds, 'all-country')
  addReason(allCapitalCityIds, 'all-capital-city')
  addReason(capitalLocalityIds, 'capital-locality')
  addReason(relatedMajorCityIds, 'related-major-city')
  addReason(globalMajorCityIds, 'global-major-city')

  const mandatoryIds = unique([...allCountryIds, ...allCapitalCityIds, ...expectedIds, ...observedDistractorIds])
  if (mandatoryIds.length > maxSize) {
    throw new RangeError(`mandatory stress candidates (${mandatoryIds.length}) exceed maxSize (${maxSize})`)
  }

  const selectedIds = []
  const selected = new Set()
  const selectionTierById = {}
  const appendIds = (ids, tier, stopAtTarget) => {
    for (const id of ids) {
      if (stopAtTarget && selectedIds.length >= targetSize) break
      if (selected.has(id)) continue
      selected.add(id)
      selectedIds.push(id)
      selectionTierById[id] = tier
    }
  }

  appendIds(allCountryIds, 'all-country', false)
  appendIds(allCapitalCityIds, 'all-capital-city', false)
  appendIds(expectedIds, 'expected', false)
  appendIds(observedDistractorIds, 'hard-report-distractor', false)
  appendIds(capitalLocalityIds, 'capital-locality', true)
  appendIds(relatedMajorCityIds, 'related-major-city', true)
  appendIds(globalMajorCityIds, 'global-major-city', true)
  appendIds(deterministicFillerIds, 'deterministic-filler', true)

  if (selectedIds.length < targetSize) {
    throw new Error(`could only build ${selectedIds.length} stress candidates; targetSize ${targetSize} is not satisfiable from this dataset`)
  }
  if (selectedIds.length > maxSize) throw new RangeError(`stress candidates (${selectedIds.length}) exceed maxSize (${maxSize})`)

  for (const id of selectedIds) {
    if (!candidateReasons[id]) candidateReasons[id] = ['deterministic-filler']
  }
  const selectedTierCounts = {}
  for (const id of selectedIds) {
    const tier = selectionTierById[id]
    selectedTierCounts[tier] = (selectedTierCounts[tier] ?? 0) + 1
  }

  return {
    entities: selectedIds.map((id) => entityById.get(id)),
    manifest: {
      strategy: 'adversarial-v1',
      candidateCount: selectedIds.length,
      targetSize,
      maxSize,
      expectedIds,
      observedDistractorIds,
      candidateIds: selectedIds,
      candidateReasons: Object.fromEntries(selectedIds.map((id) => [id, candidateReasons[id]])),
      selectionTierById,
      selectedTierCounts,
      selectionCounts: {
        allCountries: allCountryIds.length,
        allCapitalCities: allCapitalCityIds.length,
        expectedEntities: expectedIds.length,
        observedHardReportDistractors: observedDistractorIds.length,
        capitalLocalities: capitalLocalityIds.length,
        relatedMajorCities: relatedMajorCityIds.length,
        globalMajorCities: globalMajorCityIds.length
      }
    }
  }
}
