import { enrichGeoNamesAlternateNames as defaultEnrichGeoNames, fetchGeoNamesEntities as defaultFetchGeoNames } from './geonames-client.js'
import { enrichGeoNamesWithWof as defaultEnrichWof } from './wof-client.js'

const PUBLIC_SOURCES = new Set(['geonames', 'wof'])
const ENTITY_TYPES = new Set(['country', 'city', 'landmark'])
const GEONAMES_TYPES = new Set(['country', 'city'])
const GEONAMES_DATASET = 'cities15000'
const WOF_DATASET = 'whosonfirst-locality-country'
const CONTINENTS = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']

function list(value, fallback) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
  const parsed = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  return parsed.length ? [...new Set(parsed)] : fallback
}

function positiveLimit(value) {
  if (value == null || value === '') return null
  const limit = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer')
  return limit
}

function geoNamesSourceId(entity) {
  const ref = entity.sourceRefs?.find((item) => item.source === 'geonames')
  const value = ref?.sourceId ?? (entity.source === 'geonames' ? entity.sourceId : null)
  return value != null && /^\d+$/.test(String(value)) ? Number(value) : null
}

function compareRepresentativeEntities(a, b) {
  const capitalA = a.type === 'city' && a.facts?.capital === true ? 1 : 0
  const capitalB = b.type === 'city' && b.facts?.capital === true ? 1 : 0
  if (capitalA !== capitalB) return capitalB - capitalA

  const populationA = Number.isFinite(a.population) ? a.population : -1
  const populationB = Number.isFinite(b.population) ? b.population : -1
  if (populationA !== populationB) return populationB - populationA

  const geonamesA = geoNamesSourceId(a)
  const geonamesB = geoNamesSourceId(b)
  if (geonamesA != null && geonamesB != null && geonamesA !== geonamesB) return geonamesA - geonamesB

  return a.id.localeCompare(b.id, 'en', { numeric: true })
}

function selectRepresentativeEntities(entities, limit) {
  if (limit == null || limit >= entities.length) return entities
  return [...entities].sort(compareRepresentativeEntities).slice(0, limit)
}

function buildCoverage(entities) {
  const continents = Object.fromEntries(CONTINENTS.map((continent) => [continent, 0]))
  const countryCounts = new Map()
  let cityCount = 0
  let nameEnPresent = 0
  let nameEnFallback = 0
  let nameEn = 0
  let nameVi = 0
  let descriptionEn = 0
  let descriptionVi = 0
  let viLegacyTexts = 0

  for (const entity of entities) {
    if (entity.type === 'city') cityCount += 1
    if (entity.continent && Object.hasOwn(continents, entity.continent)) continents[entity.continent] += 1
    if (entity.countryCode) countryCounts.set(entity.countryCode, (countryCounts.get(entity.countryCode) ?? 0) + 1)

    if (entity.name.en) {
      nameEnPresent += 1
      if (entity.languageProvenance?.name_en === 'geonames_fallback') nameEnFallback += 1
      else nameEn += 1
    }
    if (entity.name.vi && entity.languageProvenance?.name_vi !== 'geonames_fallback') nameVi += 1
    for (const text of [entity.name.vi, ...(entity.aliases?.vi ?? [])]) {
      if (text && /[Ðð]/u.test(text)) viLegacyTexts += 1
    }
    if (entity.description.en) descriptionEn += 1
    if (entity.description.vi) descriptionVi += 1
  }

  return {
    total: entities.length,
    cityCount,
    continents,
    countries: Object.fromEntries([...countryCounts].sort(([a], [b]) => a.localeCompare(b))),
    languages: {
      name_en: nameEn,
      name_en_present: nameEnPresent,
      name_en_fallback: nameEnFallback,
      name_vi: nameVi,
      description_en: descriptionEn,
      description_vi: descriptionVi,
      vi_legacy_texts: viLegacyTexts
    }
  }
}

function assertCoverage(coverage) {
  if (coverage.cityCount < 5_000) return
  for (const continent of ['North America', 'South America']) {
    if (coverage.continents[continent] === 0) {
      throw new TypeError(`dataset coverage check failed: ${continent} has no cities in a ${coverage.cityCount}-city dataset`)
    }
  }
}

