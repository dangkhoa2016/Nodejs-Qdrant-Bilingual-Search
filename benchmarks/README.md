# Semantic retrieval benchmarks

The committed benchmark corpora serve two different purposes and should not be merged or rewritten in place.

## Canonical baseline: `bilingual.json`

This is the original 30-query EN/VI benchmark used for direct historical comparison with the E5 baseline. Keep it unchanged so model-to-model comparisons remain reproducible.

Run it with:

```bash
BENCHMARK_OUTPUT='reports/qwen3-4b-v1-20k-benchmark.json' npm run benchmark
```

## Hardening suite: `bilingual-hard-v2.json`

This suite contains 100 queries. It is a robustness suite around the 15 already-verified country/city ground-truth entities from the canonical benchmark; it intentionally does not claim broader entity coverage.


- 50 English and 50 Vietnamese;
- 80 answerable geographic queries;
- 20 explicit no-answer / out-of-domain queries;
- paraphrases, implicit relations, hard entity-type negatives, noisy input, code-switching, typos, Vietnamese without diacritics, aliases and compressed queries.

The evaluator always requests raw top-5 candidates with `score_threshold=0`. This keeps ranking evidence intact. If the API publishes a default threshold, the report also evaluates that threshold offline without changing the retrieval request.

Run:

```bash
BENCHMARK_OUTPUT='reports/qwen3-4b-v1-20k-hard-v2.json' npm run benchmark:hard
```

The report adds:

- `answerableCases` / `noAnswerCases`;
- MRR and Recall@K over answerable cases only;
- quality by language, category and challenge;
- per-query `top1Top2Margin` and aggregate `rankingMargins`;
- `decisionQuality` at the configured/default search threshold;
- the same latency breakdown used by the canonical benchmark.

## Threshold calibration

After the hard benchmark, sweep thresholds from 0.30 through 0.70 without re-embedding or calling Qdrant again:

```bash
npm run benchmark:calibrate-threshold -- reports/qwen3-4b-v1-20k-hard-v2.json
```

By default this writes:

```text
reports/qwen3-4b-v1-20k-hard-v2-threshold-calibration.json
```

The recommended threshold maximizes strict end-to-end `decisionAccuracy` first. A positive case is counted correct only when the surviving top-1 entity is an expected ID; a no-answer case is counted correct only when no candidate survives the threshold. Ties are resolved by answerability F1, top-1 accuracy, no-answer accuracy, then the lower threshold.

Do not change the API's production threshold until a real hard-benchmark calibration report exists.

## Focused `embedding_text` v1 vs v2 A/B

After Hard v2 has produced a real report, compare document representation v1 and v2 without reseeding or modifying the canonical Qdrant collection:

```bash
FOCUSED_AB_HARD_REPORT='reports/qwen3-4b-v1-20k-hard-v2.json' \
FOCUSED_AB_OUTPUT='reports/qwen3-4b-text-v1-v2-focused-ab.json' \
npm run benchmark:text-ab 2>&1 | tee reports/qwen3-4b-text-v1-v2-focused-ab.log
```

This experiment is deliberately isolated:

- model is fixed to `Qwen/Qwen3-Embedding-4B`, dimension 2560, CUDA FP16;
- query strategy/instruction must remain `prompt` / `geo-retrieval-v1:d014d3ec6df87e49`;
- document strategy remains `raw`;
- the committed Hard v2 query strings are passed unchanged;
- every query is embedded once and the same query vector is reused for both document variants;
- candidate IDs are identical for v1 and v2;
- candidates contain all verified expected entities, the actual top-result distractors from the nine known non-rank1 Hard v2 cases, then deterministic related country/city fillers up to 75 documents by default;
- ranking is local cosine similarity, so the experiment never writes to Qdrant and cannot overwrite `knowledge_entities_qwen3_4b_v1`.

Outputs:

```text
reports/qwen3-4b-text-v1-v2-focused-ab.json
reports/qwen3-4b-text-v1-v2-focused-ab.log
reports/qwen3-4b-text-v1-v2-focused-candidate-texts.json
reports/qwen3-4b-text-v1-v2-focused-candidate-manifest.json
```

The report compares v1/v2/delta for MRR and Recall@1/3/5 overall and by language/category/challenge, and records `expectedRank`, `top1Top2Margin`, and `targetVsBestDistractorMargin` for each query. The three `no-diacritics` cases remain in the evidence but are flagged separately because they are primarily a query-side robustness hypothesis rather than evidence for or against document-text v2.


## Focused `embedding_text` v1 vs v2.1 A/B

The v2 result showed a useful but unbalanced trade-off: country/hard-negative retrieval improved, while several already-correct capital-city queries regressed because the country document used a relation sentence too close to the city query. v2.1 changes only the country-capital wording and keeps capital-city document text identical to v2.

Example country relation:

```text
v2:   The capital city of Japan is Tokyo.
v2.1: Japan has Tokyo as its capital.
```

