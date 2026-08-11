function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null
  return Number(value.toFixed(digits))
}

function nonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function ratePerSecond(count, elapsedMs) {
  const safeCount = nonNegative(count)
  const safeElapsedMs = nonNegative(elapsedMs)
  return safeElapsedMs > 0 ? safeCount / (safeElapsedMs / 1000) : 0
}

export function buildSeedProgressSnapshot({
  stage,
  total,
  totalBatches,
  batch,
  embedded,
  upserted,
  skippedExisting = 0,
  elapsedMs,
  embeddingMs = 0,
  embeddingServerInferenceMs = 0,
  embeddingHttpRoundTripMs = 0,
  embeddingTransferOverheadMs = 0,
  embeddingTransport = null,
  qdrantUpsertMs = 0
}) {
  const safeTotal = Math.max(0, Number(total) || 0)
  const safeEmbedded = nonNegative(embedded)
  const safeUpserted = Math.min(safeTotal || Number.MAX_SAFE_INTEGER, nonNegative(upserted))
  const safeSkippedExisting = Math.min(safeTotal || Number.MAX_SAFE_INTEGER, nonNegative(skippedExisting))
  const completed = Math.min(safeTotal || Number.MAX_SAFE_INTEGER, safeUpserted + safeSkippedExisting)
  const safeElapsedMs = nonNegative(elapsedMs)
  const rate = ratePerSecond(safeUpserted, safeElapsedMs)
  const remaining = Math.max(0, safeTotal - completed)
  const etaMs = rate > 0 && remaining > 0 ? (remaining / rate) * 1000 : 0
  const percent = safeTotal > 0 ? Math.min(100, (completed / safeTotal) * 100) : 0
  const serverInferenceMs = nonNegative(embeddingServerInferenceMs)
  const httpRoundTripMs = nonNegative(embeddingHttpRoundTripMs)
  const transferOverheadMs = nonNegative(embeddingTransferOverheadMs)
  const safeQdrantMs = nonNegative(qdrantUpsertMs)

  return {
    stage,
    total: safeTotal,
    totalBatches: Math.max(0, Number(totalBatches) || 0),
    batch: Math.max(0, Number(batch) || 0),
    embedded: safeEmbedded,
    upserted: nonNegative(upserted),
    skippedExisting: safeSkippedExisting,
    percent: round(percent),
    elapsedMs: round(safeElapsedMs),
    rateEntitiesPerSecond: round(rate),
    etaMs: round(etaMs),
    embeddingMs: round(nonNegative(embeddingMs)),
    embeddingServerInferenceMs: round(serverInferenceMs),
    embeddingHttpRoundTripMs: round(httpRoundTripMs),
    embeddingTransferOverheadMs: round(transferOverheadMs),
    embeddingTransport: embeddingTransport || null,
    serverInferenceDocsPerSecond: round(ratePerSecond(safeEmbedded, serverInferenceMs)),
    embeddingHttpDocsPerSecond: round(ratePerSecond(safeEmbedded, httpRoundTripMs)),
    qdrantDocsPerSecond: round(ratePerSecond(safeUpserted, safeQdrantMs)),
    qdrantUpsertMs: round(safeQdrantMs)
  }
}

export function progressEveryBatches({ totalBatches, configured = 0 }) {
  const explicit = Number.parseInt(configured ?? 0, 10)
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  const total = Math.max(1, Number.parseInt(totalBatches ?? 1, 10))
  return Math.max(1, Math.ceil(total / 100))
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

export function formatSeedProgressLine(snapshot) {
  const percent = Number(snapshot.percent ?? 0).toFixed(2)
  const eta = formatDuration(snapshot.etaMs ?? 0)
  const gpuRate = Number(snapshot.serverInferenceDocsPerSecond ?? 0).toFixed(2)
  const httpRate = Number(snapshot.embeddingHttpDocsPerSecond ?? 0).toFixed(2)
  const e2eRate = Number(snapshot.rateEntitiesPerSecond ?? 0).toFixed(2)
  const qdrantRate = Number(snapshot.qdrantDocsPerSecond ?? 0).toFixed(2)
  const transport = snapshot.embeddingTransport ?? 'unknown'
  return `[seed] ${percent}% | batch ${snapshot.batch}/${snapshot.totalBatches} | embedded ${snapshot.embedded}/${snapshot.total} | upserted ${snapshot.upserted}/${snapshot.total} | GPU=${gpuRate} docs/s | HTTP=${httpRate} docs/s | E2E=${e2eRate} docs/s | Qdrant=${qdrantRate} docs/s | transport=${transport} | ETA ${eta} | embed ${(Number(snapshot.embeddingMs ?? 0) / 1000).toFixed(1)}s | transfer ${(Number(snapshot.embeddingTransferOverheadMs ?? 0) / 1000).toFixed(1)}s | qdrant ${(Number(snapshot.qdrantUpsertMs ?? 0) / 1000).toFixed(1)}s | stage=${snapshot.stage}`
}