function buildDataQuality(entities) {
  const checks = { duplicateEntityIds: 0, duplicateSourceRefs: 0, viLegacyTexts: 0 }
  const issues = []
  let issueCount = 0
  const seenEntityIds = new Set()
  const sourceRefOwners = new Map()
  const duplicateSourceRefKeys = new Set()

  const addIssue = (issue) => {
    issueCount += 1
    if (issues.length < 100) issues.push(issue)
  }

  for (const entity of entities) {
    if (seenEntityIds.has(entity.id)) {
      checks.duplicateEntityIds += 1
      addIssue({ code: 'duplicate_entity_id', entityId: entity.id })
    } else seenEntityIds.add(entity.id)

    for (const ref of entity.sourceRefs ?? []) {
      const key = `${ref.source}\u0000${ref.sourceId}`
      const owner = sourceRefOwners.get(key)
      if (owner == null) sourceRefOwners.set(key, entity.id)
      else if (owner !== entity.id && !duplicateSourceRefKeys.has(key)) {
        duplicateSourceRefKeys.add(key)
        checks.duplicateSourceRefs += 1
        addIssue({ code: 'duplicate_source_ref', source: ref.source, sourceId: String(ref.sourceId), entityIds: [owner, entity.id] })
      }
    }

    for (const [field, value] of [
      ['name.vi', entity.name?.vi],
      ...(entity.aliases?.vi ?? []).map((alias, index) => [`aliases.vi[${index}]`, alias])
    ]) {
      if (!value || !/[Ðð]/u.test(value)) continue
      checks.viLegacyTexts += 1
      addIssue({ code: 'vi_legacy_text', entityId: entity.id, field, value })
    }
  }

  return {
    policy: 'geonames_fail_fast_wof_best_effort',
    issueCount,
    issues,
    truncated: issueCount > issues.length,
    checks
  }
}

export function normalizePublicDatasetOptions({
  sources = ['geonames', 'wof'],
  types = ['country', 'city'],
  limit = null
} = {}) {
  const normalizedSources = list(sources, ['geonames', 'wof'])
  const normalizedTypes = list(types, ['country', 'city'])
  for (const source of normalizedSources) {
    if (!PUBLIC_SOURCES.has(source)) throw new TypeError(`unsupported public dataset source: ${source}`)
  }
  if (normalizedSources.includes('wof') && !normalizedSources.includes('geonames')) {
    throw new TypeError('WOF enrichment requires GeoNames')
  }
  for (const type of normalizedTypes) {
    if (!ENTITY_TYPES.has(type)) throw new TypeError(`unsupported entity type: ${type}`)
  }
  return {
    sources: normalizedSources,
    types: normalizedTypes,
    limit: positiveLimit(limit),
    geonamesDataset: GEONAMES_DATASET,
    wofDataset: WOF_DATASET
  }
}

export async function buildPublicDataset({
  sources = ['geonames', 'wof'],
  types = ['country', 'city'],
  limit = null,
  fetchGeoNames = defaultFetchGeoNames,
  enrichGeoNames = defaultEnrichGeoNames,
  enrichWof = defaultEnrichWof,
  wofOptions = {},
  clock = () => new Date()
} = {}) {
  const options = normalizePublicDatasetOptions({ sources, types, limit })
  const geoNamesEntities = []
  const seenIds = new Set()
  const sourceCounts = { geonames: 0, wof: 0 }
  const skipped = []

  if (options.sources.includes('geonames')) {
    for (const type of options.types) {
      if (!GEONAMES_TYPES.has(type)) {
        skipped.push({ source: 'geonames', type, reason: 'unsupported_type' })
        continue
      }
      for (const entity of await fetchGeoNames({ type })) {
        if (seenIds.has(entity.id)) continue
        seenIds.add(entity.id)
        geoNamesEntities.push(entity)
      }
    }
  }
  sourceCounts.geonames = geoNamesEntities.length

  const selected = selectRepresentativeEntities(geoNamesEntities, options.limit)
  const geoNamesEnriched = selected.some((entity) => geoNamesSourceId(entity) != null)
    ? await enrichGeoNames(selected)
    : selected

  let entities = geoNamesEnriched
  let wofEnrichment = {
    status: 'disabled', requested: 0, matched: 0, ambiguous: 0, invalid: 0, scanned: 0, skippedUnmatched: 0
  }
  if (options.sources.includes('wof')) {
    try {
      const enriched = await enrichWof(geoNamesEnriched, wofOptions)
      entities = enriched?.entities ?? geoNamesEnriched
      wofEnrichment = enriched?.report ?? wofEnrichment
      sourceCounts.wof = Number.isInteger(wofEnrichment.matched) ? wofEnrichment.matched : 0
    } catch (error) {
      wofEnrichment = {
        status: 'unavailable', requested: geoNamesEnriched.length, matched: 0, ambiguous: 0, invalid: 0,
        scanned: 0, skippedUnmatched: 0, error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const coverage = buildCoverage(entities)
  assertCoverage(coverage)
  return {
    entities,
    manifest: {
      version: 6,
      generatedAt: clock().toISOString(),
      sources: options.sources,
      types: options.types,
      geonamesDataset: options.geonamesDataset,
      wofDataset: options.wofDataset,
      limit: options.limit,
      sourceCounts,
      mergedCountBeforeLimit: geoNamesEntities.length,
      mergedCount: entities.length,
      skipped,
      wofEnrichment,
      coverage,
      dataQuality: buildDataQuality(entities)
    }
  }
}
