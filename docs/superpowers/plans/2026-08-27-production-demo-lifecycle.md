# Production Demo Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable one-command production demo lifecycle for Qdrant, Qwen3 embedding, Node API, optional Cloudflare exposure, demo queries, and a short smoke test.

**Architecture:** A small shell orchestrator owns only processes it starts and reuses already-healthy local services without adopting them. Node scripts implement demo/smoke HTTP assertions so the shell stays focused on lifecycle and process management.

**Tech Stack:** Bash, Node.js 24 native `fetch`, Python/Uvicorn embedding service, Qdrant local binary, Cloudflare Quick Tunnel.

**Spec:** `docs/superpowers/specs/2026-08-27-production-demo-lifecycle-design.md`

## Global Constraints

- Keep `Qwen/Qwen3-Embedding-4B`, dimension `2560`, transport `binary-f32`, embedding text `v2.1`.
- Keep collection `knowledge_entities_qwen3_4b_text_v21` and expected point count `20000`.
- Keep score threshold `0.55`, consistency enabled with multiplier `5`, and domain/entity-intent gate enabled.
- Do not seed automatically and do not run 200-query benchmark/acceptance suites.
- Expose only Node API publicly; Qdrant and embedding remain localhost-only.
- Public tunnel failure must not stop a healthy local demo.

---

### Task 1: Lifecycle primitives and facade

**Files:**
- Create: `run.sh`
- Create: `scripts/demo/lifecycle.sh`
- Test: `tests/unit/production-demo-lifecycle.test.js`

**Interfaces:**
- Consumes: `scripts/colab/spawn-detached.py`.
- Produces: `./run.sh [start|stop|restart|status]`, PID/signature state under `.runtime/production-demo`.

- [x] Write failing lifecycle tests for command dispatch, stale/mismatched PID safety, and external-service reuse.
- [x] Run the focused test and confirm RED because `run.sh`/lifecycle code does not exist.
- [x] Implement minimal lifecycle/process helpers and command facade.
- [x] Run focused tests and confirm GREEN.

### Task 2: Mandatory service startup and readiness

**Files:**
- Modify: `scripts/demo/lifecycle.sh`
- Test: `tests/unit/production-demo-lifecycle.test.js`

**Interfaces:**
- Consumes: canonical environment values, Qdrant HTTP, embedding `/health` and `/model`, Node `/ready`.
- Produces: bounded `start_qdrant`, `start_embedding`, `start_api`, and service status output.

- [x] Add RED tests proving Qdrant/embedding/API must use localhost targets, bounded readiness, canonical embedding identity, and no implicit seed.
- [x] Implement minimal start/readiness logic using the detached spawn helper.
- [x] Verify focused tests GREEN.

### Task 3: Optional Node-only Cloudflare exposure

**Files:**
- Modify: `scripts/demo/lifecycle.sh`
- Test: `tests/unit/production-demo-lifecycle.test.js`

**Interfaces:**
- Consumes: healthy local Node API at `http://127.0.0.1:3000`.
- Produces: optional `.runtime/production-demo/public.url`; tunnel command must target Node only.

- [x] Add RED tests for Node-only tunnel target and non-fatal tunnel startup failure.
- [x] Implement minimal tunnel startup/URL extraction.
- [x] Verify focused tests GREEN.

### Task 4: Demo and smoke commands

**Files:**
- Create: `src/demo/production-demo.js`
- Create: `scripts/demo/demo.mjs`
- Create: `scripts/demo/smoke.mjs`
- Modify: `package.json`
- Test: `tests/unit/production-demo.test.js`

**Interfaces:**
- Produces: `npm run demo`, `npm run smoke:production`, reusable response assertion helpers.

- [x] Add RED tests for canonical info validation, expected positive top entities, and Casablanca negative behavior.
- [x] Implement native-fetch demo/smoke helpers and CLIs.
- [x] Add package scripts and verify GREEN.

### Task 5: Documentation, regression, and packaging

**Files:**
- Modify: `.env.example`
- Create: `docs/production-demo.md`

**Interfaces:**
- Documents local/public modes and lifecycle environment overrides without secrets.

- [x] Document exact one-command usage and failure semantics.
- [x] Run targeted tests plus available wider unit tests.
- [x] Run `node --check`, `bash -n`, `git diff --check`, `git fsck`.
- [x] Commit feature and package a source ZIP with `.git`, excluding `.env`, `node_modules`, runtime state, and logs.
