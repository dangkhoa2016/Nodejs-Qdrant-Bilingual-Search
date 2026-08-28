# Production Demo

The production demo is intentionally operational rather than benchmark-oriented. It keeps the verified search profile unchanged and manages Qdrant, the Qwen3 embedding service, the Node API, and an optional Cloudflare Quick Tunnel.

## Canonical profile

The demo fails closed if the application profile differs from the verified production state: `Qwen/Qwen3-Embedding-4B`, 2560 dimensions, `binary-f32`, embedding text `v2.1`, collection `knowledge_entities_qwen3_4b_text_v21`, threshold `0.55`, consistency enabled with multiplier `5`, and domain/entity-intent gate enabled. Startup also verifies that the existing semantic index contains the expected 20,000 points. It never seeds or rebuilds the collection automatically.

## One-command start

```bash
./run.sh
```

Equivalent:

```bash
./run.sh start
```

The lifecycle reuses a healthy Qdrant, embedding service, or Node API already running at its local endpoint. Reused services are not adopted and `./run.sh stop` will not terminate them.

The default topology is:

```text
Qdrant             http://127.0.0.1:6333
Embedding service  http://127.0.0.1:8001
Node API           http://127.0.0.1:3000
Cloudflare tunnel  -> Node API only
```

Qdrant and the embedding service are required to remain localhost-only. The lifecycle rejects remote URLs for those services.

## Lifecycle

```bash
./run.sh status
./run.sh restart
./run.sh stop
```

Runtime PID/signature state defaults to `.runtime/production-demo`. Logs default to `logs/production-demo`. The stop command verifies a PID's command signature before sending signals, so stale/reused PID values do not cause unrelated processes to be killed.

## Public vs local-only mode

Public mode is enabled by default:

```bash
DEMO_PUBLIC=1 ./run.sh
```

Local-only mode:

```bash
DEMO_PUBLIC=0 ./run.sh
```

Cloudflare failure is non-fatal. If no Quick Tunnel URL is obtained within the bounded wait, the failed tunnel process is cleaned up while Qdrant, embedding, and the local Node API remain available.

## Existing Qdrant data

The production lifecycle does not seed. Point it at the storage directory that already contains the canonical 20k collection:

```bash
QDRANT_STORAGE_PATH=/kaggle/working/qdrant-bilingual-search/qdrant-data ./run.sh
```

If Qdrant is already running on localhost with that collection, simply run `./run.sh`; it will reuse the existing process.

For an authenticated local Qdrant, put the key in `.env` or export either `QDRANT_LOCAL_API_KEY` or `QDRANT_API_KEY`. The key is used for readiness and application calls but is never printed by the lifecycle.

## Embedding runtime

Canonical defaults are CUDA/FP16:

```text
EMBEDDING_DEVICE=cuda
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_SEQ_LENGTH=512
```

If a pre-started canonical embedding service is already healthy at `127.0.0.1:8001`, the lifecycle reuses it and validates `/model` before continuing.

## Demo

After startup:

```bash
npm run demo
```

This executes only five representative requests: two English positive queries, two Vietnamese positive queries, and one Casablanca movie negative query proving that a geographic false positive is not returned. It is not a benchmark suite.

To use the public URL instead:

```bash
API_URL="$(cat .runtime/production-demo/public.url)" npm run demo
```

## Short production smoke

```bash
npm run smoke:production
```

It checks `/health`, `/ready`, canonical `/api/v1/info`, one English semantic query, one Vietnamese semantic query, and the Casablanca negative. To additionally verify the tunnel:

```bash
PUBLIC_API_URL="$(cat .runtime/production-demo/public.url)" npm run smoke:production
```

## Useful overrides

```text
DEMO_PUBLIC=0|1
DEMO_INSTALL_DEPS=0|1
DEMO_DOWNLOAD_QDRANT=0|1
QDRANT_BIN=/path/to/qdrant
QDRANT_VERSION=1.18.0
QDRANT_STORAGE_PATH=/path/to/storage
DEMO_RUNTIME_DIR=/path/to/runtime
DEMO_LOG_DIR=/path/to/logs
EXPECTED_POINTS=20000
```

On Kaggle, place persistent Qdrant data under `/kaggle/working`, not inside the source checkout if the checkout may be replaced between runs.

## Deterministic FP32 evidence accounting

The Kaggle CPU true-FP32 live run captures a monitor log that records `/proc/meminfo`
`MemAvailable` lines (kB) and `ps` process rows whose 5th field is the max RSS (kB/KiB).
A single deterministic helper converts those raw values into explicit byte/GiB fields and
writes the required evidence files, without hand-transcribing values from logs:

```bash
node scripts/kaggle/summarize-fp32-evidence.mjs \
  --resource-log runtime/resource-monitor.log \
  --result-json result.json \
  --result-txt RESULT.txt \
  --memory-summary runtime/memory-summary.txt \
  --classification PASS
```

Optional `--meta-json result.json` merges existing result metadata that cannot be parsed
from the monitor log. Fields whose names end in `_bytes` are true byte integers; `/proc`/`ps`
values labeled `kB` are treated as KiB for binary conversion (`N * 1024` bytes).
