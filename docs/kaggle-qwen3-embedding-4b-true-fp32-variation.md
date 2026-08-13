# Kaggle CPU true-FP32 variation — Qwen3-Embedding-4B
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](kaggle-qwen3-embedding-4b-true-fp32-variation.vi.md)

This add-on is for `nodejs-qdrant-bilingual-search` after the runtime-contract reuse hardening baseline.

## Target source baseline

```text
branch: feat/runtime-contract-reuse-hardening
HEAD:   a2919438c848ef56156d0efe7cbc786a3a36dba1
```

It does **not** change the canonical semantic-search contract. In particular it does not change:

```text
model identity            Qwen/Qwen3-Embedding-4B
vector dimension          2560
embedding profile         qwen3
query strategy            prompt
document strategy         raw
query instruction ID      geo-retrieval-v1:d014d3ec6df87e49
embedding text version    v2.1
canonical collection      knowledge_entities_qwen3_4b_text_v21
score threshold           0.55
```

## What changes

Two Kaggle helpers are added:

```text
scripts/kaggle/resolve-qwen3-fp32-input.mjs
scripts/kaggle/run-qwen3-fp32-cpu.sh
```

The existing `EMBEDDING_MODEL_PATH` contract is reused. The canonical model identity remains `Qwen/Qwen3-Embedding-4B`; only the filesystem load target changes.

The resolver prefers:

```text
/kaggle/input/qwen-qwen3-embedding-4b/pytorch/fp32/1
```

and also supports the older Kaggle layout:

```text
/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/pytorch/fp32/1
```

If Kaggle chooses a different mount prefix, the resolver searches `/kaggle/input` for a unique structurally valid `qwen-qwen3-embedding-4b/.../pytorch/fp32/...` artifact.

It validates the model root without reading all weight bytes:

- `config.json` exists;
- `modules.json` exists;
- `model.safetensors.index.json` exists and has a non-empty `weight_map`;
- every shard referenced by the index exists and is readable.

The existing embedding service remains responsible for the stronger runtime truth check after load: the loaded Qwen parameters must match requested `float32`, and the production lifecycle must see the verified runtime contract.

## Kaggle setup

Attach the model variation to the Notebook through **Add Input → Models** and select the `Qwen/Qwen3-Embedding-4B` PyTorch `fp32` variation.

`/kaggle/input` is read-only. Do not copy or modify the model there.

Optional resolver-only check:

```bash
node scripts/kaggle/resolve-qwen3-fp32-input.mjs
```

Expected shape:

```json
{
  "model": "Qwen/Qwen3-Embedding-4B",
  "variation": "pytorch/fp32",
  "version": 1,
  "model_path": "/kaggle/input/.../pytorch/fp32/1",
  "source": "preferred",
  "shard_count": 8,
  "indexed_tensor_keys": 398
}
```

The exact `model_path` may differ if Kaggle changes the mount prefix. The resolver deliberately does not hard-require a single prefix.

## Run the production lifecycle with the FP32 variation

Use the dedicated wrapper instead of manually wiring the old default variation:

```bash
bash scripts/kaggle/run-qwen3-fp32-cpu.sh
```

For lifecycle subcommands:

```bash
bash scripts/kaggle/run-qwen3-fp32-cpu.sh status
bash scripts/kaggle/run-qwen3-fp32-cpu.sh stop
bash scripts/kaggle/run-qwen3-fp32-cpu.sh restart
```

The wrapper exports:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_MODEL_PATH=<resolved PyTorch/fp32 path>
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cpu
EMBEDDING_DTYPE=float32
EMBEDDING_BATCH_SIZE=1
EMBEDDING_MAX_SEQ_LENGTH=512
EMBEDDING_TRANSPORT=binary-f32
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

It fails closed if a conflicting model/profile/dimension/device/dtype/transport is already exported.

If an old session contains something like:

```bash
export EMBEDDING_MODEL_PATH=/kaggle/input/.../transformers/default/1
```

the resolver rejects it. Unset the stale value and rerun:

```bash
unset EMBEDDING_MODEL_PATH
bash scripts/kaggle/run-qwen3-fp32-cpu.sh
```

## Dry-run contract inspection

No service is started:

```bash
QWEN3_FP32_DRY_RUN=1 \
  bash scripts/kaggle/run-qwen3-fp32-cpu.sh
```

## Runtime acceptance

After startup, the existing fail-closed lifecycle is expected to accept only a model endpoint equivalent to:

```json
{
  "model": "Qwen/Qwen3-Embedding-4B",
  "dimension": 2560,
  "profile": "qwen3",
  "device": "cpu",
  "accelerator": "cpu",
  "dtype": "float32",
  "runtime": "pytorch-cpu",
  "runtime_contract": "embedding-runtime-dtype-verified-v1"
}
```

Check directly if needed:

```bash
curl -fsS http://127.0.0.1:8001/model | jq .
```

Do not accept BF16/FP16 while claiming FP32, and do not weaken the runtime-contract check to make startup pass.

## Existing Qdrant index

This change is a **query-runtime model artifact change only**. It does not require reseeding the canonical 20K collection merely because the inference device/dtype differs from the historical GPU/FP16 seed execution provenance. Keep the existing semantic-compatibility verifier and full provenance auditing behavior from the baseline source.

## Focused tests

```bash
node --test tests/unit/kaggle-qwen3-fp32-input.test.js
```

The test suite covers preferred and legacy Kaggle mount layouts, fallback discovery, explicit path validation, missing shard rejection, ambiguous discovery rejection, stale non-FP32 path rejection, and the CPU/FP32 wrapper contract.
