# Qwen3-Embedding-4B trên Google Colab T4
> 🌐 Language / Ngôn ngữ: [English](qwen3-embedding-colab.md) | **Tiếng Việt**

> **Thông báo khuyến mãi Canonical (26-08-2026):** ứng dụng hiện nhắm mục tiêu `knowledge_entities_qwen3_4b_text_v21` với `embedding_text v2.1` theo mặc định. Tài liệu này chứa các lệnh v1 bootstrap/reseed lịch sử; giữ `knowledge_entities_qwen3_4b_v1` dưới dạng rollback/tham chiếu và không chạy các lệnh v1 phá hoại trừ khi bạn có ý định rõ ràng là xây dựng lại tham chiếu collection đó.


Đây là đường dẫn phát triển nhanh/benchmark để đánh giá `Qwen/Qwen3-Embedding-4B` mà không thay đổi kiến ​​trúc Node.js/Qdrant.

## Tại sao con đường này

- Giữ `intfloat/multilingual-e5-small` và `knowledge_entities_e5_real_v1` làm baseline được chấp nhận.
- Chạy Qwen3-Embedding-4B dưới dạng embedding service riêng biệt trên Colab T4.
- Sử dụng CUDA FP16, embeddings 2560 chiều, lệnh Qwen3 query, phần đệm mã thông báo bên trái và độ dài chuỗi giới hạn.
- Chỉ hiển thị service tạm thời thông qua Cloudflare Quick Tunnel để phát triển/đo điểm chuẩn.
- Seed Qwen thành Qdrant collection **mới**. Không bao giờ ghi đè lên E5 baseline collection.

## Phía Colab

Sao chép/trích xuất repository trong Colab, bật T4 runtime, sau đó chạy:

```bash
bash scripts/colab/run-qwen3-embedding-t4.sh
```

Tập lệnh khởi động cả embedding service và Cloudflare Quick Tunnel ở chế độ nền, đợi URL đường hầm, in nó vào ô và trả lại quyền điều khiển cho notebook. Các tệp URL/PID/log được lưu trữ tại:

```text
.runtime/colab-qwen3/cloudflared.url
.runtime/colab-qwen3/cloudflared.pid
.runtime/colab-qwen3/cloudflared.log
.runtime/colab-qwen3/embedding.pid
.runtime/colab-qwen3/embedding.log
```

Bạn có thể in lại endpoint hiện tại bằng:

```bash
cat .runtime/colab-qwen3/cloudflared.url
```

Kịch bản mặc định là:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cuda
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_SEQ_LENGTH=512
```

service giữ hợp đồng HTTP hiện có:

```text
GET  /health
GET  /model
POST /embed/query
POST /embed/documents
```

Qwen queries sử dụng hướng dẫn miền được phiên bản. Tài liệu được nhúng mà không có tiền tố E5 `passage:` cũ.

`/model` response bao gồm backend ngữ nghĩa cộng với xuất xứ Qwen runtime/profile. `/embed/query` và `/embed/documents` cũng hiển thị `inference_ms` phía máy chủ để chẩn đoán latency giữa đường hầm và mô hình.


## Dừng và làm sạch mặt Colab

Để dừng cả processes được quản lý và xóa tất cả trạng thái Qwen Colab runtime trong khi vẫn duy trì Hugging Face model cache:

```bash
bash scripts/colab/stop-qwen3-embedding.sh
```

Thao tác này sẽ xóa `.runtime/colab-qwen3` (PID, URL, nhật ký, tệp nhị phân đường hầm nhanh đã tải xuống) nhưng **không** xóa `${HF_HOME:-~/.cache/huggingface}`. Do đó, lần khởi động Qwen tiếp theo có thể sử dụng lại các trọng số model đã tải xuống.

## Node/phía Qdrant

Sử dụng URL `https://*.trycloudflare.com` được in bởi `cloudflared`:

```bash
export EMBEDDING_URL='https://REPLACE.trycloudflare.com'
export EMBEDDING_MODEL='Qwen/Qwen3-Embedding-4B'
export EMBEDDING_DIMENSION='2560'
export EMBEDDING_VERSION='qwen3-4b-v1'
export EMBEDDING_REQUEST_TIMEOUT_MS='120000'
export QDRANT_COLLECTION='knowledge_entities_qwen3_4b_v1'
```

Xác minh runtime từ xa trước seeding:

```bash
curl -s "$EMBEDDING_URL/model" | jq .
```

Các lĩnh vực quan trọng dự kiến:

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

Nếu 20k `data/generated/entities.final.json` được chấp nhận vẫn có sẵn, seed chính xác là tệp đó nên thử nghiệm **không xây dựng lại GeoNames/WOF** và chỉ thay đổi model/runtime. Đối với Colab embedding từ xa, hãy giữ minibatch GPU ở mức 8 trong khi sử dụng Node HTTP batch lớn hơn (64 theo mặc định) để giảm các chuyến đi khứ hồi của Cloudflare.

Để chạy Qwen collection một cách triệt để, hãy sử dụng trình trợ giúp được bảo vệ:

```bash
npm run seed:clean:qwen3 -- \
  --confirm-delete knowledge_entities_qwen3_4b_v1 \
  --dataset data/generated/entities.final.json
```

Trình trợ giúp dừng mọi seed process trước đó, yêu cầu khóa Qdrant API, gửi nó dưới dạng tiêu đề `api-key`, xóa và xác nhận sự vắng mặt của Qwen collection, xóa bằng chứng tiến trình/chạy Qwen seed cũ, xác minh hợp đồng embedding `/model`, sau đó bắt đầu `seed:existing` từ điểm 0 với `SEED_BATCH_SIZE=64`. Nó không bao giờ xóa tập dữ liệu canonical hoặc E5 baseline collection được bảo vệ.

`seed:existing` vẫn không đóng được nguồn gốc ngữ nghĩa. Chỉ quay lại `seed:public` khi không có tệp dữ liệu cuối cùng. Nếu bộ nhớ CUDA chật hẹp, hãy giảm `EMBEDDING_BATCH_SIZE` xuống `4` hoặc `2` trước khi xem xét lượng tử hóa.

Sau khi seed hoàn thành:

```bash
npm run verify:semantic-index -- 20000
npm start
npm run benchmark
```

## Quy tắc so sánh quan trọng

Không xóa hoặc thay đổi:

```text
knowledge_entities_e5_real_v1
```

Thử nghiệm hữu ích là so sánh A/B giữa E5 baseline được chấp nhận và Qwen collection mới trong cùng một kho văn bản benchmark.

## Production hóa

Cloudflare Quick Tunnel và Colab chỉ là môi trường thử nghiệm. Sau khi lựa chọn model, hãy triển khai FastAPI service tương tự sang Modal hoặc Beam trên GPU lớp L4/A10/A10G, reseed production collection cuối cùng và chạy lại kiểm tra xuất xứ.

## Theo dõi embedding/seed trực tiếp

embedding service hiển thị các bộ đếm inference tích lũy thành công:

```bash
curl -fsS http://127.0.0.1:8001/stats | jq .
```

Các trường quan trọng:

```text
requests.document_requests
requests.documents_embedded
requests.last_document_batch_size
requests.document_inference_ms
requests.query_requests
requests.queries_embedded
requests.uptime_seconds
```

Mỗi tài liệu thành công batch cũng được ghi vào `.runtime/colab-qwen3/embedding.log` dưới dạng sự kiện cấp ứng dụng tương tự như:

```text
embedding_documents_completed batch=8 requests=125 documents=1000 inference_ms=...
```

Bộ đếm này đo công việc được chấp nhận và hoàn thành bởi embedding service. Retries có thể làm cho nó lớn hơn số điểm Qdrant duy nhất, vì vậy hãy sử dụng Qdrant `points_count` làm số điểm cam kết chính thức.

Trên máy Node/Qdrant, các lệnh seed vẫn tồn tại:

```text
reports/seed-progress.json    current atomic snapshot
reports/seed-progress.jsonl   timestamped progress event stream
```

Mỗi lần chạy sẽ nhận được `seedRunId` ổn định. Theo mặc định, tiến trình của bảng điều khiển/tệp được điều chỉnh ở mức khoảng một bản cập nhật trên 1% batches. Ghi đè bằng `SEED_PROGRESS_EVERY_BATCHES`.

Để triển khai Qdrant đã được xác thực, hãy theo dõi số lượng collection đã cam kết bằng trình trợ giúp repository:

```bash
export QDRANT_URL='https://YOUR-QDRANT'
export QDRANT_API_KEY='...'
export QDRANT_COLLECTION='knowledge_entities_qwen3_4b_v1'
npm run seed:status -- --expected 20000 --interval 5
```

Người trợ giúp gửi khóa trong tiêu đề Qdrant `api-key` request và không bao giờ in bí mật. Độ cong thô one-shot tương đương:

```bash
curl -fsS \
  -H "api-key: $QDRANT_API_KEY" \
  "$QDRANT_URL/collections/$QDRANT_COLLECTION" \
  | jq '{status:.result.status, points:.result.points_count, indexed:.result.indexed_vectors_count}'
```

## Float32 transport nhị phân và điểm chuẩn vi mô tiền hạt giống

service giữ JSON endpoint để tương thích và bổ sung:

```text
POST /embed/documents/binary
Content-Type: application/x-float32
```

response là Float32 nhỏ liền kề, `[count, dimension]` hàng chính. `/model` phải quảng cáo:

```json
{
  "transports": {
    "json": true,
    "float32_binary": true
  }
}
```

Trên máy Node/Qdrant, hãy giữ JSON làm mặc định tương thích ngược toàn cầu, nhưng chọn rõ ràng nhị phân cho thử nghiệm Qwen:

```bash
export EMBEDDING_TRANSPORT='binary-f32'
```

Chế độ nhị phân là fail-closed: `HttpEmbeddingProvider.assertCompatible()` và trình bao bọc `seed:clean:qwen3` mang tính hủy diệt từ chối tiếp tục nếu service từ xa không quảng cáo hỗ trợ nhị phân. Lựa chọn Transport được cố tình loại trừ khỏi nguồn gốc/dấu vân tay runtime ngữ nghĩa vì mã hóa dây JSON so với Float32 không thay đổi ngữ nghĩa model, văn bản tài liệu hoặc embedding.

Trước khi xóa/đặt lại Qwen collection, hãy so sánh cả hai phương thức vận chuyển với cùng một tập hợp con tài liệu canonical mà không chạm vào Qdrant:

```bash
npm run benchmark:embedding-transport -- \
  --dataset data/generated/entities.final.json \
  --count 256 \
  --batch-size 64 \
  --transports json,binary-f32 \
  --output reports/embedding-transport-benchmark.json
```

Báo cáo ghi lại, theo transport:

```text
serverInferenceMs
httpRoundTripMs
transferOverheadMs
wallMs
serverInferenceDocsPerSecond
httpDocsPerSecond
endToEndDocsPerSecond
```

Chỉ tiếp tục phá hủy 20k seed khi quá trình chạy nhị phân cho thấy sự cải thiện rõ ràng từ đầu đến cuối. Để chạy đầy đủ:

```bash
export EMBEDDING_TRANSPORT='binary-f32'
npm run seed:clean:qwen3 -- \
  --confirm-delete knowledge_entities_qwen3_4b_v1 \
  --dataset data/generated/entities.final.json \
  --seed-http-batch-size 64
```

Tiến trình Seed hiện phân tách GPU/server inference, embedding HTTP khứ hồi, chi phí truyền tải, thời gian nâng cấp Qdrant và GPU/HTTP/E2E/Qdrant throughput. Giữ `EMBEDDING_BATCH_SIZE=8` trên T4 để so sánh nhị phân đầu tiên; chỉ điều chỉnh HTTP batch 128/256 sau khi đo batch 64 nhị phân.