Run the follow-up experiment against the same Hard v2 report and the same deterministic 75-candidate construction:

```bash
FOCUSED_AB_HARD_REPORT='reports/qwen3-4b-v1-20k-hard-v2.json' \
FOCUSED_AB_OUTPUT='reports/qwen3-4b-text-v1-v21-focused-ab.json' \
npm run benchmark:text-ab-v21 2>&1 | tee reports/qwen3-4b-text-v1-v21-focused-ab.log
```

Default outputs:

```text
reports/qwen3-4b-text-v1-v21-focused-ab.json
reports/qwen3-4b-text-v1-v21-focused-ab.log
reports/qwen3-4b-text-v1-v21-focused-candidate-texts.json
reports/qwen3-4b-text-v1-v21-focused-candidate-manifest.json
```

The report includes a fail-closed `acceptance` assessment. v2.1 is accepted only when all of these hold on the focused 80-query experiment:

- `country-factual` Recall@1 >= 0.95;
- `hard-negative` Recall@1 >= 0.933333333333;
- `city-capital` Recall@1 >= 0.916666666667;
- `compressed` Recall@1 >= 0.80;
- `implicit-relation` Recall@1 = 1.00;
- zero queries that were rank #1 in v1 fall below rank #1 in v2.1.

Passing this focused gate is evidence to continue validation; it is not by itself permission to overwrite or reseed the canonical 20k v1 collection.

## Stress validation: `embedding_text` v1 vs v2.1 on 500–1,000 candidates

A focused 75-candidate PASS is not sufficient evidence for a 20k migration because unseen localities and major cities can become new hard negatives. Freeze `embedding_text v2.1` and expand only the candidate universe:

```bash
STRESS_AB_HARD_REPORT='reports/qwen3-4b-v1-20k-hard-v2.json' \
STRESS_AB_OUTPUT='reports/qwen3-4b-text-v1-v21-stress-ab.json' \
npm run benchmark:text-ab-v21-stress \
  2>&1 | tee reports/qwen3-4b-text-v1-v21-stress-ab.log
```

The default stress candidate set is 750 documents, with a hard maximum of 1,000. It is deterministic and adversarial rather than a random sample. Mandatory candidates are:

- every country entity in the canonical dataset;
- every city with `facts.capital === true`;
- all benchmark expected entities;
- every non-expected top result observed for the answerable Hard-v2 cases.

The builder then fills toward the target with capital-locality candidates, high-population cities related to the expected countries/regions, global high-population cities, and finally deterministic ID-ordered fillers. It fails closed if the mandatory set exceeds the configured maximum.

Default outputs:

```text
reports/qwen3-4b-text-v1-v21-stress-ab.json
reports/qwen3-4b-text-v1-v21-stress-ab.log
reports/qwen3-4b-text-v1-v21-stress-candidate-texts.json
reports/qwen3-4b-text-v1-v21-stress-candidate-manifest.json
```

The stress gate is intentionally stronger than the focused gate. v2.1 is accepted for 20k migration consideration only when all of these are true:

- overall Recall@1 improves over v1 by at least 0.025;
- Recall@1 after excluding `no-diacritics` improves over v1 by at least 0.020;
- `hard-negative` Recall@1 remains at least 14/15;
- `city-capital`, `country-factual`, `compressed`, and `implicit-relation` Recall@1 do not regress from v1;
- zero queries that are rank #1 in v1 fall below rank #1 in v2.1.

The manifest records source-pool counts, overlapping evidence reasons, and mutually exclusive selected-tier counts so evidence can show exactly how the adversarial candidate set was assembled. This command never writes to Qdrant and does not modify `knowledge_entities_qwen3_4b_v1`.


## Full-20k collection A/B: canonical v1 vs shadow v2.1

After `knowledge_entities_qwen3_4b_text_v21` has been seeded and verified at 20,000/20,000 matching provenance, compare it directly with the preserved canonical v1 collection:

```bash
npm run benchmark:full20k-v21-ab \
  2>&1 | tee reports/qwen3-4b-text-v1-v21-full20k-collection-ab.log
```

Default collections and inputs are fixed to the current validation stage:

```text
v1 collection:   knowledge_entities_qwen3_4b_v1
v2.1 collection: knowledge_entities_qwen3_4b_text_v21
query corpus:    benchmarks/queries/bilingual-hard-v2.json
dataset:         data/generated/entities.final.json
expected points: 20000
result limit:    5
rank probe:      100
```

Before the first query, the command fails closed unless both collections are `green`, use an unnamed 2560-dimensional Cosine vector, contain exactly 20,000 points, carry the canonical Qwen semantic runtime provenance, carry the expected `embedding_text_version`, and match the index fingerprint recomputed from the current canonical dataset. The canonical fingerprint metadata defaults to `embeddingVersion=qwen3-4b-v1` and `datasetVersion=public-v1`.

