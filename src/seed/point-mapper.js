import { bilingualState } from '../domain/entity.js'
import { buildEmbeddingTextByVersion } from '../domain/embedding-text.js'
import { entityPointId } from './ids.js'

export function mapEntityToPayload(entity, metadata) {
  return {
    entity_id: entity.id,
    type: entity.type,
    name_en: entity.name.en,
    name_vi: entity.name.vi,
    description_en: entity.description.en,
    description_vi: entity.description.vi,
    continent: entity.continent,
    region: entity.region,
    country_code: entity.countryCode,
    population: entity.population,
    facts: entity.facts,
    source: entity.source,
    source_id: entity.sourceId,
    source_refs: entity.sourceRefs,
    bilingual_state: bilingualState(entity),
    language_provenance: entity.languageProvenance,
    translation_metadata: entity.translationMetadata,
    embedding_model: metadata.embeddingModel,
    embedding_version: metadata.embeddingVersion,
    embedding_backend: metadata.embeddingRuntime?.backend,
    embedding_implementation: metadata.embeddingRuntime?.implementation,
    embedding_semantic: metadata.embeddingRuntime?.semantic,
    embedding_accelerator: metadata.embeddingRuntime?.accelerator,
    embedding_device: metadata.embeddingRuntime?.device,
    embedding_dtype: metadata.embeddingRuntime?.dtype,
    embedding_runtime: metadata.embeddingRuntime?.runtime,
    embedding_profile: metadata.embeddingRuntime?.profile,
    embedding_query_strategy: metadata.embeddingRuntime?.query_strategy,
    embedding_query_instruction_id: metadata.embeddingRuntime?.query_instruction_id,
    embedding_document_strategy: metadata.embeddingRuntime?.document_strategy,
    embedding_text_version: metadata.embeddingTextVersion,
    dataset_version: metadata.datasetVersion,
    index_fingerprint: metadata.indexFingerprint
  }
}

export function prepareEntityForEmbedding(entity, embeddingTextVersion = 'v1') {
  const document = buildEmbeddingTextByVersion(entity, embeddingTextVersion)
  return { entity, pointId: entityPointId(entity), document }
}

export function createQdrantPoint(prepared, vector, metadata) {
  return {
    id: prepared.pointId,
    vector,
    payload: mapEntityToPayload(prepared.entity, {
      ...metadata,
      embeddingTextVersion: prepared.document.version
    })
  }
}
