# Portfolio Evidence

This document is part of the bilingual portfolio package for
`nodejs-qdrant-bilingual-search`. Every value below was captured from the live
Kaggle stack during the portfolio demo run, from the strict one-shot corrective
run, or from the frozen Git source. It is a live-demo and reproducibility record,
not a benchmark, and it does **not** claim a request-latency SLA.

## Runtime provenance

```text
RUNTIME_SOURCE_BRANCH=feat/runtime-contract-reuse-hardening
RUNTIME_SOURCE_HEAD=743800828c89db582cae90fc275bec19fb9b00e3
```

The runtime-proven HEAD is frozen and the tracked tree is clean. All live
evidence references this runtime-proven HEAD. Documentation improvements live on
an isolated docs branch that descends from this HEAD and is documentation-only (see
`RELEASE_CANDIDATE.json` and the `docs/` directory).

## Hardware/runtime contract

Verified against the running services:

| Area | Proven value |
|---|---|
| Model | Qwen/Qwen3-Embedding-4B |
| Device | cpu |
| Dtype | float32 (true, verified) |
| Runtime | pytorch-cpu |
| Runtime contract | embedding-runtime-dtype-verified-v1 |
| Embedding dimension | 2560 |
| Transport | binary-f32 |
| Construction count | 1 |
| Warm-up count | 1 |
| Search threshold | 0.55 |
| Translation | disabled |

The validation gate reported `PORTFOLIO_RUNTIME_CONTRACT=PASS`.

## Qdrant canonical index

| Area | Value |
|---|---|
| Collection | knowledge_entities_qwen3_4b_text_v21 |
| Status | green |
| Points / indexed | 20000 / 20000 |
| Distance | Cosine |
| Serving-time reseed | No |

The existing canonical 20K collection was reused as-is; no reseed or data change
was performed for this portfolio capture.

## Successful warm-session search evidence

The following live probes were captured against an already-running warm Kaggle
CPU session. They demonstrate search **functionality**, not a request-latency
guarantee:

- **en-thailand** — "Southeast Asian country whose capital is Bangkok"
  → top result **Thailand** (country), HTTP 200.
- **vi-thailand** — "quốc gia Đông Nam Á có thủ đô Bangkok"
  → top result **Thailand** (country), HTTP 200.
- **en-vietnam-capital** — "What is the capital of Vietnam?"
  → top result **Hanoi** (city), HTTP 200.
- **en-casablanca-negative** — "What is the plot of the movie Casablanca?"
  → HTTP 200, empty results (see below).

Raw request/response/timing JSON from those warm-session captures is preserved
under `searches/` in the portfolio pack. The demo sentinel gate reported
`PORTFOLIO_DEMO_SENTINELS=PASS` for those captures.

## Strict one-shot corrective result

A later strict one-shot corrective acceptance did **not** pass. The first probe
(`en-thailand`) was sent exactly once with a configured 120-second client
boundary:

```text
en-thailand
attempt #1 only
CURL_RC=28
HTTP_CODE=000
TOTAL_SECONDS=120.001360
0 response bytes received
no retry
later probes not run
RESULT=DEMO_CAPTURE_REGRESSION
```

The strict corrective evidence is preserved immutably (see Evidence chain below).
It is referenced by filename and SHA-256; it is not re-uploaded in this pack.

## Latency interpretation

The shared Kaggle CPU deployment exhibited substantial request-latency
variability. Earlier warm-session searches completed successfully, while the
strict one-shot corrective capture timed out at the configured 120-second client
boundary. The evidence does not isolate a single root cause, so this project does
**not** claim a request-latency SLA for the shared Kaggle CPU deployment profile.

## Public claim boundary

The portfolio documents a **production-oriented demo**, not a latency-proven
production service. It claims the demonstrated engineering value (true-FP32 CPU
runtime, verified loaded dtype, canonical 20K reuse, bilingual semantic search,
consistency and domain/entity-intent safeguards, reproducible evidence chain) but
explicitly does **not** claim: stable request latency, that every request
completes within 120 seconds, a request-latency SLA, throughput/QPS guarantees,
internet-scale production readiness, that the strict one-shot corrective demo
passed, or that the timeout root cause was isolated.

