export function createReadinessCheck({ qdrantConnection, embeddingProvider }) {
  if (!qdrantConnection || typeof qdrantConnection.probe !== 'function') throw new TypeError('qdrantConnection.probe is required')
  if (!embeddingProvider || typeof embeddingProvider.health !== 'function') throw new TypeError('embeddingProvider.health is required')

  return async function readiness() {
    const [qdrant, embedding] = await Promise.all([
      qdrantConnection.probe(),
      embeddingProvider.health()
        .then((ready) => ({ ready: Boolean(ready), status: ready ? 'ready' : 'unavailable' }))
        .catch(() => ({ ready: false, status: 'unavailable' }))
    ])
    return { ready: Boolean(qdrant.ready && embedding.ready), qdrant, embedding }
  }
}
