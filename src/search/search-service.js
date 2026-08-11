import { buildQdrantFilter } from '../qdrant/filter-builder.js'
import { applyConsistencyVerification, extractStructuredQueryConstraints } from './relation-consistency-verifier.js'
import { applyDomainEntityIntentGate } from './domain-entity-intent-gate.js'

export class SearchValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SearchValidationError'
  }
}

export class SearchService {
  constructor({ embeddingProvider, qdrant, config, clock = () => performance.now() }) {
    this.embeddingProvider = embeddingProvider
    this.qdrant = qdrant
    this.config = config
    this.clock = clock
  }

  validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SearchValidationError('request body must be an object')
    if (typeof input.query !== 'string' || !input.query.trim()) throw new SearchValidationError('query is required')
    if (input.query.trim().length > 1000) throw new SearchValidationError('query must be at most 1000 characters')
    const language = input.language ?? 'auto'
    if (!['auto', 'en', 'vi'].includes(language)) throw new SearchValidationError('language must be auto, en or vi')
    const limit = input.limit ?? this.config.searchDefaultLimit
    if (!Number.isInteger(limit) || limit < 1 || limit > this.config.searchMaxLimit) {
      throw new SearchValidationError(`limit must be between 1 and ${this.config.searchMaxLimit}`)
    }
    const scoreThreshold = input.score_threshold ?? this.config.searchDefaultScoreThreshold
    if (typeof scoreThreshold !== 'number' || scoreThreshold < 0 || scoreThreshold > 1) {
      throw new SearchValidationError('score_threshold must be between 0 and 1')
    }
    let filter
    try { filter = buildQdrantFilter(input.filter ?? {}) }
    catch (error) { throw new SearchValidationError(error.message) }
    return { query: input.query.trim(), language, limit, scoreThreshold, filter }
  }

  async search(input) {
    const request = this.validate(input)
    const started = this.clock()
    const consistencyEnabled = this.config.searchConsistencyVerificationEnabled === true
    const constraints = consistencyEnabled ? extractStructuredQueryConstraints(request.query) : {}
    const consistencyApplied = Object.keys(constraints).length > 0
    const candidateMultiplier = Number.isInteger(this.config.searchConsistencyCandidateMultiplier)
      ? this.config.searchConsistencyCandidateMultiplier
      : 5
    const candidateLimit = consistencyApplied
      ? Math.min(this.config.searchMaxLimit, request.limit * candidateMultiplier)
      : request.limit

    const embeddingStarted = this.clock()
    const vector = await this.embeddingProvider.embedQuery(request.query)
    const embeddingMs = this.clock() - embeddingStarted
    const qdrantStarted = this.clock()
    const points = await this.qdrant.querySemantic({
      vector,
      filter: request.filter,
      limit: candidateLimit,
      scoreThreshold: request.scoreThreshold
    })
    const qdrantMs = this.clock() - qdrantStarted

    const mappedResults = points.map((point) => ({
      id: point.payload?.entity_id ?? String(point.id),
      score: point.score,
      type: point.payload?.type ?? null,
      name: { en: point.payload?.name_en ?? null, vi: point.payload?.name_vi ?? null },
      description: { en: point.payload?.description_en ?? null, vi: point.payload?.description_vi ?? null },
      continent: point.payload?.continent ?? null,
      region: point.payload?.region ?? null,
      population: point.payload?.population ?? null,
      facts: point.payload?.facts ?? {},
      bilingual_state: point.payload?.bilingual_state ?? null
    }))

    const verification = consistencyApplied
      ? applyConsistencyVerification(request.query, mappedResults)
      : { constraints: {}, acceptedResults: mappedResults, rejectedResults: [] }
    const domainEntityIntentEnabled = this.config.searchDomainEntityIntentGateEnabled === true
    const domainEntityIntentGate = domainEntityIntentEnabled
      ? applyDomainEntityIntentGate(request.query, verification.acceptedResults)
      : { intent: null, acceptedResults: verification.acceptedResults, rejectedResults: [] }
    const results = domainEntityIntentGate.acceptedResults.slice(0, request.limit)
    const rejectionReasonCounts = {}
    for (const rejected of verification.rejectedResults) {
      for (const reason of rejected.consistency_rejection_reasons ?? []) {
        rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] ?? 0) + 1
      }
    }
    const publicConstraints = {}
    if (verification.constraints.entityType) publicConstraints.entity_type = verification.constraints.entityType
    if (verification.constraints.continent) publicConstraints.continent = verification.constraints.continent
    if (verification.constraints.capital) publicConstraints.capital = verification.constraints.capital
    const domainIntentRejectionReasonCounts = {}
    for (const rejected of domainEntityIntentGate.rejectedResults) {
      for (const reason of rejected.domain_intent_rejection_reasons ?? []) {
        domainIntentRejectionReasonCounts[reason] = (domainIntentRejectionReasonCounts[reason] ?? 0) + 1
      }
    }

    return {
      query: { text: request.query, language: request.language },
      search: {
        mode: 'semantic',
        embedding_model: this.config.embeddingModel,
        vector_dimension: this.config.embeddingDimension,
        distance: 'Cosine'
      },
      results,
      meta: {
        limit: request.limit,
        count: results.length,
        consistency_verification: {
          enabled: consistencyEnabled,
          applied: consistencyApplied,
          candidate_limit: candidateLimit,
          candidate_count: mappedResults.length,
          rejected_count: verification.rejectedResults.length,
          constraints: publicConstraints,
          rejection_reason_counts: rejectionReasonCounts
        },
        domain_entity_intent: {
          enabled: domainEntityIntentEnabled,
          applied: domainEntityIntentGate.intent !== null,
          intent: domainEntityIntentGate.intent,
          rejected_count: domainEntityIntentGate.rejectedResults.length,
          rejection_reason_counts: domainIntentRejectionReasonCounts
        },
        timing_ms: {
          embedding: Number(embeddingMs.toFixed(3)),
          qdrant: Number(qdrantMs.toFixed(3)),
          total: Number((this.clock() - started).toFixed(3))
        }
      }
    }
  }
}
