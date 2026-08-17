#!/usr/bin/env node
import { loadConfig } from '../../src/config.js'
import { assertCanonicalRuntimeConfig, CANONICAL_QWEN_PROFILE, QWEN_V1_ROLLBACK_COLLECTION } from '../../src/canonical-profile.js'

const config = loadConfig()
assertCanonicalRuntimeConfig(config)

console.log(JSON.stringify({
  canonical: true,
  active: {
    collection: config.qdrantCollection,
    embeddingModel: config.embeddingModel,
    embeddingDimension: config.embeddingDimension,
    embeddingTransport: config.embeddingTransport,
    embeddingTextVersion: config.embeddingTextVersion,
    searchDefaultScoreThreshold: config.searchDefaultScoreThreshold
  },
  expected: CANONICAL_QWEN_PROFILE,
  rollbackReferenceCollection: QWEN_V1_ROLLBACK_COLLECTION
}, null, 2))
