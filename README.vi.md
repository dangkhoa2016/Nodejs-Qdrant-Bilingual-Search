# Node.js Qdrant Bilingual Open Knowledge Search

REST API tìm kiếm ngữ nghĩa Anh/Việt trên corpus địa lý mở có thể tái tạo gồm **20.000 entity**, sử dụng **Node.js + Hono + Qdrant + Qwen3-Embedding-4B**.

Profile `v1.0.0` được chấp nhận hướng đến môi trường Kaggle CPU khả chuyển: model Qwen3 được nạp read-only từ `/kaggle/input`, inference chạy bằng **Transformers / PyTorch / CPU / FP16**, còn giao diện embedding công khai vẫn là vector chuẩn hóa **Float32[2560]** qua transport `binary-f32`.

English documentation: [README.md](README.md)

## Trạng thái release

| Hạng mục | Trạng thái `v1.0.0` đã xác thực |
| --- | --- |
| Embedding model | `Qwen/Qwen3-Embedding-4B` |
| Ngôn ngữ | Tiếng Anh + Tiếng Việt |
| Corpus canonical | 20.000 / 20.000 entity |
| Vector dimension | 2560 |
| Distance | Cosine |
| Runtime | Transformers / PyTorch / CPU / FP16 |
| Public vector | normalized `Float32[2560]` |
| Transport | `binary-f32` |
| Canonical semantic verifier | 20.000 / 20.000 PASS |
| Stable smoke sentinels | Thailand EN, Tokyo VI, Beijing VI = PASS |
| Node test suite | 447 / 447 PASS |
| CI | Node 22 + Node 24 + Python engine + Qdrant integration |

Repository này là một **portable semantic-search demo/runtime profile đã được xác thực**. Nó không được mô tả như một low-latency GPU serving stack.

## Kiến trúc

```text
GeoNames + optional Who's On First enrichment
                    │
                    ▼
       canonical bilingual entities
                    │
          optional translation
                    │
                    ▼
 Qwen3-Embedding-4B embedding service
   Transformers / PyTorch / CPU / FP16
                    │
        normalized Float32[2560]
                    │ binary-f32
                    ▼
                Node.js
                  Hono
                    │
                    ▼
                  Qdrant
        canonical 20K collection
```

Topology local mặc định:

```text
Qdrant             http://127.0.0.1:6333
Embedding service  http://127.0.0.1:8001
Node API           http://127.0.0.1:3000
```

Chỉ Node API được thiết kế để có thể public qua demo tunnel tùy chọn. Qdrant và embedding service vẫn localhost-only.

## Quick start

### Yêu cầu

- Node.js `>=22`
- Python environment chạy được embedding service
- model files của Qwen3-Embedding-4B
- Qdrant có canonical collection, hoặc collection riêng do bạn tự build

Cài Node dependencies:

```bash
npm ci
```

### Canonical Kaggle CPU-FP16 profile

Attach model Qwen3 vào Kaggle Input và trỏ demo tới Qdrant storage persistent đang chứa verified 20K collection:

```bash
export QDRANT_STORAGE_PATH=/kaggle/working/qdrant-bilingual-search/qdrant-data
bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Wrapper fail-closed nếu có runtime setting xung đột. Nó resolve model read-only từ `/kaggle/input`, khóa CPU FP16 với batch size 1, bật offline model loading, rồi khởi động production-demo lifecycle.

Các lệnh lifecycle hữu ích:

```bash
./run.sh status
./run.sh restart
./run.sh stop
```

Chạy local-only, không mở Cloudflare Quick Tunnel:

```bash
DEMO_PUBLIC=0 bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Xem [docs/production-demo.md](docs/production-demo.md) và [docs/qwen3-embedding-kaggle-transformers-fp16.md](docs/qwen3-embedding-kaggle-transformers-fp16.md) để biết operator contract đầy đủ.

## Ví dụ API

Sau khi các service đã ready:

```bash
curl -sS http://127.0.0.1:3000/api/v1/search \
  -H 'content-type: application/json' \
  -d '{"query":"quốc gia Đông Nam Á sử dụng đồng baht","language":"vi","limit":5,"score_threshold":0}'
```

Search hỗ trợ structured filtering:

```bash
curl -sS http://127.0.0.1:3000/api/v1/search \
  -H 'content-type: application/json' \
  -d '{
    "query":"large city in Asia",
    "language":"en",
    "filter":{"type":"city","continent":"Asia","population":{"gte":5000000}},
    "limit":10
  }'
```

Health endpoints:

```text
GET /health
GET /ready
```

Embedding service cung cấp:

```text
GET  /health
GET  /model
POST /embed/query
POST /embed/documents
POST /translate   # chỉ khi local translation được bật
```

## Canonical runtime contract

```text
model                = Qwen/Qwen3-Embedding-4B
backend              = transformers
implementation       = python-fastapi
runtime              = pytorch-cpu
device               = cpu
accelerator          = cpu
internal dtype       = float16
dimension            = 2560
public vector dtype  = float32
transport            = binary-f32
```

Internal model precision và public vector precision là hai khái niệm khác nhau:

```text
FP16 model forward
→ last-token pooling
→ cast pooled tensor to Float32
→ Float32 L2 normalization
→ Float32[2560] public vector
→ binary-f32 transport
```

## Canonical semantic contract

```text
model                = Qwen/Qwen3-Embedding-4B
dimension            = 2560
profile              = qwen3
query_strategy       = prompt
document_strategy    = raw
query_instruction_id = geo-retrieval-v1:d014d3ec6df87e49
embedding_text       = v2.1
```

