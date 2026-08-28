# Qwen3-Embedding-4B trên Google Colab T4

> **Lưu ý canonical promotion (2026-08-26):** ứng dụng hiện mặc định dùng `knowledge_entities_qwen3_4b_text_v21` với `embedding_text v2.1`. Tài liệu này còn các lệnh bootstrap/reseed v1 lịch sử; hãy giữ `knowledge_entities_qwen3_4b_v1` làm rollback/reference và không chạy lệnh destructive v1 trừ khi chủ động rebuild collection reference đó.


Đây là đường triển khai nhanh để benchmark `Qwen/Qwen3-Embedding-4B` mà không thay đổi kiến trúc Node.js/Qdrant hiện tại.

## Nguyên tắc

- Giữ `intfloat/multilingual-e5-small` và collection `knowledge_entities_e5_real_v1` làm baseline đã được xác minh.
- Chạy Qwen3-Embedding-4B thành embedding service riêng trên Colab T4.
- Dùng CUDA FP16, vector 2560 chiều, query instruction dành cho Qwen3, tokenizer left-padding và giới hạn sequence có kiểm soát.
- Chỉ dùng Cloudflare Quick Tunnel cho development/benchmark.
- Seed Qwen vào **collection mới**, tuyệt đối không ghi đè collection E5 baseline.

## Chạy trên Colab

Bật GPU T4, clone/giải nén repository rồi chạy:

```bash
bash scripts/colab/run-qwen3-embedding-t4.sh
```

Script khởi động cả embedding service và Cloudflare Quick Tunnel ở background, đợi tunnel cấp URL, in URL ra cell rồi trả quyền điều khiển về notebook. URL/PID/log được lưu tại:

```text
.runtime/colab-qwen3/cloudflared.url
.runtime/colab-qwen3/cloudflared.pid
.runtime/colab-qwen3/cloudflared.log
.runtime/colab-qwen3/embedding.pid
.runtime/colab-qwen3/embedding.log
```

Có thể xem lại endpoint bất kỳ lúc nào bằng:

```bash
cat .runtime/colab-qwen3/cloudflared.url
```

Mặc định script dùng:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cuda
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_SEQ_LENGTH=512
```

HTTP contract cũ được giữ nguyên:

```text
GET  /health
GET  /model
POST /embed/query
POST /embed/documents
```

Query của Qwen dùng instruction có version/identity ổn định; document không dùng prefix `passage:` của E5.

`/model` trả thêm provenance của GPU/profile Qwen. Hai endpoint embed trả thêm `inference_ms` để phân biệt thời gian inference thật với overhead của tunnel/network.


## Dừng và làm sạch phía Colab

Để dừng cả Qwen embedding service + Cloudflare tunnel và xóa toàn bộ runtime data cũ nhưng **giữ Hugging Face model cache**:

```bash
bash scripts/colab/stop-qwen3-embedding.sh
```

Script xóa toàn bộ `.runtime/colab-qwen3` (PID, URL, log, cloudflared binary đã tải) nhưng không đụng `${HF_HOME:-~/.cache/huggingface}`, vì vậy lần start tiếp theo có thể reuse model weights đã cache.

## Phía Node.js/Qdrant

Lấy URL `https://*.trycloudflare.com` mà `cloudflared` in ra rồi cấu hình:

```bash
export EMBEDDING_URL='https://REPLACE.trycloudflare.com'
export EMBEDDING_MODEL='Qwen/Qwen3-Embedding-4B'
export EMBEDDING_DIMENSION='2560'
export EMBEDDING_VERSION='qwen3-4b-v1'
export EMBEDDING_REQUEST_TIMEOUT_MS='120000'
export QDRANT_COLLECTION='knowledge_entities_qwen3_4b_v1'
```

Kiểm tra runtime trước khi seed:

```bash
curl -s "$EMBEDDING_URL/model" | jq .
```

Các field quan trọng phải là:

```text
model          Qwen/Qwen3-Embedding-4B
dimension      2560
backend        sentence-transformers
implementation python-fastapi
semantic       true
accelerator    gpu
device         cuda
dtype          float16
runtime        pytorch-cuda
profile        qwen3
query_strategy prompt
document_strategy raw
```

