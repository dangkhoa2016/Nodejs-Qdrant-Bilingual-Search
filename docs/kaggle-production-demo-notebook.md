# Kaggle CPU-FP16 Production-Oriented Demo Notebook
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](kaggle-production-demo-notebook.vi.md)

The canonical interactive Kaggle entry point is:

```text
notebooks/kaggle-cpu-fp16-production-demo.ipynb
```

The notebook follows a release-pinned repository-first workflow: import it from GitHub, then the first code cell clones or refreshes the official repository under `/kaggle/working`, force-fetches the annotated `v1.0.0` tag, resolves that tag to its commit, and checks out that exact commit in detached HEAD state. GitHub remains the source of truth, while the release tag is the frozen source identity used for qualification.

## Quick start

1. Create a new Kaggle Notebook and use **File → Import Notebook → GitHub**.
2. Select repository `dangkhoa2016/Nodejs-Qdrant-Bilingual-Search` and notebook `notebooks/kaggle-cpu-fp16-production-demo.ipynb`.
3. Enable **Internet** and set **Accelerator=None**.
4. Attach model slug `dangkhoa2016/qwen-qwen3-embedding-4b`, choose **Framework: `Transformers`** and **Variation: `default`** (`Transformers/default`).
5. Attach dataset slug `dangkhoa2016/qdrant-bilingual-search-canonical-v2-1-20k`.
6. Keep the safe defaults:

   ```python
   RUN_LIVE_DEMO = True
   ENABLE_PUBLIC_TUNNEL = False
   ```

7. Use **Restart Session → Run All**.

Kaggle mounts the attached model and dataset read-only beneath `/kaggle/input`. Do not copy those canonical inputs into `/kaggle/working`; writable runtime state belongs under `/kaggle/working/qdrant-bilingual-search/`.

## Clean, release-pinned repository bootstrap

The checkout at `/kaggle/working/Nodejs-Qdrant-Bilingual-Search` is disposable source state. On every run, the bootstrap refreshes the repository, force-fetches `refs/tags/v1.0.0`, verifies that `v1.0.0` is an annotated tag, resolves `v1.0.0^{commit}`, checks out that exact commit with detached HEAD, then runs `git clean -ffd`.

The notebook deliberately does **not** qualify a moving `origin/main`. Its source-identity verification cell confirms that:

```text
HEAD == v1.0.0^{commit}
Git status == clean
RELEASE_SOURCE_IDENTITY = PASS
```

This removes stale untracked files or directories left by earlier Kaggle attempts while making the fresh evidence attributable to the exact frozen release source.

Persistent/runtime data is deliberately kept outside the source checkout. Canonical Qdrant storage uses `/kaggle/working/qdrant-bilingual-search/qdrant-data`; the temporary snapshot-restore process uses `/kaggle/working/qdrant-bilingual-search/snapshot-restore-runtime`, including explicit `snapshots/` and `tmp/` directories. Qdrant therefore cannot recreate runtime snapshot files inside the Git checkout during the canonical restore workflow.

### Rerun-safe snapshot restore

The canonical restore path is safe to rerun in the same Kaggle session. Before touching the snapshot, `restore-canonical-qdrant-snapshot.sh` calls `prepare-canonical-qdrant-restore.sh`, which reuses the production-demo ownership model to stop only processes proven to be owned by this repository. This cleans up an earlier Node/embedding/Qdrant stack that may still hold port `6333` after a partial or repeated notebook run.

The safety boundary remains fail-closed: external or reused services are never killed by this cleanup. After owned-process cleanup, port `6333` must be free. If another service is still listening, restore aborts rather than reusing or terminating that service.

Expected pre-restore markers are:

```text
QDRANT_PORT_6333=CLEAN
QDRANT_PRE_RESTORE_OWNED_CLEANUP=PASS
```

## Required core demo vs optional public demo

The notebook intentionally separates two validation layers.

### Core local demo — required

Sections 1–5 restore and run the canonical stack entirely on loopback:

```text
Node/Hono API       127.0.0.1:3000
Embedding service   127.0.0.1:8001
Qdrant              127.0.0.1:6333
```

The Kaggle profile explicitly forces the Node host to `127.0.0.1`. The evidence collector fails closed if Node, Qdrant or the embedding service is listening on a wildcard interface.

The stable local acceptance has thirteen checks and is intentionally distinct from the Search Showcase:

```text
runtime/API contracts          3
English positive retrievals    4
Vietnamese positive retrievals 4
no-answer intent protection    2
semantic sentinels            10
overall local checks          13
```

