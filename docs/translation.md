# Translation architecture and multiple API keys
> 🌐 Language / Ngôn ngữ: **English** | [Tiếng Việt](translation.vi.md)

## Principle

Translation is optional dataset enrichment, not a runtime requirement for semantic search. Native Vietnamese from GeoNames or Who's On First is never overwritten. The default provider is `none`.

Supported providers are `none`, `local`, `openai`, `gemini`, `nvidia`, and `groq`. The application uses native `fetch` for cloud REST calls and therefore does not require vendor SDK packages.

## Provider boundary

`createTranslationProvider()` returns a common provider exposing `provider`, `model`, `promptVersion`, and `translate()`. `TranslationService` adds persistent cache/provenance. Dataset code calls that contract and does not know vendor HTTP shapes.

OpenAI uses the Responses API. Gemini uses `models/{model}:generateContent`. NVIDIA and Groq share an OpenAI-compatible chat-completions adapter with provider-specific base URLs.

There is no cross-provider automatic failover. If `TRANSLATION_PROVIDER=groq`, the run stays on Groq. This keeps output model/provenance deterministic. Multiple keys only improve resilience and quota distribution **inside the chosen provider**.

## Multiple key discovery

The key discovery layer accepts numbered variables with arbitrary numeric gaps:

```env
OPENAI_KEY1=...
OPENAI_KEY3=...
GEMINI_KEY1=...
GEMINI_KEY8=...
NVIDIA_KEY1=...
NVIDIA_KEY2=...
GROQ_KEY1=...
GROQ_KEY2=...
GROQ_KEY10=...
```

Conventional `OPENAI_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `GROQ_API_KEY` remain supported. Duplicate secret values are deduplicated. Numbered keys are numerically ordered before the fallback key.

## Key-pool policy

The default strategy is `round-robin` among ready keys.

- HTTP `401/403`: the current key is disabled for the rest of that process run, then another ready key is acquired.
- HTTP `429`: the key enters cooldown; `Retry-After` is honored when present; another ready key is acquired.
- HTTP `408/425/500/502/503/504` and known Node/Undici network failures: bounded retry occurs on the **same key**. Rotating credentials does not solve provider outage.
- Request/model errors such as `400/404/422`: fail fast instead of wasting every key.
- If all keys are disabled, `ApiKeyPoolExhaustedError` is raised.
- If all enabled keys are cooling, the pool waits only within `TRANSLATION_KEY_MAX_WAIT_MS`; otherwise it reports a cooling error.

Configuration:

```env
TRANSLATION_KEY_STRATEGY=round-robin
TRANSLATION_KEY_COOLDOWN_MS=60000
TRANSLATION_KEY_MAX_WAIT_MS=60000
TRANSLATION_RETRY_MAX_ATTEMPTS=3
TRANSLATION_RETRY_BASE_DELAY_MS=250
TRANSLATION_RETRY_MAX_DELAY_MS=2000
TRANSLATION_RETRY_JITTER_RATIO=0.2
```

## Secret handling

The lease object keeps the secret private. `toJSON()` and key-pool snapshots expose slot names/status/counters only. Cloud HTTP errors store provider/status/transport code but do not retain raw request headers or API key values.

Translation provenance never contains an API key slot because the key is operational infrastructure, not data provenance.

## Cache/resume

Default path:

```text
data/generated/translation-cache.jsonl
```

Cache identity is SHA-256 over provider, model, prompt version, language direction and source-text SHA-256. API key slot is intentionally excluded. Therefore a run may begin on `GROQ_KEY1`, rotate to `GROQ_KEY2`, restart later, and still reuse prior translations.

The cache is append-only JSONL and is loaded into a map on demand. Concurrent duplicate requests are coalesced by an in-flight map so one text is not translated twice in the same process.

## Provenance

Generated fields receive metadata:

```json
{
  "provider": "groq",
  "model": "your-model-id",
  "prompt_version": "translation-v1",
  "source_language": "en",
  "target_language": "vi",
  "source_sha256": "...",
  "translation_version": "v1"
}
```

`languageProvenance.description_vi` becomes `machine_translation`. Native Vietnamese fields retain their original source provenance.

## Commands

Dry-run without consuming cloud quota:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Run:

```bash
export GROQ_KEY1='...'
export GROQ_KEY2='...'
npm run dataset:translate -- --provider groq --model your-model-id --fields description
```

Local mode uses the Python service:

```bash
TRANSLATION_PROVIDER=local \
TRANSLATION_MODEL=Helsinki-NLP/opus-mt-en-vi \
npm run dataset:translate
```

Cloud model IDs are never hard-coded as defaults because availability, pricing and behavior can change. Supply `TRANSLATION_MODEL` explicitly.
