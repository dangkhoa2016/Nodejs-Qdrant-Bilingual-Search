const ENTITY_TYPES = new Set(['country', 'city', 'landmark'])
const PROVENANCE = new Set(['wikidata', 'geonames', 'geonames_alternate', 'geonames_fallback', 'whosonfirst', 'natural_earth', 'machine_translation', 'missing'])
const SOURCE_NAME = /^[a-z][a-z0-9_]{0,63}$/
const NAMESPACED_ID = /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/

export function normalizeCanonicalEntityId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (/^Q[1-9]\d*$/i.test(id)) return `Q${id.slice(1)}`
  if (NAMESPACED_ID.test(id) && !id.includes('..')) return id
  return null
}

function canonicalEntityId(value) {
  return normalizeCanonicalEntityId(value) != null
}

function textOrNull(value, path) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string or null`)
  return value.trim() || null
}

function stringArray(value, path) {
  if (value == null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${path} must be an array of strings`)
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))]
}

export function normalizeEntity(input) {
  if (!input || typeof input !== 'object') throw new TypeError('entity must be an object')
  const canonicalId = normalizeCanonicalEntityId(input.id)
  if (!canonicalId) throw new TypeError('id must be a canonical entity ID (Wikidata QID or safe namespaced ID)')
  if (!ENTITY_TYPES.has(input.type)) throw new TypeError(`unsupported entity type: ${input.type}`)

  const nameEn = textOrNull(input.name?.en, 'name.en')
  const nameVi = textOrNull(input.name?.vi, 'name.vi')
  if (!nameEn && !nameVi) throw new TypeError('at least one localized name is required')

  const source = input.source ?? 'wikidata'
  if (typeof source !== 'string' || !SOURCE_NAME.test(source)) throw new TypeError('source must be a safe lowercase source name')

  const entity = {
    id: canonicalId,
    type: input.type,
    name: { en: nameEn, vi: nameVi },
    description: {
      en: textOrNull(input.description?.en, 'description.en'),
      vi: textOrNull(input.description?.vi, 'description.vi')
    },
    aliases: {
      en: stringArray(input.aliases?.en, 'aliases.en'),
      vi: stringArray(input.aliases?.vi, 'aliases.vi')
    },
    continent: textOrNull(input.continent, 'continent'),
    region: textOrNull(input.region, 'region'),
    countryCode: textOrNull(input.countryCode, 'countryCode'),
    population: input.population == null ? null : Number(input.population),
    facts: input.facts && typeof input.facts === 'object' ? structuredClone(input.facts) : {},
    source,
    sourceId: String(input.sourceId ?? input.id),
    sourceRefs: Array.isArray(input.sourceRefs)
      ? input.sourceRefs.map((ref) => ({ source: String(ref.source), sourceId: String(ref.sourceId) }))
      : [{ source, sourceId: String(input.sourceId ?? input.id) }],
    languageProvenance: {
      name_en: input.languageProvenance?.name_en ?? (nameEn ? source : 'missing'),
      name_vi: input.languageProvenance?.name_vi ?? (nameVi ? source : 'missing'),
      description_en: input.languageProvenance?.description_en ?? (input.description?.en ? source : 'missing'),
      description_vi: input.languageProvenance?.description_vi ?? (input.description?.vi ? source : 'missing')
    },
    translationMetadata: input.translationMetadata ? structuredClone(input.translationMetadata) : {}
  }

  for (const ref of entity.sourceRefs) {
    if (!SOURCE_NAME.test(ref.source) || !ref.sourceId.trim()) throw new TypeError('sourceRefs must contain valid source/sourceId pairs')
  }
  entity.sourceRefs = [...new Map(entity.sourceRefs.map((ref) => [`${ref.source}\u0000${ref.sourceId}`, ref])).values()]

  if (entity.population != null && (!Number.isFinite(entity.population) || entity.population < 0)) {
    throw new TypeError('population must be a non-negative number')
  }
  for (const [key, value] of Object.entries(entity.languageProvenance)) {
    if (!PROVENANCE.has(value)) throw new TypeError(`invalid provenance for ${key}`)
  }
  return entity
}

export function bilingualState(entity) {
  const hasEn = Boolean(entity.name.en || entity.description.en)
  const hasVi = Boolean(entity.name.vi || entity.description.vi)
  const translated = Object.values(entity.languageProvenance).includes('machine_translation')
  if (translated && hasEn && hasVi) return 'translated_bilingual'
  if (hasEn && hasVi) return 'native_bilingual'
  if (hasEn) return 'english_only'
  return 'vietnamese_only'
}
