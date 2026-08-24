# Portfolio — Bilingual Qwen3 + Qdrant Semantic Search
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](portfolio.vi.md)

This is the reviewer-oriented engineering story for `nodejs-qdrant-bilingual-search` `v1.0.0`. It is not a raw run log; it explains the problem, the architecture, the decisions, and the engineering evidence that led to the accepted release profile.

## 15.1 Problem statement

English/Vietnamese semantic retrieval over an open geographic knowledge corpus, using a Node.js/Hono API, local embeddings, and Qdrant. The goal is reproducible public-data ingestion, auditable translation enrichment, deterministic seeding, and measurable retrieval quality — not a thin Qdrant proxy.

## 15.2 Architecture

```text
read-only Qwen3 model in /kaggle/input
        ↓
Python FastAPI embedding service
        ↓
normalized Float32[2560] vectors over binary-f32
        ↓
Node.js/Hono search API
        ↓
Qdrant canonical 20K collection
```

Live topology (actual runtime):

```text
embedding : 127.0.0.1:8001
Node/Hono : 127.0.0.1:3000
Qdrant    : 127.0.0.1:6333
```

The model is loaded read-only from `/kaggle/input` — never from Hugging Face and never from a mutable working copy.

## 15.3 Semantic-quality evolution

The promoted document representation is `embedding_text v2.1`:

```text
v2 relation/type improvements were useful but created country over-bias;
v2.1 corrected the asymmetry;
v2.1 was tested on candidate/adversarial/full-20K evaluations;
full-20K quality reached approximately:
R@1  = 96.25%
R@3  = 100%
R@5  = 100%
```

These are historical evaluation results from the frozen phase, not newly generated in this docs release.

## 15.4 Snapshot reuse and semantic identity

Semantic identity is not identical to execution provenance. The verifier treats model, dimension, profile, query/document strategies, instruction ID, and embedding-text version as hard semantic gates, while reporting execution provenance (e.g. `sentence-transformers` vs `transformers`, device, runtime) separately. This is why the canonical 20K snapshot is reusable: semantic identity remains verified even when historical execution provenance differs. The verifier is the safety gate — this is not a claim that backend provenance is irrelevant.

## 15.5 CPU FP16 engineering

The practical objective:

```text
fit Qwen3-Embedding-4B inside the observed Kaggle ~32GB-class CPU environment
without changing the public vector contract.
```

Precision pipeline:

```text
internal FP16
public Float32 vectors
OOM=0
oom_kill=0
```

CPU latency from this profile is portable demo/runtime performance, not production serving performance.

## 15.6 Node/Hono integration

Service boundaries are explicit: the Python FastAPI embedding service owns model inference and returns normalized `Float32[2560]` vectors over `binary-f32` transport; the Node.js/Hono API owns searching and entity/statistics. The Qdrant connection layer stays provider-neutral (`local | beam | modal`), branches only on one immutable profile, and never auto-fails-over between providers.

## 15.7 RED→GREEN Node 22 bootstrap root cause

The original fresh-environment bootstrap failed under strict shell settings. Concise root cause:

```text
set -euo pipefail
sourced bootstrap
function/local tmp variable
RETURN trap
nounset scope failure
```

The fix:

```text
subshell
EXIT trap
same-scope tmp lifetime
checksum verification retained
```

The value is the engineering methodology (fail-closed, deterministic, reproducible bootstrap), not the shell trivia itself. The pinned Node tarball is verified against the official `SHASUMS256.txt` before extraction and fails closed on mismatch.

## 15.8 Evidence engineering

Acceptance evidence is packaged with integrity guarantees:

```text
individual sentinel JSON preservation
manifest without self-hash
source/evidence/closeout SHA verification
clean Git worktree closeout
```

The evidence manifest deliberately does not hash itself, avoiding circular self-reference.

## 15.9 What this release intentionally does not claim

```text
- not a low-latency GPU production service
- no reranker
- no hybrid sparse+dense search
- no RAG
- no automatic reseeding during runtime
- no claim that CPU FP16 is universally optimal
```

These non-goals prevent portfolio overclaiming and keep the release honest as a portable demo/runtime profile.

## 15.10 Production-demo scope

Canonical 20K semantic verifier = `20000 / 20000 PASS`, with no OOM. A stable production smoke
on the frozen canonical snapshot passes the canonical compatibility sentinel set: Thailand EN,
Tokyo VI and Beijing VI at rank #1, the 20,000/20,000 index, and the semantic verifier, with
OOM/oom_kill = 0.

A separate, stricter relation-style diagnostic set was also exercised. The Vietnamese
"country whose capital / famous for X" relation forms do **not** return the country at rank #1:
the frozen Qwen3-Embedding-4B model scores the homonymous city slightly above the parent
country (measured Bangkok city ≈ 0.660 > Thailand country ≈ 0.659 for "quốc gia Đông Nam Á có
thủ đô Bangkok"; Fuji city above Japan for "quốc gia châu Á nổi tiếng với núi Phú Sĩ"). The
strict domain-entity consistency gate (`entity_type=country`) then rejects the city candidates
and the expected country is not returned at rank #1 for that query form. This is an intrinsic
model+snapshot property. The same city-over-country rank ordering is reproduced on
true FP32 on the same snapshot; the scores differ slightly, so this is evidence that the
result is not specific to FP16, not evidence of byte-identical cross-dtype outputs, and not a
reconstruction defect. Fuji/Japan queries remain diagnostic-only and are not a phase gate.

See [releases/v1.0.0.md](releases/v1.0.0.md) for the release note and sentinel summary.
