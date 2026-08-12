import { normalizeCanonicalEntityId } from '../domain/entity.js'
import { entityPointId } from '../seed/ids.js'

export class EntityValidationError extends Error {}

export class EntityService {
  constructor({ qdrant }) {
    if (!qdrant) throw new TypeError('qdrant is required')
    this.qdrant = qdrant
  }

  async getById(entityId) {
    const id = validateEntityId(entityId)
    const point = await this.qdrant.getByPointId(entityPointId(id))
    if (!point) return null
    return mapPoint(point)
  }

  async stats() {
    const raw = await this.qdrant.stats()
    return {
      vectorConfig: raw?.config?.params?.vectors ?? null,
      status: raw?.status ?? null,
      optimizerStatus: raw?.optimizer_status ?? null,
      pointsCount: raw?.points_count ?? 0,
      indexedVectorsCount: raw?.indexed_vectors_count ?? 0,
      segmentsCount: raw?.segments_count ?? 0
    }
  }
}

export function validateEntityId(value) {
  const id = normalizeCanonicalEntityId(String(value ?? ''))
  if (!id) throw new EntityValidationError('entity id must be a Wikidata QID or safe namespaced public dataset ID')
  return id
}

export function mapPoint(point) {
  const payload = point?.payload ?? {}
  return {
    id: payload.entity_id ?? null,
    pointId: point?.id ?? null,
    type: payload.type ?? null,
    name: { en: payload.name_en ?? null, vi: payload.name_vi ?? null },
    description: { en: payload.description_en ?? null, vi: payload.description_vi ?? null },
    continent: payload.continent ?? null,
    region: payload.region ?? null,
    countryCode: payload.country_code ?? null,
    population: payload.population ?? null,
    facts: payload.facts && typeof payload.facts === 'object' ? payload.facts : {},
    source: payload.source ?? null,
    sourceId: payload.source_id ?? null,
    bilingualState: payload.bilingual_state ?? null,
    languageProvenance: payload.language_provenance ?? null,
    sourceRefs: Array.isArray(payload.source_refs) ? payload.source_refs : []
  }
}
