# Production Qdrant connection layer
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](qdrant-connection.vi.md)

The application treats Qdrant as one logical dependency even when the physical deployment is local, Beam.cloud, or Modal.com.

## Boundary

```text
QDRANT_PROVIDER + provider-specific env
                │
                ▼
       configuration resolver
                │ one immutable profile
                ▼
       QdrantConnection factory
                │
        raw QdrantClient (private)
                │ retry / timeout / probe
                ▼
          QdrantService
                │
       search / entity / seed
```

Only configuration and connection infrastructure know provider names. `QdrantService`, search, entity, Hono routes, and seed business logic never branch on Beam or Modal.

`tests/unit/qdrant-boundary.test.js` enforces this architectural rule.

## Provider selection

```bash
# Local
QDRANT_PROVIDER=local
QDRANT_LOCAL_URL=http://127.0.0.1:6333

# Beam
QDRANT_PROVIDER=beam
QDRANT_BEAM_URL=https://YOUR-BEAM-QDRANT-ENDPOINT
QDRANT_BEAM_API_KEY=...

# Modal
QDRANT_PROVIDER=modal
QDRANT_MODAL_URL=https://YOUR-MODAL-QDRANT-ENDPOINT
QDRANT_MODAL_API_KEY=...
```

Exactly one profile is resolved when the process starts. The connection layer contains no list of fallback endpoints, so a retry cannot silently move data or queries to another deployment.

Generic `QDRANT_URL` / `QDRANT_API_KEY` remain compatibility fallbacks for the selected profile; provider-specific variables are preferred.

## Why there is no automatic Beam ↔ Modal failover

These deployments are independent single-node Qdrant instances. Automatic traffic switching would only be correct after proving a shared replication/data-version contract. Retry therefore means **retry the selected provider**, never select another provider.

## Retry classification

Transient failures:

```text
HTTP 408, 425, 429, 500, 502, 503, 504
ECONNRESET / ECONNREFUSED / ETIMEDOUT / EAI_AGAIN / ENOTFOUND / EPIPE
Undici connect/header/body/socket timeout failures
fetch/network/socket failures
```

Authentication/configuration failures:

```text
HTTP 401 / 403 → do not retry
other non-transient 4xx → do not retry
```

This matters for the tested Modal lifecycle, where an external request can first see provider/router `503` during cold start and later reach authenticated Qdrant. Repeating a bad API key does not improve availability, so 401/403 stop immediately.

Backoff is bounded exponential with jitter:

```text
min(maxDelay, baseDelay * 2^(attempt - 1)) ± jitter
```

Runtime requests and `waitUntilReady()` use separate attempt budgets. Defaults:

```text
request: 3 attempts, 250ms base, 2000ms max
startup/CLI: 8 attempts, 500ms base, 5000ms max
SDK request timeout: 10000ms
jitter: 20%
```

## Readiness

`GET /health` checks only whether the Node process is alive.

`GET /ready` performs **one** authenticated Qdrant probe and one embedding-service probe. It does not sleep through the startup retry budget, which keeps readiness checks fast for orchestrators.

Example during a Modal cold start:

```json
{
  "ready": false,
  "qdrant": {
    "ready": false,
    "provider": "modal",
    "status": "unavailable",
    "http_status": 503,
    "transport_code": null,
    "latency_ms": 12.3
  },
  "embedding": {
    "ready": true,
    "status": "ready"
  }
}
```

A 401/403 probe maps to `status: "unauthorized"`. API keys and raw upstream error messages are never returned.

CLI flows that must wait for Qdrant, such as seed, call `waitUntilReady()` and use the longer bounded startup policy.

## Persistence boundary inherited from Qdrant Native Portable validation

The connection layer does **not** implement backup or restore. That responsibility stays inside the selected Qdrant deployment.

The provider validation this design is based on established:

- Modal: periodic durable snapshots on Modal Volume, tested nominal durability RPO `<= 600s`, no guaranteed last-second shutdown snapshot.
- Beam: local live DB plus completed durable full snapshots on Beam Volume, newest-valid restore, corrupt-newest fallback, all-corrupt fail-closed behavior.
- During Beam all-corrupt fail-closed testing, external probes stayed 503 instead of exposing a false healthy empty database.

The Node application therefore consumes readiness and data semantics; it does not orchestrate provider snapshot lifecycle.

## Retry-safe operations used by this repository

All Qdrant operations currently routed through `execute()` are retry-safe in this application context:

- query / retrieve / stats / collection listing are reads;
- upsert uses deterministic UUIDv5 point IDs;
- collection creation tolerates an already-created race;
- payload-index creation tolerates an already-indexed race.

If a future non-idempotent Qdrant operation is introduced, its retry semantics must be reviewed before routing it through the generic retry boundary.

## Seed compatibility gate

`seed:public` does not treat deterministic UUID upsert alone as sufficient idempotency. Before the expensive dataset build, non-dry-run `seed:public` first checks embedding compatibility and Qdrant readiness/schema, then revalidates them immediately before seed-state verification and embedding. Before writing points it:

1. verifies the embedding service reports the configured model/dimension and a real semantic runtime provenance; public seed rejects mock/unverified backends;
2. verifies the Qdrant collection uses the configured unnamed vector dimension with Cosine distance;
3. ensures and validates all payload index data types, including `index_fingerprint: keyword`;
4. computes fingerprint v2 from the final entities plus embedding model/version, embedding-text version, and runtime provenance;
5. prefers Qdrant exact counts for total/fingerprint state; if strict mode disables exact search, performs an exact application-side count via bounded paginated scroll with vectors disabled and only `index_fingerprint` selected.

The scroll fallback respects `strict_mode_config.max_query_limit`, so the seed workflow does not require disabling Qdrant strict mode. An empty collection is `fresh`. A partial collection containing only the same fingerprint is `resume`. An exact complete match is `idempotent` and skips embedding/upsert. Any foreign fingerprint or unexpected extra point fails closed. This deliberately avoids automatic deletion; migrations should use a new collection name or an explicit reset workflow.


### Semantic index provenance audit

After a real seed, `npm run verify:semantic-index -- 20000` performs a read-only paginated audit of the configured collection. It selects only `embedding_backend`, `embedding_implementation`, and `embedding_semantic` (no vectors), respects strict-mode query limits, and fails unless every expected point matches the verified live semantic embedding runtime. Collections seeded before fingerprint v2 do not contain this proof and must be treated as unverified for semantic-quality evaluation.

## Authenticated curl and seed progress

The Node.js SDK receives the selected profile's API key through `QdrantClient({ apiKey })`. Raw `curl` commands must do the equivalent explicitly using Qdrant's `api-key` header; do not put the key in the URL:

```bash
curl -fsS \
  -H "api-key: $QDRANT_API_KEY" \
  "$QDRANT_URL/collections/$QDRANT_COLLECTION" \
  | jq .
```

For seed/import monitoring, prefer the helper because it resolves the selected provider-specific `QDRANT_<PROVIDER>_URL` / `QDRANT_<PROVIDER>_API_KEY` first, then the generic fallback, and does not print credentials:

```bash
npm run seed:status -- --expected 20000 --interval 5
```

`--once` performs one authenticated request and exits. The default watch mode repeats every five seconds.

All seed entry points also write a throttled human-readable progress line plus machine-readable state:

```text
reports/seed-progress.json
reports/seed-progress.jsonl
```

Each run gets a `seedRunId`. A progress record includes stage, batch/total batches, embedded/upserted counts, percent, entities/second, ETA, cumulative embedding time, and cumulative Qdrant upsert time. `stage=failed` preserves the last committed counters when an embedding or Qdrant operation fails.