Nếu `data/generated/entities.final.json` của baseline 20k vẫn còn, hãy dùng đúng file đó để **không rebuild GeoNames/WOF**. Với embedding từ Colab, giữ GPU minibatch ở 8 nhưng dùng Node HTTP batch lớn hơn (mặc định 64) để giảm số round-trip qua Cloudflare.

Để chạy một clean seed phá hủy dữ liệu Qwen cũ một cách có guard:

```bash
npm run seed:clean:qwen3 -- \
  --confirm-delete knowledge_entities_qwen3_4b_v1 \
  --dataset data/generated/entities.final.json
```

Helper tự dừng seed process cũ trước khi xóa, bắt buộc có Qdrant API key, gửi key trong header `api-key`, xóa collection Qwen rồi poll đến khi xác nhận 404/absent, xóa progress/log Qwen cũ, kiểm tra `/model`, sau đó seed lại từ 0 với `SEED_BATCH_SIZE=64`. Helper không xóa dataset canonical và hard-refuse collection E5 baseline.

`seed:existing` vẫn fail-closed với semantic provenance. Nếu file dataset cuối không còn, khi đó mới fallback sang `seed:public`. Nếu VRAM T4 thiếu, hạ `EMBEDDING_BATCH_SIZE` xuống `4` hoặc `2` trước khi cân nhắc quantization.

Xác minh và benchmark:

```bash
npm run verify:semantic-index -- 20000
npm start
npm run benchmark
```

## Quy tắc A/B

Không xóa hoặc sửa collection:

```text
knowledge_entities_e5_real_v1
```

Mục tiêu là so sánh A/B E5 baseline với Qwen trên cùng benchmark corpus.

## Production

Colab + Cloudflare Quick Tunnel chỉ là môi trường thử nghiệm. Khi đã chọn model, triển khai cùng FastAPI service lên Modal hoặc Beam với GPU L4/A10/A10G, seed lại production collection và chạy provenance audit lần cuối.

## Binary Float32 transport và micro-benchmark trước khi seed

Service vẫn giữ endpoint JSON để tương thích ngược và bổ sung:

```text
POST /embed/documents/binary
Content-Type: application/x-float32
```

Response là Float32 little-endian liên tục, row-major với shape `[count, dimension]`. `/model` phải quảng bá:

```json
{
  "transports": {
    "json": true,
    "float32_binary": true
  }
}
```

Ở máy Node/Qdrant, JSON vẫn là default tương thích ngược, nhưng với thử nghiệm Qwen phải chọn binary rõ ràng:

```bash
export EMBEDDING_TRANSPORT='binary-f32'
```

Binary mode hoạt động fail-closed: `HttpEmbeddingProvider.assertCompatible()` và wrapper destructive `seed:clean:qwen3` sẽ từ chối chạy nếu service remote không quảng bá binary. Không có silent fallback và không dùng Base64. Transport không được đưa vào semantic provenance/fingerprint vì JSON hay Float32 chỉ là wire encoding, không thay đổi model, document text hay ý nghĩa embedding.

Trước khi xóa/reseed collection Qwen, hãy so sánh hai transport trên cùng một subset canonical mà **không đụng Qdrant**:

```bash
npm run benchmark:embedding-transport -- \
  --dataset data/generated/entities.final.json \
  --count 256 \
  --batch-size 64 \
  --transports json,binary-f32 \
  --output reports/embedding-transport-benchmark.json
```

Report ghi riêng cho từng transport:

```text
serverInferenceMs
httpRoundTripMs
transferOverheadMs
wallMs
serverInferenceDocsPerSecond
httpDocsPerSecond
endToEndDocsPerSecond
```

Chỉ tiếp tục clean seed 20k khi binary cho thấy cải thiện end-to-end rõ ràng. Full run:

```bash
export EMBEDDING_TRANSPORT='binary-f32'
npm run seed:clean:qwen3 -- \
  --confirm-delete knowledge_entities_qwen3_4b_v1 \
  --dataset data/generated/entities.final.json \
  --seed-http-batch-size 64
```

Progress seed giờ tách riêng GPU/server inference, embedding HTTP round-trip, transfer overhead, Qdrant upsert và throughput GPU/HTTP/E2E/Qdrant. Với T4, giữ `EMBEDDING_BATCH_SIZE=8` cho phép so sánh binary đầu tiên; chỉ thử HTTP batch 128/256 sau khi đã đo binary batch 64.
