export function environmentSnapshot({ config, env = process.env, versions = process.versions, platform = process.platform, arch = process.arch } = {}) {
  const safeConfig = config ? {
    qdrant: config.qdrant ? {
      provider: config.qdrant.provider,
      url: config.qdrant.url,
      requestTimeoutMs: config.qdrant.requestTimeoutMs,
      requestRetry: config.qdrant.requestRetry,
      startupRetry: config.qdrant.startupRetry
    } : null,
    qdrantCollection: config.qdrantCollection,
    embeddingUrl: config.embeddingUrl,
    embeddingModel: config.embeddingModel,
    embeddingDimension: config.embeddingDimension,
    embeddingTransport: config.embeddingTransport,
    embeddingTextVersion: config.embeddingTextVersion,
    embeddingTimeoutMs: config.embeddingTimeoutMs,
    searchMaxLimit: config.searchMaxLimit,
    searchDefaultScoreThreshold: config.searchDefaultScoreThreshold,
    searchConsistencyVerificationEnabled: config.searchConsistencyVerificationEnabled,
    searchConsistencyCandidateMultiplier: config.searchConsistencyCandidateMultiplier,
    searchDomainEntityIntentGateEnabled: config.searchDomainEntityIntentGateEnabled
  } : null
  return {
    runtime: { node: versions.node, platform, arch },
    app: { name: 'nodejs-qdrant-bilingual-search', environment: env.NODE_ENV ?? 'development' },
    config: safeConfig
  }
}
