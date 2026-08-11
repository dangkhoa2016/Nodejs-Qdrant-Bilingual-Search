import { createQdrantPoint, prepareEntityForEmbedding } from './point-mapper.js'
import { createIndexFingerprint } from './index-fingerprint.js'
import { normalizeEmbeddingRuntime, requireVerifiedSemanticEmbeddingRuntime } from '../embeddings/runtime-provenance.js'
import { buildSeedProgressSnapshot } from './progress.js'

const MAX_EMBEDDING_BATCH_SIZE = 256
const V21_CANONICAL_COLLECTION = 'knowledge_entities_qwen3_4b_text_v21'

export function assertEmbeddingTextCollectionSafety({ embeddingTextVersion = 'v1', collection }) {
  if (embeddingTextVersion === 'v2.1') {
    if (collection !== V21_CANONICAL_COLLECTION) {
      throw new Error(`embedding_text v2.1 seed must target ${V21_CANONICAL_COLLECTION}; refusing collection ${collection || '(empty)'}`)
    }
    return
  }
  if (embeddingTextVersion === 'v1' && collection === V21_CANONICAL_COLLECTION) {
    throw new Error(`embedding_text v1 seed must not target canonical v2.1 collection ${V21_CANONICAL_COLLECTION}`)
  }
}

