# Changelog
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](CHANGELOG.vi.md)

## [1.0.0] - 2026-08-29

### Added
- bilingual EN/VI semantic search API with Node.js/Hono and Qdrant
- Qwen3-Embedding-4B canonical 2560d embedding profile
- deterministic dataset, seeding, evaluation and reproducibility tooling
- Kaggle Transformers CPU-FP16 release profile
- semantic index verification and acceptance tooling
- repository-integrated Kaggle production-demo notebook entry point
- fail-closed canonical Qdrant snapshot restore helper
- sanitized evidence packaging with SHA-256 verification
- optional authenticated public-demo gateway and Quick Tunnel path
- bilingual English/Vietnamese documentation and notebook guidance

### Final validated `v1.0.0` publication state

The final frozen publication identity is:

```text
annotated tag object = ce9cbf6d814a2cf0f4a16251dca55aa1ad918bc5
release commit       = 93d9117e4777ab2570522d25d79ba69709f43fbd
release tree         = 4cfb514413b02fea9ad1cec052abfb71038c6a13
exact-main CI        = #154 / run 34302179233 / PASS
exact-tag CI         = #155 / run 34303663281 / PASS
```

Final fresh post-LICENSE Kaggle qualification:

```text
evidence timestamp          = 20260909T024546Z
Qdrant                      = 20000 / 20000
snapshot restore            = PASS
RESEED_PERFORMED            = NO
Search Showcase             = PASS
stable local acceptance     = 13 / 13 PASS
semantic sentinels          = 10 / 10 PASS
authenticated public demo   = NOT_RUN
```

`AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` is acceptable for the core release because `ENABLE_PUBLIC_TUNNEL=False` is the safe default. The optional public topology remains covered by CI contracts.

### Historical qualification context

Earlier reconstructed-source qualification used smaller compatibility acceptance sets, including a historical 7-check local set and an optional authenticated-public extension. Those counts remain valid only as historical evidence for the source states in which they were collected.

They are **not** the final `v1.0.0` publication contract. The authoritative final local qualification is the post-LICENSE **13/13** result above.

Historical clean Kaggle evidence from 2026-08-31 remains preserved for reconstructed source commit `b316619ad94947571e91124adfe96071bbd1f255`; it is not relabeled as evidence for the later frozen release tip.

### Canonical runtime and semantic profile
- Qwen3-Embedding-4B, 2560 dimensions, cosine distance
- Transformers / PyTorch / CPU / FP16 internal runtime
- normalized public `Float32[2560]` vectors over `binary-f32`
- query profile `qwen3`
- query instruction ID `geo-retrieval-v1:d014d3ec6df87e49`
- embedding text contract `v2.1`
- canonical collection `knowledge_entities_qwen3_4b_text_v21`
- canonical snapshot SHA-256 `71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f`

### Stable compatibility and diagnostics
- stable search showcase: Thailand EN, Tokyo VI, Beijing VI = PASS
- final semantic sentinels: 10/10 PASS
- relation-style Thailand-capital and Fuji/Japan cases remain diagnostic-only known limitations
- historical full-20K v2.1 evaluation: approximately R@1 96.25%, R@3 100%, R@5 100%

### Security and operations
- canonical Node API, embedding service and Qdrant remain loopback-only unless deliberately exposed through the optional gateway
- public routes require Bearer authentication when the optional public path is enabled
- search inference concurrency is bounded while health/readiness remain responsive
- evidence collection fails closed on dirty source state and rejects secret leakage
- `/kaggle/input` remains read-only; writable Qdrant runtime state lives under `/kaggle/working/qdrant-bilingual-search`
- canonical snapshot restore never silently reseeds the final collection

### Final controlled publication assets

Exactly six custom assets are frozen on the GitHub Release:

```text
nodejs-qdrant-bilingual-search-v1.0.0-kaggle-cpu-fp16-production-demo.ipynb
  3f9b61694c3d2b2a9e73afa401dfc3f4ecf40d69bc11d551609499570a4df823

nodejs-qdrant-bilingual-search-v1.0.0-kaggle-cpu-fp16-production-demo.ipynb.sha256
  3fa610c0d759559a17c105c990586dd24e68e0addc857a1be8079a69ac127c33

nodejs-qdrant-v1.0.0-production-demo-evidence-20260909T024546Z.zip
  110ab61b97927ae74949badcd0d9dfc382608978b1ffbaa8795d3a2529a7255c

nodejs-qdrant-v1.0.0-production-demo-evidence-20260909T024546Z.zip.sha256
  990bde3daafe9a792023ab7c87bdefa8baa2409d442a26f026d6b8d0b28b07b9

nodejs-qdrant-v1.0.0-release-manifest.json
  2bdc13febab013937b657947ada11cc29e346b222890743d9ad5a23efb56dd76

nodejs-qdrant-v1.0.0-release-manifest.json.sha256
  bd7e32d44d0b29b797422f85ee87587de0b125b6b17426b736db6f8e504228a9
```

### Post-publication documentation note

After the public release was frozen, the moving `main` branch documentation was corrected to match the final public provenance and asset set. This documentation-only follow-up does not retarget `v1.0.0`, replace release assets, or reopen release qualification.
