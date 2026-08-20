# Local embedding service
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](README.vi.md)

This is the only Python ML component. The public application server remains Hono/Node.js; Python is isolated to embedding inference.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

## Supported profiles

### E5 baseline

Default behavior stays backward compatible with the accepted baseline:

```text
EMBEDDING_MODEL=intfloat/multilingual-e5-small
EMBEDDING_PROFILE=auto
EMBEDDING_DIMENSION=384
```

Queries use `query:` and documents use `passage:`.

### Qwen3 candidate

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cuda
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_SEQ_LENGTH=512
```

Qwen queries use a versioned English retrieval instruction, while documents are embedded as raw semantic passages. The service uses left tokenizer padding as recommended by the Qwen3 model integration.

`EMBEDDING_MODEL` is the canonical semantic identity reported by `/model`, `/health` and provenance. `EMBEDDING_MODEL_PATH` optionally points at a local filesystem/model load target (for example a read-only Kaggle Input extraction) and controls only where weights are loaded from. When `EMBEDDING_MODEL_PATH` is absent/blank, loading falls back to `EMBEDDING_MODEL`:

```bash
export EMBEDDING_MODEL='Qwen/Qwen3-Embedding-4B'
export EMBEDDING_MODEL_PATH='/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/transformers/default/1'
```

The loaded Qwen model dtype is verified against the requested runtime dtype immediately after load; the service fails closed on mismatch and never silently substitutes BF16 while reporting FP32.

`/model` exposes enough provenance to distinguish the Qwen CUDA/FP16 generation from the legacy E5 baseline. See `docs/qwen3-embedding-colab.md` for the Colab T4 + Cloudflare Quick Tunnel workflow.

## Runtime statistics and logs

`GET /stats` exposes cumulative successful embedding work without loading vectors into the response:

```bash
curl -fsS http://127.0.0.1:8001/stats | jq .requests
```

It reports query/document request counts, total documents embedded, last document batch size, cumulative inference time, and service uptime. Successful requests are also logged through Uvicorn's configured logger, for example:

```text
embedding_documents_completed batch=8 requests=125 documents=1000 inference_ms=...
```

These counters are process-local and reset when the embedding service restarts. They measure completed inference work; Qdrant `points_count` remains the authoritative count of committed unique points.

## Document transport contracts

The legacy JSON endpoint remains available:

```text
POST /embed/documents
Content-Type: application/json
```

For high-dimensional Qwen seed/import traffic, the service also exposes a raw Float32 endpoint:

```text
POST /embed/documents/binary
Accept: application/x-float32
Content-Type: application/x-float32
```

The binary body is contiguous **little-endian Float32**, row-major, with shape `[count, dimension]`. Response headers carry the framing and server timing contract:

```text
X-Embedding-Count
X-Embedding-Dimension
X-Embedding-Dtype: float32
X-Embedding-Inference-Ms
```

`GET /model` advertises capabilities without changing semantic provenance:

```json
{
  "transports": {
    "json": true,
    "float32_binary": true
  }
}
```

The Node client defaults to `EMBEDDING_TRANSPORT=json` for backward compatibility. Set `EMBEDDING_TRANSPORT=binary-f32` for Qwen seed/import. Binary mode fails closed if `/model` does not advertise `float32_binary=true`; there is no silent fallback and no Base64 encoding.
