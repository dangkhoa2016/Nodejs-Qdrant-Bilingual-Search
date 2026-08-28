# Node.js Qdrant Bilingual Open Knowledge Search

English/Vietnamese semantic search over a reproducible 20,000-entity open-geography corpus, powered by **Node.js + Hono + Qdrant + Qwen3-Embedding-4B**.

The accepted `v1.0.0` runtime is designed for a portable Kaggle CPU environment: the Qwen3 model is loaded read-only from `/kaggle/input`, inference runs with **Transformers / PyTorch / CPU / FP16**, and the public embedding interface remains normalized **Float32[2560]** over `binary-f32` transport.

Vietnamese documentation: [README.vi.md](README.vi.md)

## Release snapshot

| Area | Validated `v1.0.0` state |
| --- | --- |
| Embedding model | `Qwen/Qwen3-Embedding-4B` |
| Languages | English + Vietnamese |
| Canonical corpus | 20,000 / 20,000 entities |
| Vector dimension | 2560 |
| Distance | Cosine |
| Runtime | Transformers / PyTorch / CPU / FP16 |
| Public vector | normalized `Float32[2560]` |
| Transport | `binary-f32` |
| Canonical semantic verifier | 20,000 / 20,000 PASS |
| Stable smoke sentinels | Thailand EN, Tokyo VI, Beijing VI = PASS |
| Node test suite | 447 / 447 PASS |
| CI | Node 22 + Node 24 + Python engine + Qdrant integration |

This repository is a **validated portable semantic-search demo/runtime profile**. It is not presented as a low-latency GPU serving stack.

## Architecture

```text
GeoNames + optional Who's On First enrichment
                    │
                    ▼
       canonical bilingual entities
                    │
          optional translation
                    │
                    ▼
 Qwen3-Embedding-4B embedding service
   Transformers / PyTorch / CPU / FP16
                    │
        normalized Float32[2560]
                    │ binary-f32
                    ▼
                Node.js
                  Hono
                    │
                    ▼
                  Qdrant
        canonical 20K collection
```

Default local service topology:

```text
Qdrant             http://127.0.0.1:6333
Embedding service  http://127.0.0.1:8001
Node API           http://127.0.0.1:3000
```

Only the Node API is intended to be exposed publicly by the optional demo tunnel. Qdrant and the embedding service remain localhost-only.

## Quick start

### Requirements

- Node.js `>=22`
- Python environment capable of running the embedding service
- Qwen3-Embedding-4B model files
- Qdrant with the canonical collection, or a separate collection you build yourself

Install Node dependencies:

```bash
npm ci
```

### Canonical Kaggle CPU-FP16 profile

Attach the Qwen3 model under Kaggle Input and point the demo at persistent Qdrant storage containing the verified 20K collection:

```bash
export QDRANT_STORAGE_PATH=/kaggle/working/qdrant-bilingual-search/qdrant-data
bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

The wrapper fails closed on conflicting runtime settings. It resolves the model read-only from `/kaggle/input`, enforces CPU FP16 with batch size 1, enables offline model loading, then starts the production-demo lifecycle.

Useful lifecycle commands:

```bash
./run.sh status
./run.sh restart
./run.sh stop
```

For local-only operation without a public Cloudflare Quick Tunnel:

```bash
DEMO_PUBLIC=0 bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

See [docs/production-demo.md](docs/production-demo.md) and [docs/qwen3-embedding-kaggle-transformers-fp16.md](docs/qwen3-embedding-kaggle-transformers-fp16.md) for the full operator contract.

## API example

After the services are ready:

```bash
curl -sS http://127.0.0.1:3000/api/v1/search \
  -H 'content-type: application/json' \
  -d '{"query":"quốc gia Đông Nam Á sử dụng đồng baht","language":"vi","limit":5,"score_threshold":0}'
```

Structured filtering is supported as part of the search request:

```bash
curl -sS http://127.0.0.1:3000/api/v1/search \
  -H 'content-type: application/json' \
  -d '{
    "query":"large city in Asia",
    "language":"en",
    "filter":{"type":"city","continent":"Asia","population":{"gte":5000000}},
    "limit":10
  }'
```

Health endpoints:

```text
GET /health
GET /ready
```

The embedding service exposes:

```text
GET  /health
GET  /model
POST /embed/query
POST /embed/documents
POST /translate   # only when local translation is enabled
```

## Canonical runtime contract

```text
model                = Qwen/Qwen3-Embedding-4B
backend              = transformers
implementation       = python-fastapi
runtime              = pytorch-cpu
device               = cpu
accelerator          = cpu
internal dtype       = float16
dimension            = 2560
public vector dtype  = float32
transport            = binary-f32
```

Internal model precision and public vector precision are intentionally distinct:

```text
FP16 model forward
→ last-token pooling
→ cast pooled tensor to Float32
→ Float32 L2 normalization
→ Float32[2560] public vector
→ binary-f32 transport
```

## Canonical semantic contract

```text
model                = Qwen/Qwen3-Embedding-4B
dimension            = 2560
profile              = qwen3
query_strategy       = prompt
document_strategy    = raw
query_instruction_id = geo-retrieval-v1:d014d3ec6df87e49
embedding_text       = v2.1
```

