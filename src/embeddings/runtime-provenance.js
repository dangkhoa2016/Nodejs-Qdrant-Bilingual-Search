const OPTIONAL_RUNTIME_STRING_FIELDS = [
  'accelerator',
  'device',
  'dtype',
  'runtime',
  'profile',
  'query_strategy',
  'query_instruction_id',
  'document_strategy'
]

export function normalizeEmbeddingRuntime(identity) {
  if (!identity || typeof identity !== 'object') return null
  const backend = String(identity.backend ?? '').trim()
  const implementation = String(identity.implementation ?? '').trim()
  if (!backend && !implementation && typeof identity.semantic !== 'boolean') return null
  const runtime = {
    backend: backend || 'unknown',
    implementation: implementation || 'unknown',
    semantic: identity.semantic === true
  }
  for (const key of OPTIONAL_RUNTIME_STRING_FIELDS) {
    const value = String(identity[key] ?? '').trim()
    if (value) runtime[key] = value
  }
  return runtime
}

export function requireVerifiedSemanticEmbeddingRuntime(identity) {
  const runtime = normalizeEmbeddingRuntime(identity)
  const looksMock = /mock/i.test(`${runtime?.backend ?? ''} ${runtime?.implementation ?? ''}`)
  if (!runtime || runtime.semantic !== true || runtime.backend === 'unknown' || runtime.implementation === 'unknown' || looksMock) {
    throw new Error('verified semantic embedding backend is required; mock or unverified runtime is not allowed')
  }
  return runtime
}

const SEMANTIC_INDEX_IDENTITY_FIELDS = [
  'profile',
  'query_strategy',
  'query_instruction_id',
  'document_strategy'
]

export function semanticIndexCompatibilityRuntime(identity) {
  const runtime = requireVerifiedSemanticEmbeddingRuntime(identity)
  const compatible = {
    backend: runtime.backend,
    implementation: runtime.implementation,
    semantic: true,
    semanticAuditOnly: true
  }
  for (const key of SEMANTIC_INDEX_IDENTITY_FIELDS) {
    if (runtime[key]) compatible[key] = runtime[key]
  }
  return compatible
}
