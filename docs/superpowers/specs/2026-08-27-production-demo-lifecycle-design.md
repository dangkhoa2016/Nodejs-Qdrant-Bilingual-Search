# Production Demo Lifecycle Design

## Goal

Provide one-command lifecycle management for the canonical Node.js/Qdrant/Qwen3 bilingual search demo without changing retrieval quality behavior.

## Scope

The demo manages four processes: local Qdrant, local Qwen3 embedding service, Node API, and an optional Cloudflare Quick Tunnel that targets only the Node API. Existing externally-started healthy services are reused and are never stopped by the demo lifecycle.

## Canonical runtime

- Qdrant collection: `knowledge_entities_qwen3_4b_text_v21`
- Embedding model: `Qwen/Qwen3-Embedding-4B`
- Dimension: `2560`
- Transport: `binary-f32`
- Embedding text: `v2.1`
- Score threshold: `0.55`
- Consistency verification: enabled, multiplier `5`
- Domain/entity-intent gate: enabled
- Expected points: `20000`

No seed, benchmark, threshold tuning, model change, dataset change, or collection change is part of demo startup.

## Command surface

`./run.sh` and `./run.sh start` start or reuse the stack. `./run.sh stop`, `restart`, and `status` provide lifecycle operations. `npm run demo` executes a five-query bilingual showcase. `npm run smoke:production` performs short health, canonical-info, positive-search, and negative-intent checks.

## Ownership and state

Demo-owned state lives under `.runtime/production-demo` by default and logs under `logs/production-demo`. PID files are written only for processes started by the demo. A healthy service already listening on its expected endpoint is marked `EXTERNAL/READY` and not given a PID file. Stop operations act only on PID files whose live process command line matches the expected service signature; stale or mismatched PID files are removed instead of killing unrelated processes.

## Startup flow

1. Validate required local tools and canonical environment defaults.
2. Ensure Node dependencies when requested.
3. Reuse a healthy local Qdrant or start a local binary using `QDRANT_BIN`; if unavailable, optionally download the configured release into the demo runtime bin directory.
4. Wait for Qdrant with a bounded timeout.
5. Reuse a healthy embedding service or start Uvicorn from `embedding-service/` with canonical Qwen3 defaults.
6. Wait for `/health`, then validate `/model` contains model `Qwen/Qwen3-Embedding-4B` and dimension `2560`.
7. Verify canonical config and the existing 20,000-point semantic index. Failure is fail-closed; startup never reseeds automatically.
8. Reuse or start the Node API and wait for `/ready`.
9. If public mode is enabled, start/reuse a Cloudflare Quick Tunnel pointing to `http://127.0.0.1:3000`. Tunnel failure is non-fatal for the local demo.
10. Print service state and local/public URLs.

## Security

Qdrant binds to localhost. The embedding service binds to localhost. Cloudflare points only to the Node API. Secrets are read from environment variables and are never written to generated artifacts or status output.

## Failure behavior

All mandatory service readiness loops are bounded. Startup failures print the relevant log tail and return non-zero. Tunnel failure prints a warning and leaves the local demo running. `stop` sends SIGTERM, waits for a bounded interval, then SIGKILL only for a verified demo-owned process.

## Testing

Shell lifecycle behavior is tested with temporary fake binaries/endpoints before implementation (RED then GREEN), including repeated start/reuse, stale PID handling, safe stop, tunnel target, and tunnel non-fatal failure. Demo/smoke response validation is implemented in Node using native `fetch`, with focused unit tests for response assertions. Full source verification includes targeted tests, existing unit tests available without external dependencies, `node --check`, `bash -n`, `git diff --check`, and ZIP integrity.