Exact query prompt:

```text
Instruct: Retrieve the geographic entity that best answers the query
Query:
```

Các identifier này thuộc semantic identity đã được chấp nhận và phải đồng bộ với Qdrant snapshot được truy vấn.

## Canonical Qdrant state

```text
collection        = knowledge_entities_qwen3_4b_text_v21
points_count      = 20000
indexed_vectors   = 20000
vector size       = 2560
distance          = Cosine
status            = green
optimizer_status  = ok
```

Đối với snapshot `v1.0.0` đã được chấp nhận:

```text
RESEED = NO
SNAPSHOT_REUSE = APPROVED
```

Snapshot reuse được gate bằng semantic identity verification, không phải chỉ dựa trên filename. Xem [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) để biết evidence và phạm vi release.

Qdrant client profile được chọn một lần qua `QDRANT_PROVIDER`: `local` cho kết nối local mặc định, hoặc `beam` / `modal` cho hosted single-node deployment. Chi tiết tại [docs/qdrant-connection.md](docs/qdrant-connection.md).

## Dataset và enrichment

GeoNames `cities15000` là canonical geographic backbone. Who's On First là enrichment tùy chọn, đóng góp tên đa ngôn ngữ thông qua exact GeoNames concordance matching. Native Vietnamese được giữ nguyên và ưu tiên hơn enrichment.

Build public dataset:

```bash
npm run dataset:build
```

Ví dụ build 20K:

```bash
npm run dataset:build -- \
  --sources geonames,wof \
  --types country,city \
  --limit 20000
```

Translation enrichment là tùy chọn:

```text
none | local | openai | gemini | nvidia | groq
```

Translate dataset base có sẵn bằng `npm run dataset:translate`:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Cloud translation đọc numbered per-provider key như `OPENAI_KEY1`, `GEMINI_KEY1`, `NVIDIA_KEY1` và `GROQ_KEY1`, hỗ trợ retry/cooldown có giới hạn và cache identity không bao giờ lưu API key value. Chi tiết tại [docs/translation.md](docs/translation.md).

## Seeding và verification

Preview public seed mà không connect Qdrant và không dùng translation quota:

```bash
npm run seed:public -- \
  --sources geonames,wof \
  --types country,city \
  --limit 5000 \
  --translate groq \
  --model your-model-id \
  --dry-run
```

Verify canonical index hiện có:

```bash
npm run verify:canonical-config
npm run verify:semantic-index -- 20000
npm run seed:status -- --once --expected 20000
```

Production lifecycle không tự động rebuild canonical collection một cách im lặng.

## Tests

Node tests:

```bash
npm test
```

Python embedding-engine tests:

```bash
PYTHONPATH=embedding-service \
python -m unittest discover -s embedding-service/tests -v
```

Real Qdrant integration:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

Production demo checks:

```bash
npm run demo
npm run smoke:production
```

## Phạm vi retrieval đã xác thực

Stable compatibility sentinel set đạt PASS:

```text
Thailand EN = PASS
Tokyo VI    = PASS
Beijing VI  = PASS
```

Một relation-style diagnostic set hẹp hơn cho thấy một số giới hạn ranking của model/snapshot. Cụ thể, strict Thailand capital-form query có thể tạo near-tie giữa Bangkok-city và Thailand-country; Fuji/Japan relation queries vẫn là diagnostic-only. Các trường hợp này được ghi rõ như limitation thay vì bị che giấu hoặc bị trộn vào canonical pass result.

Chi tiết: [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md).

## Repository map

```text
src/                Node.js API, search, Qdrant, seed và dataset logic
embedding-service/  Python FastAPI Qwen3 embedding runtime
data/               fixtures, source catalogs và data provenance
scripts/            build, seed, verification, benchmark và demo tooling
docs/               architecture, operations, release và evidence documentation
tests/              unit, HTTP, architecture và integration tests
```

## Documentation

- [Release notes v1.0.0](docs/releases/v1.0.0.md)
- [Production demo](docs/production-demo.md)
- [Kaggle CPU Transformers FP16 profile](docs/qwen3-embedding-kaggle-transformers-fp16.md)
- [Architecture](docs/architecture.md)
- [Dataset and seeding](docs/dataset.md)
- [Translation providers](docs/translation.md)
- [Qdrant connection](docs/qdrant-connection.md)
- [Testing](docs/testing.md)
- [Engineering portfolio](docs/portfolio.md)
- [Changelog](CHANGELOG.md)

## Reference branch

`runtime/true-fp32` giữ proven prebuilt true-FP32 CPU implementation như một engineering/reference branch. Đây không phải canonical portable profile của `v1.0.0`; `main` vẫn là CPU FP16 vì có memory headroom tốt hơn trên Kaggle.

## Known limitations

- Portable demo/runtime hướng CPU, không phải low-latency GPU serving.
- Không có reranker.
- Không có hybrid sparse+dense retrieval.
- Không có RAG layer.
- Không tự động reseed trong runtime.
- Relation-style diagnostics có thể bộc lộ ranking limitation của model/snapshot ngay cả khi canonical semantic verification đạt PASS.

## Security và provenance

- Không commit API key thật.
- Qdrant và embedding service nên giữ private/local trừ khi bạn chủ động triển khai cơ chế bảo vệ remote access.
- Application code tuân theo repository license.
- Dataset sources có attribution riêng; xem [data/LICENSE-DATA.md](data/LICENSE-DATA.md).

## Release

`v1.0.0` là public release đầu tiên của dự án.

Xem GitHub Release và [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) để biết validated profile, evidence scope và reproduction pointers.