## Casablanca domain/entity-intent example

```text
query = What is the plot of the movie Casablanca?
```

The geographic candidate for Casablanca is rejected by the domain/entity-intent
gate because the inferred intent is non-geographic:

```text
domain_entity_intent.enabled = true
domain_entity_intent.applied = true
intent.domain = media-work
rejected_count = 1
rejection_reason_counts = { "geographic-entity-for-nongeographic-intent": 1 }
final results = []
```

This demonstrates the gate rejecting a geographic false-positive for a
non-geographic intent without lowering the score threshold (0.55) and without
hard-coding entity names.

## Test suites

Fresh source tests on the frozen runtime source:

| Suite | Result |
|---|---|
| Node test suite | 420/420 PASS |
| pytest (embedding-service) | 52/52 PASS |
| unittest (embedding-service) | 46/46 PASS |

`git diff --check` was clean and `git fsck` reported only dangling historical
objects (no corruption or missing objects).

## Memory interpretation

The embedding model is the dominant RAM consumer. In the captured memory snapshot
the embedding process (`python -m uvicorn app:app`) reported an RSS of roughly
14.9 GB. The session memory cgroup showed `memory.current` ≈ 16.9 GB within a
32 GB host, with `oom=0` and `oom_kill=0` and no swap — the accepted run recorded
**no OOM / oom_kill event**. These are observed runtime snapshot values, not a
peak-memory benchmark; they should not be presented as universal physical RAM.

## Evidence chain

The following immutable artifacts are preserved (not rewritten here). Their
SHA-256 sidecars were verified during this run:

| Artifact | SHA-256 |
|---|---|
| 20260828T085406Z-fp32-corrective-final.zip | 98c46baff92e3e6b57695a2e15ed0c2ffa36d08eacecf7aa8aad18e2a31f722b |
| 20260828T114914Z-fp32-post-closure-polish.zip | 56ea6c59adaa51a289c8bbdec9019beaf0a023a38b381b553a87b0e9feb426e1 |
| nodejs-qdrant-bilingual-search-fp32-corrective-743800828c89-polished-with-git.zip | 09e288026e92894336ad0e620fcc061a4afb4b7b55de5dd3f92c1a152d17778d |

These hashes are captured from the current session and recorded in
`historical/artifact-sha256.txt` and `historical/sidecar-verification.txt`. If a
sidecar were missing in another session it would be labelled
`SHA sidecar not present in current Kaggle session` rather than guessed.

Canonical identities for this finalization phase (also see `source/PROVENANCE.txt`
in the finalization pack):

```text
runtime-proven HEAD
743800828c89db582cae90fc275bec19fb9b00e3

previous docs candidate HEAD
2996f20fa9ec8108bc8ad25c4d7151c3609d09ad

strict corrective failure artifact
20260828T135326Z-nodejs-qdrant-fp32-portfolio-corrective.zip

strict corrective SHA-256
c8699f7a3665f88035f9ac6a040113de1264e6b4078405d132e9018d98210813
```

The earlier canonical hardening evidence chain remains valid and is preserved
here; it is not deleted because a later corrective run failed.

## Known anomaly

A frozen Mount-Fuji/Japan sentinel exhibits cross-runtime semantic drift because
the canonical vectors were originally seeded in a different numerical runtime
than the CPU true-FP32 query runtime. The project does not lower the production
threshold or rewrite expected answers to hide this behavior. Mount-Fuji was
intentionally excluded from this small portfolio demo capture.

## Reproduction notes

Runtime source is frozen at `7438008`. The canonical stack (Qdrant + embedding
service + Node API) was already running and reused for the portfolio capture; no
reseed, no threshold change, no benchmark reopen, and no semantic/source-code
change were performed. The strict one-shot corrective capture failed on its first
probe and was not retried. The finalization phase changed only the four authorized
documentation files on an isolated docs branch. See the
`ACCEPTANCE_CHECKLIST.txt`, `RESULT.txt`, and `RELEASE_DECISION.md` in the
finalization pack for the final status.
