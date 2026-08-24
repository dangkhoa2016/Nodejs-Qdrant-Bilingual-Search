# Production Demo
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](production-demo.vi.md)

The production-oriented Kaggle demo keeps the verified search profile unchanged while making the runtime topology and publication evidence explicit.

## Canonical profile

The accepted Kaggle runtime is `Qwen/Qwen3-Embedding-4B`, Transformers/PyTorch, CPU, FP16, batch size 1, 2560 dimensions, `binary-f32`, embedding text `v2.1`, collection `knowledge_entities_qwen3_4b_text_v21`, threshold `0.55`, with the existing canonical 20,000-point Qdrant snapshot. The demo restores the snapshot and never reseeds automatically.

## Canonical Kaggle notebook

Use:

```text
notebooks/kaggle-cpu-fp16-production-demo.ipynb
```

Import it from GitHub into a fresh Kaggle Notebook, enable Internet, use `Accelerator=None`, attach the canonical model and snapshot Dataset, then run **Restart Session → Run All**.

The safe defaults are:

```python
RUN_LIVE_DEMO = True
ENABLE_PUBLIC_TUNNEL = False
```

The notebook therefore validates the core local stack by default. Sections 6–7 are an optional authenticated public layer.

## Core local topology

```text
Node/Hono API       127.0.0.1:3000
Embedding service   127.0.0.1:8001
Qdrant              127.0.0.1:6333
```

The Kaggle CPU-FP16 wrapper forces `HOST=127.0.0.1`, and the Node server passes that hostname to `@hono/node-server`. The listener evidence gate fails closed if Node, the embedding service, or Qdrant is bound to a wildcard address.

The local deployment acceptance runs seven checks and ends with:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=7
```

## Optional authenticated public topology

To test temporary public access, explicitly set:

```python
ENABLE_PUBLIC_TUNNEL = True
```

The public path is:

```text
Internet
  -> Cloudflare Quick Tunnel
  -> 127.0.0.1:8090 Bearer-auth gateway
  -> 127.0.0.1:3000 Node API
  -> 127.0.0.1:8001 embedding service
  -> 127.0.0.1:6333 Qdrant
```

The gateway adds authentication, a safe route allowlist, rate limiting, body limits, request IDs, an upstream timeout, and public search concurrency 1. The Bearer token is session-local and its value must never be published.

Authenticated public acceptance first proves an unauthenticated `/health` request returns HTTP `401`, then runs the same seven core checks. A complete public run therefore ends with:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=8
```

Public PASS is not inferred merely from `ENABLE_PUBLIC_TUNNEL=True`. It is recorded only after the public acceptance cell actually completes. Otherwise the notebook reports `AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` or `AUTHENTICATED_PUBLIC_DEMO=INCOMPLETE`.

Quick Tunnel is a temporary demo endpoint, not SLA-backed 24/7 hosting.

## Stable acceptance cases

Hard gates are:

```text
Thailand EN = PASS target
Tokyo VI    = PASS target
Beijing VI  = PASS target
Casablanca geographic false-positive = absent
```

Fuji/Japan and the Thailand-VI capital-form relation case remain diagnostic-only.

Local acceptance:

```bash
node scripts/kaggle/production-demo-acceptance.mjs
```

Public acceptance:

```bash
API_URL="$(cat .runtime/production-demo-public/public.url)" \
DEMO_BEARER_TOKEN_FILE=.runtime/production-demo-public/demo-token \
node scripts/kaggle/production-demo-acceptance.mjs
```

## Evidence and publication gate

The notebook packages evidence with:

```bash
bash scripts/kaggle/collect-production-demo-notebook-evidence.sh
```

The collector now enforces these publication contracts:

- the Git working tree must be clean; `.runtime/` is ignored as ephemeral state;
- process metadata excludes full command-line arguments so Kaggle/Jupyter session credentials cannot enter the archive;
- Qdrant ports `6333/6334`, embedding port `8001`, and Node port `3000` must not listen on wildcard interfaces;
- exact Bearer-token values and token-named files are rejected;
- public PASS requires a real public acceptance log containing unauthenticated `401` and `PRODUCTION_DEMO_ACCEPTANCE_PASS=8`;
- internal `SHA256SUMS` uses relative paths, excludes itself, and passes independent re-extraction verification;
- the external `.zip.sha256` stores only the ZIP basename, making `sha256sum -c` portable after download.

Local-only evidence explicitly records:

```text
AUTHENTICATED_PUBLIC_DEMO=NOT_RUN
```

A complete public run records:

```text
AUTH_GATEWAY=PASS
UNAUTHENTICATED_REQUEST=401
PUBLIC_TUNNEL_TARGET=http://127.0.0.1:8090
PUBLIC_TUNNEL=PASS
AUTHENTICATED_PUBLIC_DEMO=PASS
```

A fresh Kaggle **Restart Session → Run All** on the final `main` HEAD, followed by independent evidence review, remains required before retargeting `v1.0.0` or overwriting the public release notes/assets.

## Historical lifecycle note

The generic lifecycle still supports `DEMO_PUBLIC=1` for a direct unauthenticated Quick Tunnel to the Node API for backward compatibility/development. That is **not** the canonical public Kaggle path. The canonical notebook always starts the core with `DEMO_PUBLIC=0` and, when requested, adds the separate authenticated gateway afterward.