Exact query prompt:

```text
Instruct: Retrieve the geographic entity that best answers the query
Query:
```

These identifiers are part of the accepted semantic identity and must stay aligned with the Qdrant snapshot being queried.

## Canonical Qdrant state

```text
collection        = knowledge_entities_qwen3_4b_text_v21
points_count      = 20000
indexed_vectors   = 20000
vector size       = 2560
distance          = Cosine
status            = green
optimizer_status  = ok
```

For the accepted `v1.0.0` snapshot:

```text
RESEED = NO
SNAPSHOT_REUSE = APPROVED
```

Snapshot reuse is gated by semantic identity verification, not by filename alone. See [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) for the release evidence and scope.

Qdrant client profiles are selected once via `QDRANT_PROVIDER`: `local` for the default local connection, or `beam` / `modal` for a hosted single-node deployment. See [docs/qdrant-connection.md](docs/qdrant-connection.md).

## Dataset and enrichment

GeoNames `cities15000` is the canonical geographic backbone. Optional Who's On First enrichment contributes multilingual names through exact GeoNames concordance matching. Native Vietnamese names are preserved and take precedence over enrichment.

Build the public dataset:

```bash
npm run dataset:build
```

Example 20K build:

```bash
npm run dataset:build -- \
  --sources geonames,wof \
  --types country,city \
  --limit 20000
```

Translation enrichment is optional:

```text
none | local | openai | gemini | nvidia | groq
```

Translate an existing base dataset with `npm run dataset:translate`:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Cloud translation reads numbered per-provider keys such as `OPENAI_KEY1`, `GEMINI_KEY1`, `NVIDIA_KEY1` and `GROQ_KEY1`, supports bounded retry/cooldown behavior, and uses cache identities that never persist API key values. Details are in [docs/translation.md](docs/translation.md).

## Seeding and verification

Preview a public seed without connecting to Qdrant or consuming translation quota:

```bash
npm run seed:public -- \
  --sources geonames,wof \
  --types country,city \
  --limit 5000 \
  --translate groq \
  --model your-model-id \
  --dry-run
```

Verify an existing canonical index:

```bash
npm run verify:canonical-config
npm run verify:semantic-index -- 20000
npm run seed:status -- --once --expected 20000
```

The production lifecycle never silently rebuilds the canonical collection.

## Tests

Node tests:

```bash
npm test
```

Python embedding-engine tests:

```bash
PYTHONPATH=embedding-service \
python -m unittest discover -s embedding-service/tests -v
```

Real Qdrant integration:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

Production demo checks:

```bash
npm run demo
npm run smoke:production
```

## Validated retrieval scope

The stable compatibility sentinel set passes:

```text
Thailand EN = PASS
Tokyo VI    = PASS
Beijing VI  = PASS
```

A narrower relation-style diagnostic set exposes known model/snapshot ranking limitations. In particular, the strict Thailand capital-form query can produce a Bangkok-city vs Thailand-country near-tie, and Fuji/Japan relation queries remain diagnostic-only. These cases are documented as limitations rather than hidden or generalized into the canonical pass result.

Full details: [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md).

## Repository map

```text
src/                Node.js API, search, Qdrant, seed and dataset logic
embedding-service/  Python FastAPI Qwen3 embedding runtime
data/               fixtures, source catalogs and data provenance
scripts/            build, seed, verification, benchmark and demo tooling
docs/               architecture, operations, release and evidence documentation
tests/              unit, HTTP, architecture and integration tests
```

## Documentation

- [Release notes v1.0.0](docs/releases/v1.0.0.md)
- [Production demo](docs/production-demo.md)
- [Kaggle CPU Transformers FP16 profile](docs/qwen3-embedding-kaggle-transformers-fp16.md)
- [Architecture](docs/architecture.md)
- [Dataset and seeding](docs/dataset.md)
- [Translation providers](docs/translation.md)
- [Qdrant connection](docs/qdrant-connection.md)
- [Testing](docs/testing.md)
- [Engineering portfolio](docs/portfolio.md)
- [Changelog](CHANGELOG.md)

## Reference branch

`runtime/true-fp32` retains the proven prebuilt true-FP32 CPU implementation as an engineering/reference branch. It is not the canonical `v1.0.0` portable profile; `main` remains CPU FP16 because of its better Kaggle memory headroom.

## Known limitations

- CPU-oriented portable demo/runtime, not low-latency GPU serving.
- No reranker.
- No hybrid sparse+dense retrieval.
- No RAG layer.
- No automatic runtime reseeding.
- Relation-style diagnostics can expose model/snapshot ranking limitations even when canonical semantic verification passes.

## Security and provenance

- Never commit real API keys.
- Qdrant and the embedding service should remain private/local unless deliberately secured for remote use.
- Application code follows the repository license.
- Dataset sources have separate attribution requirements; see [data/LICENSE-DATA.md](data/LICENSE-DATA.md).

## Release

`v1.0.0` is the first public release of this project.

See the GitHub Release and [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) for the validated profile, evidence scope, and reproduction pointers.
