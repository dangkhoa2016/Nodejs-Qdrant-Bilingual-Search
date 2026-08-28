# Architecture

## Boundaries

The application owns validation, multilingual normalization, translation provenance, embedding text construction, filter construction, deterministic IDs, batching, error mapping, evaluation and REST contracts.

Qdrant owns vector/payload storage, payload indexes, filtering and similarity ranking. Provider backup/restore stays inside the deployed Qdrant service rather than the Node application. The Python service owns local ML inference only; Node remains the primary application.

## Qdrant connection boundary

```text
QDRANT_PROVIDER
      ↓
config resolver
      ↓ exactly one local/Beam/Modal profile
QdrantConnection
      ├─ private raw @qdrant/js-client-rest client
      ├─ bounded retry + exponential backoff + jitter
      ├─ request timeout
      ├─ single-probe readiness
      └─ waitUntilReady startup/CLI policy
      ↓
QdrantService
      ↓
SearchService / EntityService / SeedService
```

There is deliberately no Beam↔Modal auto-failover. Upper layers do not contain provider-specific branches.

## Search path

```text
HTTP request
→ Hono
→ SearchService validation
→ high-confidence structured constraint extraction
→ EmbeddingProvider.embedQuery
→ application FilterBuilder
→ QdrantService.querySemantic
→ QdrantConnection.execute
→ selected Qdrant provider
→ bounded candidate pool
→ structured consistency verification (country / continent / capital, when applicable)
→ high-confidence domain/entity-intent compatibility gate (when applicable)
→ requested/default score-threshold-preserving result set
→ response mapper + timings + sanitized consistency + domain-intent observability
```


## Production consistency verification

Canonical v2.1 keeps dense retrieval as the retrieval engine and adds a conservative post-retrieval verifier for explicit structured constraints. The verifier is enabled by default with `SEARCH_CONSISTENCY_VERIFICATION_ENABLED=true`; constrained queries over-fetch up to `SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER=5` times the public result limit, capped by `SEARCH_MAX_LIMIT`. The Qdrant score threshold is not lowered or bypassed.

Only high-confidence `country`, `continent`, and `capital` constraints are enforced. If the parser cannot extract such a constraint, structured verification is not applied. A separate high-confidence domain/entity-intent layer then rejects geographic `city`/`country` results only for proven non-geographic media-content or sports-club-achievement intents. This gate is enabled canonically with `SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED=true`; it runs after structured consistency verification, adds no new embedding/Qdrant request, and exposes only sanitized metadata. Either verification layer can be disabled for operational rollback, but `verify:canonical-config` rejects that state as non-canonical.

## Data path

```text
GeoNames cities15000
        ↓ canonical geographic entities
representative deterministic selection
        ↓
GeoNames alternateNamesV2 (EN/VI)
        ↓
WOF exact gn:id enrichment (best effort)
        │ cache + archive SHA-256
        │ EN/VI preferred names + aliases only
        ↓
optional cached translation
none/local/openai/gemini/nvidia/groq
        ↓
buildEmbeddingText
        ↓
embedDocuments(batch)
        ↓
UUIDv5(canonical GeoNames entity ID)
        ↓
QdrantService → QdrantConnection
        ↓
deterministic batch upsert
```

GeoNames owns coordinates/population/admin/timezone facts. WOF never re-keys the entity and never performs fuzzy identity matching. Ambiguous or malformed WOF enrichment is quarantined rather than failing the canonical GeoNames build.

## Collection

Canonical default: `knowledge_entities_qwen3_4b_text_v21` with a 2560-dimension cosine dense vector produced by `Qwen/Qwen3-Embedding-4B` and `embedding_text v2.1`. `knowledge_entities_qwen3_4b_v1` remains a retained rollback/reference collection. Payload indexes cover `type`, `continent`, `region`, `country_code`, `source`, `population`, and operational `index_fingerprint`. Before seeding, the application validates the existing collection's unnamed vector dimension/distance and payload-index data types. Exact seed-state verification plus the deterministic fingerprint prevents mixed dataset/model states without deleting existing data. Qdrant exact counts are preferred; strict-mode deployments that disable exact search use a bounded paginated scroll over `index_fingerprint` only.

Changing embedding dimensionality/model should create a new collection rather than silently mixing incompatible vectors.

## Translation policy

Machine translation is optional because the embedding model is multilingual. Native Vietnamese wins; missing Vietnamese remains visible. Generated Vietnamese is marked `machine_translation` and records provider, model, prompt version, source hash and translation version.
