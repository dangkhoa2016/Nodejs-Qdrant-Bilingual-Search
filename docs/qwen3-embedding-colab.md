# Qwen3-Embedding-4B on Google Colab T4
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](qwen3-embedding-colab.vi.md)

> **Canonical promotion note (2026-08-26):** the application now targets `knowledge_entities_qwen3_4b_text_v21` with `embedding_text v2.1` by default. This document contains historical v1 bootstrap/reseed commands; keep `knowledge_entities_qwen3_4b_v1` as rollback/reference and do not run destructive v1 commands unless you explicitly intend to rebuild that reference collection.


This is the fast development/benchmark path for evaluating `Qwen/Qwen3-Embedding-4B` without changing the Node.js/Qdrant architecture.

## Why this path

- Keep `intfloat/multilingual-e5-small` and `knowledge_entities_e5_real_v1` as the accepted baseline.
- Run Qwen3-Embedding-4B as a separate embedding service on a Colab T4.
- Use CUDA FP16, 2560-dimensional embeddings, a Qwen3 query instruction, left tokenizer padding, and a bounded sequence length.
- Expose the temporary service through a Cloudflare Quick Tunnel only for development/benchmarking.
- Seed Qwen into a **new** Qdrant collection. Never overwrite the E5 baseline collection.

## Colab

Clone/extract the repository in Colab, enable a T4 runtime, then run:

```bash
bash scripts/colab/run-qwen3-embedding-t4.sh
```

The script starts both the embedding service and Cloudflare Quick Tunnel in the background, waits for the tunnel URL, prints it to the cell, and returns control to the notebook. URL/PID/log files are stored at:

```text
.runtime/colab-qwen3/cloudflared.url
.runtime/colab-qwen3/cloudflared.pid
.runtime/colab-qwen3/cloudflared.log
.runtime/colab-qwen3/embedding.pid
.runtime/colab-qwen3/embedding.log
```

You can print the current endpoint again with:

```bash
cat .runtime/colab-qwen3/cloudflared.url
```

The script defaults to:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cuda
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_SEQ_LENGTH=512
```

The service keeps the existing HTTP contract:

```text
GET  /health
GET  /model
POST /embed/query
POST /embed/documents
```

Qwen queries use a versioned domain instruction. Documents are embedded without the old E5 `passage:` prefix.

The `/model` response includes the semantic backend plus the Qwen runtime/profile provenance. `/embed/query` and `/embed/documents` also expose server-side `inference_ms` for tunnel-vs-model latency diagnosis.


## Stop and clean the Colab side

To stop both managed processes and purge all Qwen Colab runtime state while preserving the Hugging Face model cache:

```bash
bash scripts/colab/stop-qwen3-embedding.sh
```

This removes `.runtime/colab-qwen3` (PID, URL, logs, downloaded quick-tunnel binary) but does **not** remove `${HF_HOME:-~/.cache/huggingface}`. The next Qwen start can therefore reuse the downloaded model weights.

## Node/Qdrant side

Use the `https://*.trycloudflare.com` URL printed by `cloudflared`:

```bash
export EMBEDDING_URL='https://REPLACE.trycloudflare.com'
export EMBEDDING_MODEL='Qwen/Qwen3-Embedding-4B'
export EMBEDDING_DIMENSION='2560'
export EMBEDDING_VERSION='qwen3-4b-v1'
export EMBEDDING_REQUEST_TIMEOUT_MS='120000'
export QDRANT_COLLECTION='knowledge_entities_qwen3_4b_v1'
```

Verify the remote runtime before seeding:

```bash
curl -s "$EMBEDDING_URL/model" | jq .
```

Expected important fields:

```text
model          Qwen/Qwen3-Embedding-4B
dimension      2560
backend        sentence-transformers
implementation python-fastapi
semantic       true
accelerator    gpu
device         cuda
dtype          float16
runtime        pytorch-cuda
profile        qwen3
query_strategy prompt
document_strategy raw
```

If the accepted 20k `data/generated/entities.final.json` is still available, seed that exact file so the experiment **does not rebuild GeoNames/WOF** and changes only the model/runtime. For remote Colab embedding, keep the GPU minibatch at 8 while using a larger Node HTTP batch (64 by default) to reduce Cloudflare round trips.

For a destructive clean run of the Qwen collection, use the guarded helper:

```bash
npm run seed:clean:qwen3 -- \
  --confirm-delete knowledge_entities_qwen3_4b_v1 \
  --dataset data/generated/entities.final.json
```

The helper stops any previous seed process first, requires a Qdrant API key, sends it as the `api-key` header, deletes and confirms absence of the Qwen collection, purges old Qwen seed progress/run evidence, verifies the embedding `/model` contract, then starts `seed:existing` from zero points with `SEED_BATCH_SIZE=64`. It never deletes the canonical dataset or the protected E5 baseline collection.

