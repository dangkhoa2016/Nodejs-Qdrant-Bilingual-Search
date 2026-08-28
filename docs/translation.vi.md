# Kiến trúc dịch thuật và multiple API keys

## Nguyên tắc

Translation chỉ là enrichment stage tùy chọn, không phải điều kiện để semantic search hoạt động. Tiếng Việt native từ GeoNames/WOF không bị ghi đè. Default provider là `none`.

Các mode: `none`, `local`, `openai`, `gemini`, `nvidia`, `groq`. Cloud REST dùng native `fetch`, không cần cài vendor SDK.

## Provider boundary

`createTranslationProvider()` trả một contract chung gồm `provider`, `model`, `promptVersion`, `translate()`. `TranslationService` bổ sung cache và provenance. Dataset pipeline không cần biết JSON schema riêng của từng vendor.

OpenAI dùng Responses API; Gemini dùng `models/{model}:generateContent`; NVIDIA và Groq dùng chung adapter OpenAI-compatible chat completions với base URL riêng.

Không có auto-failover giữa provider. Nếu chọn `TRANSLATION_PROVIDER=groq` thì run đó luôn là Groq để provenance/model ổn định. Multiple key chỉ cân bằng quota và tăng resilience **bên trong provider đã chọn**.

## Phát hiện multiple key

Cho phép số bị nhảy:

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

Vẫn tương thích `OPENAI_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `GROQ_API_KEY`. Secret trùng nhau được dedupe. Numbered keys được sort theo số rồi mới tới fallback key.

## Key-pool policy

Default là `round-robin` giữa key đang ready.

- `401/403`: disable key hiện tại trong process run và chuyển sang key khác.
- `429`: cooldown key, tôn trọng `Retry-After` nếu provider trả về, rồi dùng key ready khác.
- `408/425/500/502/503/504` và network/Undici transient: retry **cùng key** với bounded exponential backoff; đổi credential không giải quyết provider outage.
- `400/404/422`: fail-fast vì thường là model/request sai.
- Hết toàn bộ key usable: `ApiKeyPoolExhaustedError`.
- Tất cả key đang cooldown: chỉ chờ trong `TRANSLATION_KEY_MAX_WAIT_MS`, vượt budget thì báo cooling error.

```env
TRANSLATION_KEY_STRATEGY=round-robin
TRANSLATION_KEY_COOLDOWN_MS=60000
TRANSLATION_KEY_MAX_WAIT_MS=60000
TRANSLATION_RETRY_MAX_ATTEMPTS=3
TRANSLATION_RETRY_BASE_DELAY_MS=250
TRANSLATION_RETRY_MAX_DELAY_MS=2000
TRANSLATION_RETRY_JITTER_RATIO=0.2
```

## Bảo mật secret

Lease giữ secret bằng private field. Snapshot/`toJSON()` chỉ hiển thị slot/status/counter. Error cloud chỉ giữ provider/status/transport code, không giữ raw Authorization header hay key value.

Translation provenance cũng không lưu key slot vì key chỉ là hạ tầng thực thi, không phải provenance của dữ liệu.

## Cache/resume

Default:

```text
data/generated/translation-cache.jsonl
```

Cache identity là SHA-256 của provider/model/prompt version/language direction/source-text hash và cố ý không chứa API key slot. Một run có thể bắt đầu bằng `GROQ_KEY1`, chuyển `GROQ_KEY2`, restart rồi vẫn reuse các bản dịch đã hoàn tất.

JSONL cache là append-only. Trong cùng process, các request trùng text còn được coalesce bằng in-flight map để không gọi API hai lần.

## Provenance

Metadata machine translation:

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

`languageProvenance.description_vi` trở thành `machine_translation`; field VI native vẫn giữ provenance nguồn gốc.

## Chạy

Dry-run không tốn cloud quota:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Run thật:

```bash
export GROQ_KEY1='...'
export GROQ_KEY2='...'
npm run dataset:translate -- --provider groq --model your-model-id --fields description
```

Local Python:

```bash
TRANSLATION_PROVIDER=local \
TRANSLATION_MODEL=Helsinki-NLP/opus-mt-en-vi \
npm run dataset:translate
```

Cloud model ID không có default hard-code vì availability/pricing/behavior thay đổi theo thời gian; hãy truyền `TRANSLATION_MODEL` rõ ràng.
