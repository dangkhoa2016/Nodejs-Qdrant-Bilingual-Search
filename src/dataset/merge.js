import { normalizeEntity } from '../domain/entity.js'

function firstNonNull(entities, getter) {
  for (const entity of entities) {
    const value = getter(entity)
    if (value != null && value !== '') return value
  }
  return null
}

function mergeAliases(entities, language) {
  const seen = new Set()
  const output = []
  for (const entity of entities) {
    for (const alias of entity.aliases[language]) {
      if (!seen.has(alias)) {
        seen.add(alias)
        output.push(alias)
      }
    }
  }
  return output
}

function mergeFacts(entities) {
  const keys = new Set(entities.flatMap((entity) => Object.keys(entity.facts ?? {})))
  const output = {}
  for (const key of keys) {
    const values = entities.map((entity) => entity.facts?.[key]).filter((value) => value != null)
    if (values.some(Array.isArray)) {
      output[key] = [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]))]
    } else if (values.length) {
      output[key] = values[0]
    }
  }
  return output
}

function fieldWithProvenance(entities, field, language) {
  for (const entity of entities) {
    const value = entity[field]?.[language]
    if (value) return { value, provenance: entity.languageProvenance?.[`${field}_${language}`] ?? entity.source }
  }
  return { value: null, provenance: 'missing' }
}

function sourceRefs(entities) {
  const seen = new Set()
  const output = []
  for (const entity of entities) {
    const refs = entity.sourceRefs?.length ? entity.sourceRefs : [{ source: entity.source, sourceId: entity.sourceId }]
    for (const ref of refs) {
      const key = `${ref.source}\u0000${ref.sourceId}`
      if (!seen.has(key)) {
        seen.add(key)
        output.push({ source: ref.source, sourceId: String(ref.sourceId) })
      }
    }
  }
  return output
}

export function mergeEntityDatasets(datasets, { sourcePriority = ['wikidata', 'geonames', 'natural_earth'] } = {}) {
  if (!Array.isArray(datasets)) throw new TypeError('datasets must be an array')
  const priority = new Map(sourcePriority.map((source, index) => [source, index]))
  const grouped = new Map()

  for (const dataset of datasets) {
    if (!dataset || !Array.isArray(dataset.entities)) throw new TypeError('each dataset must contain an entities array')
    for (const raw of dataset.entities) {
      const entity = normalizeEntity(raw)
      const group = grouped.get(entity.id) ?? []
      group.push(entity)
      grouped.set(entity.id, group)
    }
  }

  const merged = []
  for (const [id, group] of grouped) {
    const ordered = [...group].sort((a, b) => {
      const ap = priority.get(a.source) ?? Number.MAX_SAFE_INTEGER
      const bp = priority.get(b.source) ?? Number.MAX_SAFE_INTEGER
      if (ap !== bp) return ap - bp
      return a.source.localeCompare(b.source) || String(a.sourceId).localeCompare(String(b.sourceId))
    })
    const types = new Set(ordered.map((entity) => entity.type))
    if (types.size !== 1) throw new TypeError(`entity ${id} has a type conflict across sources`)

    const primary = ordered[0]
    const nameEn = fieldWithProvenance(ordered, 'name', 'en')
    const nameVi = fieldWithProvenance(ordered, 'name', 'vi')
    const descEn = fieldWithProvenance(ordered, 'description', 'en')
    const descVi = fieldWithProvenance(ordered, 'description', 'vi')

    merged.push(normalizeEntity({
      id,
      type: primary.type,
      name: { en: nameEn.value, vi: nameVi.value },
      description: { en: descEn.value, vi: descVi.value },
      aliases: { en: mergeAliases(ordered, 'en'), vi: mergeAliases(ordered, 'vi') },
      continent: firstNonNull(ordered, (entity) => entity.continent),
      region: firstNonNull(ordered, (entity) => entity.region),
      countryCode: firstNonNull(ordered, (entity) => entity.countryCode),
      population: firstNonNull(ordered, (entity) => entity.population),
      facts: mergeFacts(ordered),
      source: primary.source,
      sourceId: primary.sourceId,
      sourceRefs: sourceRefs(ordered),
      languageProvenance: {
        name_en: nameEn.provenance,
        name_vi: nameVi.provenance,
        description_en: descEn.provenance,
        description_vi: descVi.provenance
      },
      translationMetadata: Object.assign({}, ...[...ordered].reverse().map((entity) => entity.translationMetadata ?? {}))
    }))
  }

  return merged.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}