Expected markers:

```text
PRODUCTION_DEMO_SEMANTIC_PASS=10
PRODUCTION_DEMO_ACCEPTANCE_PASS=13
```

### Authenticated public demo — optional

Sections 6–7 run only when:

```python
ENABLE_PUBLIC_TUNNEL = True
```

They are **not required to validate the core Kaggle demo**. When enabled, the public topology is:

```text
Internet
  -> Cloudflare Quick Tunnel
  -> 127.0.0.1:8090 authenticated gateway
  -> 127.0.0.1:3000 Node/Hono API
  -> 127.0.0.1:8001 embedding service
  -> 127.0.0.1:6333 Qdrant
```

The public acceptance adds an unauthenticated `401` check before the same thirteen core checks. Therefore a complete authenticated public acceptance has fourteen checks:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=14
```

The notebook reports `AUTHENTICATED_PUBLIC_DEMO=PASS` only after Sections 6 and 7 actually finish successfully. If public mode is disabled or skipped, it reports `AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` instead of a false PASS.

Quick Tunnel is a temporary demo endpoint, not SLA-backed 24/7 hosting.

## Frozen runtime and snapshot contract

```text
model                  = Qwen/Qwen3-Embedding-4B
backend                = transformers
runtime                = pytorch-cpu
device                 = cpu
internal dtype         = float16
batch size             = 1
dimension              = 2560
public vector dtype    = float32
transport              = binary-f32
embedding text         = v2.1

Qdrant                 = 1.18.3
collection             = knowledge_entities_qwen3_4b_text_v21
points                 = 20000
indexed vectors        = 20000
distance               = Cosine
```

Canonical snapshot:

```text
knowledge_entities_qwen3_4b_text_v21-20260827T013824Z.snapshot
bytes  = 283812352
sha256 = 71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f
```

The notebook verifies the snapshot identity and restores it without reseeding.

## Evidence and publication hygiene

Section 8 calls:

```text
scripts/kaggle/collect-production-demo-notebook-evidence.sh
```

It creates:

```text
nodejs-qdrant-v1.0.0-production-demo-evidence-<UTC>.zip
nodejs-qdrant-v1.0.0-production-demo-evidence-<UTC>.zip.sha256
```

Publication safeguards include:

- Git worktree must be clean; `.runtime/` is ignored as ephemeral state.
- Temporary Qdrant restore snapshots and temp files stay outside the source checkout.
- Process evidence omits full command-line arguments so Kaggle/Jupyter session credentials cannot leak through `ps` output.
- Qdrant, embedding and Node listener checks fail on wildcard exposure.
- Bearer-token values and token-named files are rejected from evidence.
- Internal `SHA256SUMS` uses relative paths, excludes itself, and is verified again after independent ZIP extraction.
- The outer `.zip.sha256` contains only the ZIP basename and is portable with `sha256sum -c` after download.
- Public PASS markers require a real public acceptance log with unauthenticated `401` and `PRODUCTION_DEMO_ACCEPTANCE_PASS=14`.
- `system/environment.txt` distinguishes `SYSTEM_NODE_VERSION` (the shell PATH used by the collector) from `DEMO_NODE_VERSION` (the actual running Node API runtime reported by `/api/v1/info`).
- The notebook tracks `evidence_completed=False` until Section 8 successfully creates the expected ZIP and sidecar. Section 9 emits `EVIDENCE_COLLECTION=FAIL` and `PRODUCTION_ORIENTED_DEMO_NOTEBOOK=INCOMPLETE` instead of an overall PASS if evidence packaging did not complete.

Expected local-only successful final markers include:

```text
CORE_LOCAL_DEMO=PASS
EVIDENCE_COLLECTION=PASS
AUTHENTICATED_PUBLIC_DEMO=NOT_RUN
PRODUCTION_ORIENTED_DEMO_NOTEBOOK=PASS
```

## Validation state

GitHub CI validates notebook structure, bilingual guidance markers, exact annotated-tag bootstrap behavior, rerun-safe owned-Qdrant cleanup with external-service fail-closed behavior, Qdrant runtime snapshot-path hygiene, final evidence-state truthfulness, localhost/public topology contracts, publication hygiene, helper syntax, Node tests, Python embedding tests and Qdrant integration.

After the final publication history and annotated `v1.0.0` tag are frozen, a fresh Kaggle **Restart Session → Run All** on that exact tag target is the authoritative live qualification gate. Only evidence produced by that final tag-pinned session should be used to overwrite the controlled public release evidence assets and their digests.
