# Kaggle CPU Transformers FP16 variation — Qwen3-Embedding-4B
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](qwen3-embedding-kaggle-transformers-fp16.vi.md)

This add-on is for `nodejs-qdrant-bilingual-search`. It ports the proven v0.2 native
Transformers/PyTorch **CPU FP16** embedding runtime so the repository can serve the
canonical 20K Qwen3 index using a `transformers` (native `AutoModel`/`AutoTokenizer`)
backend on Kaggle CPU, instead of the historical GPU SentenceTransformers executor.

## Target source baseline

```text
branch:  feat/qwen3-transformers-fp16-kaggle-input
HEAD:    743800828c89db582cae90fc275bec19fb9b00e3 (start)
```

It keeps the exact canonical semantic-search contract unchanged:

```text
model identity            Qwen/Qwen3-Embedding-4B
vector dimension          2560
embedding profile         qwen3
query strategy            prompt
document strategy         raw
query instruction ID      geo-retrieval-v1:d014d3ec6df87e49
prompt                    "Instruct: Retrieve the geographic entity that best answers the query\nQuery:"
embedding text version    v2.1
canonical collection      knowledge_entities_qwen3_4b_text_v21
score threshold           0.55
public vector dtype       float32 (L2-normalized, finite)
```

## What changes

Kaggle helpers are added / updated:

```text
scripts/kaggle/ensure-node22.sh
scripts/kaggle/resolve-qwen3-transformers-input.mjs
scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
scripts/kaggle/package-review-evidence.sh
```

A native Transformers adapter replaces the SentenceTransformers numeric path in the
embedding service:

```text
embedding-service/transformers_engine.py   AutoTokenizer + AutoModel adapter
embedding-service/pooling.py               last-token pooling -> Float32 -> L2 normalize
```

The numerical path is the proven v0.2 runtime:

```text
tokenize -> forward (FP16, use_cache off, CPU) -> last-token pooling
  -> cast to Float32 -> L2 normalize in Float32 -> Float32[2560]
```

No BF16 or FP32 substitution is silently performed. The loaded model parameter dtype is
verified against the requested `float16` immediately after load and the service fails
closed on mismatch.

## Model source: Kaggle Input (read-only)

The model comes from Kaggle Input, **not** from Hugging Face and **not** a working copy:

```text
/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/transformers/default/1
```

`/kaggle/input` is read-only. No download from HF and no working-tree copy of the weights
is performed. The resolver validates the model root without reading every weight byte.

The service reports truthful metadata:

```text
backend=transformers
implementation=python-fastapi
runtime=pytorch-cpu
device=cpu
dtype=float16
dimension=2560
profile=qwen3
```

## Operator command

Start the embedding service (and, via the repository lifecycle, the full demo) with the
dedicated wrapper:

```bash
bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

The repository contract is Node.js 22+. Before the JavaScript resolver is invoked, the
wrapper sources `scripts/kaggle/ensure-node22.sh`. A compatible Node already on `PATH` is
reused. Otherwise a cached portable Node 22 under `/kaggle/working` is reused; if none
exists, the helper downloads the pinned official Node 22 archive, verifies it against the
official `SHASUMS256.txt`, and prepends its `bin` directory to `PATH`. The current pinned
default is `22.23.2`; set `KAGGLE_NODE_VERSION` explicitly only when intentionally
upgrading this operator profile. The model itself remains fully offline/read-only under
`/kaggle/input`.

The wrapper exports a fail-closed contract:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cpu
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=1
EMBEDDING_MAX_SEQ_LENGTH=512
EMBEDDING_TRANSPORT=binary-f32
MAX_CONCURRENT_INFERENCE=1
UVICORN_WORKERS=1
WARMUP_ON_STARTUP=true
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

It fails closed if a conflicting model/profile/dimension/device/dtype/transport is already
exported. Dry-run contract inspection does not start a service:

```bash
QWEN3_TRANSFORMERS_DRY_RUN=1 bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

## Canonical Qdrant index reuse

This is a **query-runtime model artifact change only**. It does **not** reseed the
canonical 20K collection. The historical GPU/FP16 SentenceTransformers execution
provenance baked into the snapshot payload (`backend=sentence-transformers`,
`gpu`/`cuda`/`pytorch-cuda`) differs from the live `transformers` CPU executor. Because
`model`, `dimension`, `profile`, query/document strategies, instruction ID and text
version all match, the repository's semantic-index verifier treats the two runtimes as
semantically compatible while continuing to enforce the semantic identity strictly.

## Runtime acceptance

After startup, `/model` must report `backend=transformers`, `dtype=float16`,
`device=cpu`, `dimension=2560`. For one binary document vector, the transport returns
`1 x 2560 x 4 = 10240` little-endian Float32 bytes that decode to a finite, L2-normalized
vector.

Opt-in real-model acceptance tests exist and are skipped unless gated:

```bash
cd embedding-service
RUN_REAL_MODEL_TESTS=1 python -m pytest -q tests/real_model
```

## Known diagnostic limitation (Fuji/Japan and VI city-over-country)

Canonical 20K semantic verifier = `20000 / 20000 PASS`. The stable/canonical compatibility
sentinel set holds: Thailand EN, Tokyo VI and Beijing VI each hold rank #1. A separate, stricter
relation-style diagnostic set is narrower: the Vietnamese "country whose capital / famous for X"
capital-form query does not return the country at rank #1 — the frozen model scores the
homonymous city slightly above the parent country (Bangkok city ≈ 0.660 over Thailand country
≈ 0.659 for the VI capital-form), so the strict `entity_type=country` gate rejects the city and
the expected country is not returned at rank #1 for that query form. The same holds for the
EN/VI "country famous for Mount Fuji" relation (Fuji city above Japan). On true FP32 the same
city-over-country rank ordering is reproduced on the same snapshot with slightly different
scores, so this is evidence that the result is not specific to FP16, not evidence of
byte-identical cross-dtype outputs, and not a float16 artifact. Fuji/Japan and these
city-over-country relation queries remain diagnostic-only and are not a phase gate.

## Focused tests

```bash
node --test tests/unit/kaggle-qwen3-transformers-input.test.js
node --test tests/unit/runtime-provenance.test.js tests/unit/qdrant-service.test.js
```

The suite covers the Kaggle resolver, the CPU/FP16 wrapper contract, the opt-in real-model
acceptance, and the semantic-identity-vs-execution-provenance classifier.


## Evidence packaging rule

Release/acceptance evidence must not hash itself. Build the evidence archive only after
all review files are final:

```bash
bash scripts/kaggle/package-review-evidence.sh \
  "$RUN_ROOT/review" \
  "/kaggle/working/${RUN_ID}-qwen3-transformers-fp16-node-acceptance.zip"
```

The helper deliberately excludes `SHA256SUMS.txt` from its own manifest, verifies the
manifest before packaging, re-extracts the ZIP, verifies the manifest again, runs
`unzip -t`, and writes an external ZIP `.sha256`. Do not put the SHA-256 of the evidence
ZIP inside `review/result.json`: that would create a circular self-reference because
changing `result.json` changes the ZIP digest. The authoritative archive digest is the
external `<archive>.sha256` file.
