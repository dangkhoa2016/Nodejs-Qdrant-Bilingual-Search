# Changelog
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](CHANGELOG.vi.md)

## [1.0.0] - 2026-08-29

### Added
- bilingual EN/VI semantic search API with Node.js/Hono and Qdrant
- Qwen3-Embedding-4B canonical 2560d embedding profile
- deterministic dataset/seed/evaluation/reproducibility tooling
- Kaggle Transformers CPU-FP16 release profile
- semantic index verification and acceptance tooling
- repository-integrated Kaggle production-demo notebook entry point
- fail-closed canonical Qdrant snapshot restore helper
- stable-sentinel notebook acceptance and sanitized evidence packaging
- authenticated public-demo gateway with per-session Bearer token
- Quick Tunnel public path restricted to the gateway at `127.0.0.1:8090`
- bilingual English/Vietnamese explanatory Markdown cells throughout the Kaggle notebook

### Validated
- 20K/20K semantic verifier
- stable/canonical compatibility sentinel set at rank #1 (Thailand EN, Tokyo VI, Beijing VI)
- strict relation-style diagnostics scoped as diagnostic-only (Thai VI capital-form; Fuji/Japan)
- CPU FP16 memory acceptance with no OOM/oom_kill
- portable Node 22/24 fresh bootstrap with SHA-256 verification
- reproducible npm-ci CI and evidence packaging and archive integrity
- notebook JSON/source contract and Kaggle helper syntax in CI
- authenticated-gateway unit tests on Node 22 and Node 24
- public-topology CI contract requiring the tunnel origin to be `127.0.0.1:8090`
- fresh Kaggle Qdrant storage paths are canonicalized before creation and regression-tested on Node 22/24
- local semantic acceptance contains 7 checks; authenticated public acceptance contains 8 checks including the unauthenticated `401` gate
- Kaggle repository hard-refresh removes stale untracked checkout state such as `snapshots/` after `reset --hard`, regression-tested on Node 22/24
- temporary Qdrant snapshot/temp runtime paths are externalized from the source checkout and regression-tested on Node 22/24
- snapshot restore is rerun-safe for project-owned Qdrant processes while preserving fail-closed behavior for external listeners on port `6333`
- notebook overall PASS is gated by successful evidence collection and fails closed to `INCOMPLETE` otherwise
- evidence distinguishes the collector shell Node version from the actual running demo Node runtime

### Security and operations
- the canonical Kaggle CPU-FP16 profile explicitly binds the Node API to `127.0.0.1`; Qdrant, embedding service and Node backend must all remain loopback-only
- public API routes require `Authorization: Bearer <token>` when exposed through the optional notebook public path
- search inference concurrency is limited to one public request while health/readiness remain responsive
- gateway enforces a safe-route allowlist, rate limiting, request-body limits, request IDs and an upstream timeout
- public Sections 6–7 are optional and disabled by default with `ENABLE_PUBLIC_TUNNEL=False`
- notebook public PASS markers are emitted only after authenticated public acceptance actually completes
- evidence collection fails on a dirty Git worktree, omits full process command lines, rejects Bearer-token leakage, and verifies backend listener topology
- outer evidence `.zip.sha256` sidecars use portable ZIP basenames; internal `SHA256SUMS` remains relative and independently re-extract-verified
- the source checkout is disposable and cleaned with `git clean -ffd`; persistent Qdrant runtime storage remains outside the repository under `/kaggle/working/qdrant-bilingual-search`
- the restore helper explicitly places Qdrant snapshots and temp files under `/kaggle/working/qdrant-bilingual-search/snapshot-restore-runtime`
- before canonical snapshot restore, project-owned demo processes are stopped using the existing PID/signature ownership model; an external/reused service still occupying `6333` is never killed and blocks restore
- final notebook status records `EVIDENCE_COLLECTION=PASS/FAIL` and never overclaims overall PASS without completed evidence packaging

### Notes
- public vectors remain normalized Float32[2560]
- canonical snapshot reuse is approved; no reseed is required
- canonical snapshot restore is pinned to Qdrant 1.18.3 and SHA-256 `71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f`
- a clean Kaggle **Restart Session → Run All** completed on reconstructed source commit `b316619ad94947571e91124adfe96071bbd1f255`; independently reviewed evidence SHA-256 is `3ab21f5d05dc8188d543167dce806b28144f2d2e6cc780e4eab0bdb895f7037a`
- local Kaggle acceptance passed 7/7; the optional authenticated public path was not run and is recorded as `NOT_RUN`
- repository-history reconstruction and `v1.0.0` tag-retarget provenance are disclosed in the release documentation; the post-evidence closeout delta is limited to release documentation and GitHub Actions version pins, with no application, runtime, test, or notebook-content changes
- core local Kaggle validation does not require the optional authenticated public tunnel; any public-demo release claim does require Sections 6–7 and `PRODUCTION_DEMO_ACCEPTANCE_PASS=8`