`seed:existing` still fails closed on semantic provenance. Only fall back to `seed:public` when the final dataset file is unavailable. If CUDA memory is tight, reduce `EMBEDDING_BATCH_SIZE` to `4` or `2` before considering quantization.

After the seed completes:

```bash
npm run verify:semantic-index -- 20000
npm start
npm run benchmark
```

## Important comparison rule

Do not delete or mutate:

```text
knowledge_entities_e5_real_v1
```

The useful experiment is an A/B comparison between the accepted E5 baseline and the new Qwen collection under the same benchmark corpus.

## Production

Cloudflare Quick Tunnel and Colab are only the experiment environment. After model selection, deploy the same FastAPI service to Modal or Beam on an L4/A10/A10G-class GPU, reseed the final production collection, and run the provenance audit again.

## Live embedding/seed tracking

The embedding service exposes cumulative successful inference counters:

```bash
curl -fsS http://127.0.0.1:8001/stats | jq .
```

Important fields:

```text
requests.document_requests
requests.documents_embedded
requests.last_document_batch_size
requests.document_inference_ms
requests.query_requests
requests.queries_embedded
requests.uptime_seconds
```

Each successful document batch is also logged in `.runtime/colab-qwen3/embedding.log` as an application-level event similar to:

```text
embedding_documents_completed batch=8 requests=125 documents=1000 inference_ms=...
```

This counter measures work accepted and completed by the embedding service. Retries can make it larger than the number of unique Qdrant points, so use Qdrant `points_count` as the authoritative committed-point count.

On the Node/Qdrant machine, the seed commands persist:

```text
reports/seed-progress.json    current atomic snapshot
reports/seed-progress.jsonl   timestamped progress event stream
```

Each run gets a stable `seedRunId`. By default console/file progress is throttled to roughly one update per 1% of batches. Override with `SEED_PROGRESS_EVERY_BATCHES`.

For an authenticated Qdrant deployment, monitor the committed collection count with the repository helper:

```bash
export QDRANT_URL='https://YOUR-QDRANT'
export QDRANT_API_KEY='...'
export QDRANT_COLLECTION='knowledge_entities_qwen3_4b_v1'
npm run seed:status -- --expected 20000 --interval 5
```

The helper sends the key in the Qdrant `api-key` request header and never prints the secret. Equivalent one-shot raw curl:

```bash
curl -fsS \
  -H "api-key: $QDRANT_API_KEY" \
  "$QDRANT_URL/collections/$QDRANT_COLLECTION" \
  | jq '{status:.result.status, points:.result.points_count, indexed:.result.indexed_vectors_count}'
```

## Binary Float32 transport and pre-seed micro-benchmark

The service keeps the JSON endpoint for compatibility and adds:

```text
POST /embed/documents/binary
Content-Type: application/x-float32
```

The response is contiguous little-endian Float32, row-major `[count, dimension]`. `/model` must advertise:

```json
{
  "transports": {
    "json": true,
    "float32_binary": true
  }
}
```

On the Node/Qdrant machine, keep JSON as the global backward-compatible default, but explicitly select binary for the Qwen experiment:

```bash
export EMBEDDING_TRANSPORT='binary-f32'
```

Binary mode is fail-closed: `HttpEmbeddingProvider.assertCompatible()` and the destructive `seed:clean:qwen3` wrapper refuse to proceed if the remote service does not advertise binary support. Transport selection is deliberately excluded from semantic runtime provenance/fingerprinting because JSON vs Float32 wire encoding does not change the model, document text, or embedding semantics.

Before deleting/reseeding the Qwen collection, compare both transports against the same canonical document subset without touching Qdrant:

```bash
npm run benchmark:embedding-transport -- \
  --dataset data/generated/entities.final.json \
  --count 256 \
  --batch-size 64 \
  --transports json,binary-f32 \
  --output reports/embedding-transport-benchmark.json
```

The report records, per transport:

```text
serverInferenceMs
httpRoundTripMs
transferOverheadMs
wallMs
serverInferenceDocsPerSecond
httpDocsPerSecond
endToEndDocsPerSecond
```

Only continue to a destructive clean 20k seed when the binary run shows a clear end-to-end improvement. For the full run:

```bash
export EMBEDDING_TRANSPORT='binary-f32'
npm run seed:clean:qwen3 -- \
  --confirm-delete knowledge_entities_qwen3_4b_v1 \
  --dataset data/generated/entities.final.json \
  --seed-http-batch-size 64
```

Seed progress now separates cumulative GPU/server inference, embedding HTTP round-trip, transfer overhead, Qdrant upsert time, and GPU/HTTP/E2E/Qdrant throughput. Keep `EMBEDDING_BATCH_SIZE=8` on T4 for the first binary comparison; only tune HTTP batch 128/256 after binary batch 64 is measured.