Each Hard-v2 query is embedded exactly once. The same vector object is then sent to both collection queries with `score_threshold=0`. Top-5 results drive MRR/Recall@1/3/5, while the wider rank probe records `expectedRank`, `top1Top2Margin`, and `targetVsBestDistractorMargin` when the target is within the probe window.

The report includes:

- overall, language, category, and challenge v1/v2.1/delta metrics;
- the 77-query non-`no-diacritics` comparison;
- the nine historical non-rank1 focus cases;
- the five v2 country-overbias sentinel cases;
- no-answer top-1 score distributions and per-query score deltas for later threshold calibration;
- machine-readable full-20k acceptance checks;
- both collection/runtime audits and expected/verified index fingerprints.

The full-20k gate requires material overall and non-no-diacritics Recall@1 gains, no regression in hard-negative/city-capital/country-factual/compressed/implicit-relation Recall@1, zero new v1-rank1 regressions, all v2.1 targets remaining top-5, and all five sentinels remaining rank #1. No-answer scores are evidence only; this command does not promote a threshold.


## Post-promotion canonical v2.1 acceptance through the public Node API

After canonical promotion and the direct full-20k A/B are complete, run the final semantic milestone through the application boundary rather than directly against Qdrant:

```bash
npm run acceptance:post-promotion-v21-api
```

The acceptance set is intentionally compact and reuses exact committed Hard-v2 text. It contains ten unique cases: easy English and Vietnamese paraphrases, all five historical v2 country-overbias sentinels, and all three known v2.1 rank-2 cases. Those cases also cover hard-negative, compressed and Vietnamese no-diacritics challenges.

The semantic POST requests explicitly use `score_threshold=0` and `limit=5` so the runner can observe rank #1/#2 behavior without threshold censoring. This does **not** change production policy: preflight requires `/api/v1/info` to report canonical `embedding_text=v2.1` and `searchDefaultScoreThreshold=0.55`. It also requires `/ready=true`, a green 20k collection with all 20k vectors indexed, and the exact Qwen3 CUDA/FP16 query runtime (`prompt`, `geo-retrieval-v1:d014d3ec6df87e49`, document strategy `raw`).

Acceptance fails if any request errors or returns non-200, response mapping does not contain a scored top result, timing components are missing, a v2 sentinel is not rank #1, or a known rank-2 case falls below #2. Improvement of a known rank-2 case to #1 is accepted. The wrapper emits JSON, a combined operational log, checksums, and a zip evidence bundle under `reports/`.

## Expanded v2.1 no-answer threshold benchmark: Hard-v3 threshold

After the canonical v2.1 public-API milestone is closed, threshold work moves to a larger rejection corpus without reopening model or representation design. The committed corpus is:

```text
benchmarks/queries/bilingual-hard-v3-threshold.json
```

It extends Hard-v2 byte-for-byte as its first 100 cases, then adds 100 new explicit no-answer cases:

```text
200 total
80 answerable
120 no-answer
```

The 100 additions are balanced 50 English / 50 Vietnamese and are divided into ten adversarial classes of ten queries each:

```text
lexical-collision
entity-name-collision
wrong-relation-type
contradictory-geography
plausible-absent-entity
science
software-technology
sports
commercial-product
finance-legal
```

The corpus SHA-256 is locked by the runner. Do not rewrite queries in place; create a new corpus version if benchmark semantics change.

Run the whole evidence flow on the live canonical stack:

```bash
npm run benchmark:expanded-v21-threshold
```

The wrapper first verifies canonical config, 20,000/20,000 semantic provenance, and green/indexed Qdrant state. It then performs all 200 semantic requests through:

```text
POST /api/v1/search
```

Requests use `score_threshold=0` and `limit=5` only to collect uncensored ranking/score evidence. The live runtime must still report production threshold `0.55` during preflight.

The collection stage writes:

```text
reports/expanded-noanswer-v21-api.json
```

It must preserve the known 80-answerable v2.1 baseline while treating no-answer scores as diagnostic evidence rather than an execution failure condition. In particular, no new answerable rank-1 regression is accepted, the three known v2.1 rank-2 cases may remain rank #2 or improve to #1, and all answerable targets must remain top-5.

The calibration stage is fully offline and writes:

```text
reports/expanded-v21-threshold-calibration.json
```

It evaluates the fixed thresholds `0.50`, `0.51`, `0.53`, and `0.55`, reports false-positive/false-negative case IDs, false-positive rate with a Wilson 95% interval, and false positives grouped by adversarial challenge.

Production is **not** changed automatically. The decision policy is deliberately conservative:

- propose `0.53` only if it recovers answerable cases that `0.55` rejects and does not worsen adversarial false positives;
- retain `0.55` when lowering gives no measurable recall benefit;
- retain `0.55` and investigate false-positive classes when adversarial negatives still cross `0.55`.

This benchmark therefore answers a different question from the earlier representation A/B work: whether a lower answerability threshold is justified after canonical v2.1 retrieval itself has already been accepted.