export class SeedService {
  constructor({ embeddingProvider, qdrant, batchSize = 64, metadata, requireSemanticBackend = false, clock = () => performance.now() }) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_EMBEDDING_BATCH_SIZE) {
      throw new TypeError(`batchSize must be between 1 and ${MAX_EMBEDDING_BATCH_SIZE}`)
    }
    if (!embeddingProvider || typeof embeddingProvider.embedDocuments !== 'function') throw new TypeError('embeddingProvider is required')
    if (!qdrant || typeof qdrant.ensureCollection !== 'function') throw new TypeError('qdrant is required')
    this.embeddingProvider = embeddingProvider
    this.qdrant = qdrant
    this.batchSize = batchSize
    this.metadata = metadata
    this.requireSemanticBackend = Boolean(requireSemanticBackend)
    this.clock = clock
  }

  async preflight() {
    if (typeof this.embeddingProvider.health === 'function' && !(await this.embeddingProvider.health())) {
      throw new Error('embedding service is not ready')
    }
    const embedding = typeof this.embeddingProvider.assertCompatible === 'function'
      ? await this.embeddingProvider.assertCompatible()
      : null
    const runtime = normalizeEmbeddingRuntime(embedding)
    if (this.requireSemanticBackend) requireVerifiedSemanticEmbeddingRuntime(embedding)
    await this.qdrant.ensureCollection()
    return { embedding, embeddingRuntime: runtime }
  }

  async seed(entities, { onProgress = async () => {} } = {}) {
    if (!Array.isArray(entities) || !entities.length) throw new TypeError('entities must be a non-empty array')
    const started = this.clock()
    const totalBatches = Math.ceil(entities.length / this.batchSize)
    const emitPreflightProgress = async (stage) => onProgress(buildSeedProgressSnapshot({
      stage,
      total: entities.length,
      totalBatches,
      batch: 0,
      embedded: 0,
      upserted: 0,
      skippedExisting: 0,
      elapsedMs: Math.max(0, this.clock() - started),
      embeddingMs: 0,
      qdrantUpsertMs: 0
    }))

    await emitPreflightProgress('preflight')
    let infrastructure
    let embeddingRuntime
    let fingerprint
    let preflight
    try {
      infrastructure = await this.preflight()
      embeddingRuntime = infrastructure.embeddingRuntime
      fingerprint = createIndexFingerprint(entities, {
        ...this.metadata,
        ...(embeddingRuntime ? { embeddingRuntime } : {})
      })
      preflight = await this.qdrant.preflightSeed({
        indexFingerprint: fingerprint.value,
        expectedPoints: entities.length
      })
    } catch (error) {
      await emitPreflightProgress('failed')
      throw error
    }

    let embeddingMs = 0
    let embeddingServerInferenceMs = 0
    let embeddingHttpRoundTripMs = 0
    let embeddingTransferOverheadMs = 0
    let embeddingTransport = this.embeddingProvider.transport ?? null
    let qdrantUpsertMs = 0

    const emitProgress = async (stage) => {
      const snapshot = buildSeedProgressSnapshot({
        stage,
        total: entities.length,
        totalBatches,
        batch: report.batches,
        embedded: report.embedded,
        upserted: report.upserted,
        skippedExisting: report.skipped_existing,
        elapsedMs: Math.max(0, this.clock() - started),
        embeddingMs,
        embeddingServerInferenceMs,
        embeddingHttpRoundTripMs,
        embeddingTransferOverheadMs,
        embeddingTransport,
        qdrantUpsertMs
      })
      await onProgress({
        ...snapshot,
        mode: report.mode,
        pointsBefore: report.points_before,
        matchingBefore: report.matching_before,
        indexFingerprint: report.index_fingerprint
      })
    }

    const report = {
      read: entities.length,
      embedded: 0,
      upserted: 0,
      batches: 0,
      skipped_existing: 0,
      mode: preflight.mode,
      index_fingerprint: fingerprint.value,
      ...(embeddingRuntime ? { embedding_runtime: embeddingRuntime } : {}),
      points_before: preflight.pointsCount,
      matching_before: preflight.matchingCount,
      points_after: preflight.pointsCount,
      matching_after: preflight.matchingCount,
      elapsed_ms: 0,
      embedding_ms: 0,
      embedding_server_inference_ms: 0,
      embedding_http_round_trip_ms: 0,
      embedding_transfer_overhead_ms: 0,
      embedding_transport: embeddingTransport,
      server_inference_docs_per_second: 0,
      embedding_http_docs_per_second: 0,
      qdrant_docs_per_second: 0,
      end_to_end_docs_per_second: 0,
      qdrant_upsert_ms: 0,
      embedding_text_version: fingerprint.embeddingTextVersion
    }

    if (preflight.mode === 'idempotent') {
      report.skipped_existing = entities.length
      report.elapsed_ms = Number((this.clock() - started).toFixed(3))
      await emitProgress('completed')
      return report
    }

    const pointMetadata = {
      ...this.metadata,
      ...(embeddingRuntime ? { embeddingRuntime } : {}),
      embeddingTextVersion: fingerprint.embeddingTextVersion,
      indexFingerprint: fingerprint.value
    }

    const updateTimingReport = () => {
      report.embedding_ms = Number(embeddingMs.toFixed(3))
      report.embedding_server_inference_ms = Number(embeddingServerInferenceMs.toFixed(3))
      report.embedding_http_round_trip_ms = Number(embeddingHttpRoundTripMs.toFixed(3))
      report.embedding_transfer_overhead_ms = Number(embeddingTransferOverheadMs.toFixed(3))
      report.embedding_transport = embeddingTransport
      report.qdrant_upsert_ms = Number(qdrantUpsertMs.toFixed(3))
      report.server_inference_docs_per_second = embeddingServerInferenceMs > 0
        ? Number((report.embedded / (embeddingServerInferenceMs / 1000)).toFixed(3))
        : 0
      report.embedding_http_docs_per_second = embeddingHttpRoundTripMs > 0
        ? Number((report.embedded / (embeddingHttpRoundTripMs / 1000)).toFixed(3))
        : 0
      report.qdrant_docs_per_second = qdrantUpsertMs > 0
        ? Number((report.upserted / (qdrantUpsertMs / 1000)).toFixed(3))
        : 0
      report.end_to_end_docs_per_second = report.elapsed_ms > 0
        ? Number((report.upserted / (report.elapsed_ms / 1000)).toFixed(3))
        : 0
    }

    try {
      await emitProgress('ready')
      for (let start = 0; start < entities.length; start += this.batchSize) {
        const batch = entities.slice(start, start + this.batchSize)
          .map((entity) => prepareEntityForEmbedding(entity, this.metadata?.embeddingTextVersion ?? 'v1'))
        const embeddingStarted = this.clock()
        const texts = batch.map((item) => item.document.text)
        const detailed = typeof this.embeddingProvider.embedDocumentsDetailed === 'function'
          ? await this.embeddingProvider.embedDocumentsDetailed(texts)
          : { vectors: await this.embeddingProvider.embedDocuments(texts), metrics: null }
        const embeddingElapsedMs = Math.max(0, this.clock() - embeddingStarted)
        embeddingMs += embeddingElapsedMs
        const vectors = detailed.vectors
        const metrics = detailed.metrics
        if (metrics && typeof metrics === 'object') {
          if (metrics.transport) embeddingTransport = metrics.transport
          if (Number.isFinite(metrics.serverInferenceMs) && metrics.serverInferenceMs >= 0) embeddingServerInferenceMs += metrics.serverInferenceMs
          if (Number.isFinite(metrics.httpRoundTripMs) && metrics.httpRoundTripMs >= 0) embeddingHttpRoundTripMs += metrics.httpRoundTripMs
          if (Number.isFinite(metrics.transferOverheadMs) && metrics.transferOverheadMs >= 0) embeddingTransferOverheadMs += metrics.transferOverheadMs
        }
        if (vectors.length !== batch.length) throw new Error('embedding vector count mismatch')
        const points = batch.map((item, index) => createQdrantPoint(item, vectors[index], pointMetadata))
        const upsertStarted = this.clock()
        await this.qdrant.upsertPoints(points)
        qdrantUpsertMs += Math.max(0, this.clock() - upsertStarted)
        report.embedded += vectors.length
        report.upserted += points.length
        report.batches += 1
        report.elapsed_ms = Number((this.clock() - started).toFixed(3))
        updateTimingReport()
        await emitProgress('seeding')
      }

      await emitProgress('verifying')
      const verified = await this.qdrant.verifySeed({
        indexFingerprint: fingerprint.value,
        expectedPoints: entities.length
      })
      report.points_after = verified.pointsCount
      report.matching_after = verified.matchingCount
      report.elapsed_ms = Number((this.clock() - started).toFixed(3))
      updateTimingReport()
      await emitProgress('completed')
    } catch (error) {
      report.elapsed_ms = Number((this.clock() - started).toFixed(3))
      updateTimingReport()
      await emitProgress('failed')
      throw error
    }
    return report
  }
}
