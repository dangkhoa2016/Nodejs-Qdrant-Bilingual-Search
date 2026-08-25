# Testing strategy
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](testing.vi.md)

## Unit tests

Pure domain and infrastructure boundaries are tested without Qdrant or ML downloads: config, provider selection, retry classification/backoff, readiness, runtime wiring, architecture boundaries, normalized entities, provenance, embedding text, HTTP embedding client, translation client, filter builder, Qdrant call shape, deterministic UUIDs, point mapping, seed batching, WOF archive/normalization, metrics and runtime sanitization.

Connection tests use injected clients, clocks, random functions and sleep functions. This makes 503 recovery, 401 fail-fast behavior and exact retry delays deterministic without real waiting.

## Architecture tests

`tests/unit/qdrant-boundary.test.js` prevents raw `QdrantClient` construction outside the production connection factory and prevents provider-specific branching from leaking into QdrantService/search/entity/Hono/seed layers.

## HTTP tests

Hono's in-process `app.request()` validates route status codes and public JSON contracts without opening a TCP port. Tests cover liveness, structured readiness, domain validation and safe `QDRANT_UNAVAILABLE` mapping.

## Python tests

The embedding and translation engines accept fake model/backends. Prefixing, dimensions, direction constraints and invalid results can therefore be tested without downloading large models.

## Real Qdrant integration

`tests/integration/qdrant.integration.test.js` is opt-in. It uses the **same production connection factory** as the application, waits for Qdrant readiness, creates a temporary collection, runs the real `SeedService` twice to prove `fresh → idempotent` fingerprint behavior, validates payload indexes and exact seed-state verification (exact count or strict-mode scroll fallback), performs Query API retrieval + stats, and deletes the collection in teardown.

CI runs this test against Qdrant v1.19.0.

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

## Why model-quality tests are separate

Unit tests should not depend on model downloads or nondeterministic similarity values. Retrieval quality is measured by the committed bilingual benchmark corpus through `npm run benchmark`.

## Running the real integration test against a selected provider

The integration test uses the same provider profile as production and performs destructive operations only inside a unique temporary collection that it removes afterward. It is opt-in via `RUN_QDRANT_INTEGRATION=1`.

Local CI/default:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

Beam:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=beam \
QDRANT_BEAM_URL=https://YOUR-BEAM-QDRANT-ENDPOINT \
QDRANT_BEAM_API_KEY='...' \
npm run test:integration
```

Modal:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=modal \
QDRANT_MODAL_URL=https://YOUR-MODAL-QDRANT-ENDPOINT \
QDRANT_MODAL_API_KEY='...' \
npm run test:integration
```

There is no fallback to another provider if the selected one is unavailable.
