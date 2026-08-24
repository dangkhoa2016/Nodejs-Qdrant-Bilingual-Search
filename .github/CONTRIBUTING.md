# Contributing to Node.js Qdrant Bilingual Open Knowledge Search

> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](CONTRIBUTING.vi.md)

Thank you for considering a contribution. This repository treats the accepted semantic contract, Qdrant snapshot identity, release evidence, and bilingual publication copy as reviewable public contracts rather than informal implementation details.

## Before opening a change

1. Search existing issues and pull requests for related work.
2. Keep each change focused on one coherent problem.
3. Update English and Vietnamese user-facing documentation together when applicable.
4. Never commit API keys, Bearer tokens, tunnel credentials, private runtime state, model-cache secrets, or unsanitized evidence logs.
5. Do not silently rebuild or reseed the canonical Qdrant collection as part of an unrelated change.

## Development workflow

Install the Node.js dependencies with the supported runtime:

```bash
npm ci
```

Run the Node test suite:

```bash
npm test
```

When the Python embedding service changes, run its unit tests in an environment with the required Python dependencies:

```bash
PYTHONPATH=embedding-service \
python -m unittest discover -s embedding-service/tests -v
```

When Qdrant/search integration changes, run the real integration suite against an intentionally configured local Qdrant instance:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

For canonical-profile changes, also run:

```bash
npm run verify:canonical-config
npm run verify:semantic-index -- 20000
npm run seed:status -- --once --expected 20000
```

## Canonical invariants

Unless a pull request explicitly proposes, documents, and requalifies a contract change, preserve the accepted `v1.0.0` identity:

- model: `Qwen/Qwen3-Embedding-4B`;
- embedding dimension: `2560`;
- public vector: normalized `Float32[2560]`;
- transport: `binary-f32`;
- profile: `qwen3`;
- query strategy: `prompt`;
- document strategy: `raw`;
- query instruction id: `geo-retrieval-v1:d014d3ec6df87e49`;
- embedding text version: `v2.1`;
- canonical collection: `knowledge_entities_qwen3_4b_text_v21`;
- canonical snapshot reuse remains fail-closed and is never silently replaced by reseeding.

A change that alters one of these values must explain the compatibility impact and provide new qualification evidence rather than re-labeling existing evidence.

## Release and evidence discipline

Release notes, manifests, notebooks, snapshots, and evidence archives must keep source provenance truthful. Documentation-only or governance-only history corrections must not rewrite an older runtime-evidence source identity to the latest release tip.

Public evidence must be sanitized and must not contain secrets, command lines with credentials, private endpoints, or unrelated runtime state.

## Pull requests

A useful pull request explains:

- the problem and intended outcome;
- the files and contracts affected;
- the validation that was run;
- whether the semantic profile, snapshot, runtime, public topology, security posture, or release provenance changes;
- any known limitation or follow-up work.

The pull-request template contains the final review checklist.

## Security issues

Do not publish vulnerability details, exposed credentials, or exploit material in a public issue. Follow [SECURITY.md](SECURITY.md).
