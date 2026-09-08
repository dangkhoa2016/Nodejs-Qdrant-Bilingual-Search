# Node.js Qdrant Bilingual Search

[![CI](https://github.com/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search?display_name=tag&sort=semver)](https://github.com/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search/releases/latest)
[![License: MIT](https://img.shields.io/github/license/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Qdrant 1.18.3](https://img.shields.io/badge/Qdrant-1.18.3-DC244C)](https://github.com/qdrant/qdrant/releases/tag/v1.18.3)
[![Model: Qwen3-Embedding-4B](https://img.shields.io/badge/Model-Qwen3--Embedding--4B-6f42c1)](https://huggingface.co/Qwen/Qwen3-Embedding-4B)

> 🌐 Language / Ngôn ngữ: [English](README.md) | **Tiếng Việt**

Tìm kiếm ngữ nghĩa tiếng Anh/tiếng Việt trên kho ngữ liệu địa lý mở gồm 20.000 thực thể có thể tái tạo, sử dụng **Node.js + Hono + Qdrant + Qwen3-Embedding-4B**.

Runtime `v1.0.0` được chấp nhận được thiết kế cho môi trường Kaggle CPU có tính di động: model Qwen3-Embedding-4B được tải read-only từ `/kaggle/input`, inference chạy với **Transformers / PyTorch / CPU / FP16**, còn giao diện embedding công khai vẫn là vector **Float32[2560]** đã chuẩn hóa qua transport `binary-f32`.


## Tổng quan bản phát hành

| Khu vực | Trạng thái `v1.0.0` đã được xác thực |
| --- | --- |
| Model embedding | `Qwen/Qwen3-Embedding-4B` |
| Ngôn ngữ | Tiếng Anh + Tiếng Việt |
| Kho ngữ liệu Canonical | 20.000 / 20.000 đơn vị |
| Kích thước Vector | 2560 |
| Khoảng cách | cosin |
| Runtime | Transformers / PyTorch / CPU / FP16 |
| vector công khai | `Float32[2560]` được chuẩn hóa |
| Transport | `binary-f32` |
| Trình xác minh ngữ nghĩa Canonical | 20.000 / 20.000 ĐẠT |
| Khói ổn định sentinels | Thái Lan EN, Tokyo VI, Bắc Kinh VI, Casablanca âm = PASS |
| Bộ kiểm tra Node | 454/454 ĐẠT |
| CI | Node 22 + Node 24 + Công cụ Python + Tích hợp Qdrant |

Repository này là **demo/runtime profile tìm kiếm ngữ nghĩa có tính di động đã được xác thực**. Dự án không được trình bày như một stack GPU serving độ trễ thấp.

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

Cấu trúc service cục bộ mặc định:

```text
Qdrant             http://127.0.0.1:6333
Embedding service  http://127.0.0.1:8001
Node API           http://127.0.0.1:3000
```

Chỉ Node API được dự định đưa ra công khai qua demo tunnel tùy chọn. Qdrant và embedding service luôn giữ ở localhost trong profile này.

## Bắt đầu nhanh

### Yêu cầu

- Node.js `>=22`
- Môi trường Python có khả năng chạy embedding service
- Các tệp model Qwen3-Embedding-4B
- Qdrant với canonical collection hoặc một collection riêng do bạn tự xây dựng

Cài đặt các dependency Node:

```bash
npm ci
```

### Profile Kaggle CPU-FP16 canonical

Để tái tạo đúng profile canonical, hãy import và chạy notebook đã commit thay vì tự lắp ghép các Kaggle Input thủ công:

1. Tạo Kaggle Notebook mới và chọn **File → Import Notebook → GitHub**.
2. Chọn repository `dangkhoa2016/Nodejs-Qdrant-Bilingual-Search` và notebook `notebooks/kaggle-cpu-fp16-production-demo.ipynb`.
3. Bật **Internet** và đặt **Accelerator=None**.
4. Gắn Kaggle model bằng slug `dangkhoa2016/qwen-qwen3-embedding-4b`; chọn **Framework: `Transformers`** và **Variation: `default`** (`Transformers/default`).
5. Gắn canonical snapshot dataset bằng slug `dangkhoa2016/qdrant-bilingual-search-canonical-v2-1-20k`.
6. Giữ các mặc định an toàn của notebook:

   ```python
   RUN_LIVE_DEMO = True
   ENABLE_PUBLIC_TUNNEL = False
   ```

7. Chọn **Restart Session → Run All**.

Kaggle mount cả hai input ở chế độ read-only dưới `/kaggle/input`. **Không** sao chép model weights hoặc canonical snapshot dataset vào `/kaggle/working`; notebook và các resolver script sẽ tự tìm versioned input path, sau đó khôi phục writable Qdrant runtime state dưới `/kaggle/working/qdrant-bilingual-search/`.

Nếu chạy wrapper thủ công từ repository đã checkout, canonical writable Qdrant path là:

```bash
export QDRANT_STORAGE_PATH=/kaggle/working/qdrant-bilingual-search/qdrant-data
bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Wrapper hoạt động theo nguyên tắc fail-closed khi phát hiện runtime setting xung đột. Nó resolve model read-only từ `/kaggle/input`, ép CPU FP16 với batch size 1, bật offline model loading, rồi khởi động production-demo lifecycle.

Các lệnh lifecycle hữu ích:

```bash
./run.sh status
./run.sh restart
./run.sh stop
```

Để chỉ chạy cục bộ mà không mở Cloudflare Quick Tunnel công khai:

```bash
DEMO_PUBLIC=0 bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Xem [docs/kaggle-production-demo-notebook.vi.md](docs/kaggle-production-demo-notebook.vi.md), [docs/production-demo.vi.md](docs/production-demo.vi.md), và [docs/qwen3-embedding-kaggle-transformers-fp16.vi.md](docs/qwen3-embedding-kaggle-transformers-fp16.vi.md) để biết đầy đủ operator contract.

## Ví dụ API

Sau khi các service đã sẵn sàng:

```bash
curl -sS http://127.0.0.1:3000/api/v1/search \
  -H 'content-type: application/json' \
  -d '{"query":"quốc gia Đông Nam Á sử dụng đồng baht","language":"vi","limit":5,"score_threshold":0}'
```

Lọc có cấu trúc được hỗ trợ như một phần của request tìm kiếm:

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

Các endpoint kiểm tra trạng thái:

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
POST /translate   # only when local translation is enabled
```

## Hợp đồng runtime canonical

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

Độ chính xác model nội bộ và độ chính xác vector công khai khác nhau có chủ đích:

```text
FP16 model forward
→ last-token pooling
→ cast pooled tensor to Float32
→ Float32 L2 normalization
→ Float32[2560] public vector
→ binary-f32 transport
```

## Hợp đồng ngữ nghĩa Canonical

```text
model                = Qwen/Qwen3-Embedding-4B
dimension            = 2560
profile              = qwen3
query_strategy       = prompt
document_strategy    = raw
query_instruction_id = geo-retrieval-v1:d014d3ec6df87e49
embedding_text       = v2.1
```

Query prompt chính xác:

```text
Instruct: Retrieve the geographic entity that best answers the query
Query:
```

Các định danh này là một phần của semantic identity đã được chấp nhận và phải luôn khớp với Qdrant snapshot đang được truy vấn.

## Trạng thái Canonical Qdrant

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

Việc tái sử dụng snapshot được gate bằng xác minh semantic identity chứ không chỉ dựa vào tên tệp. Xem [docs/releases/v1.0.0.vi.md](docs/releases/v1.0.0.vi.md) để biết bằng chứng và phạm vi release.

Qdrant client profile được chọn một lần qua `QDRANT_PROVIDER`: `local` cho kết nối cục bộ mặc định hoặc `beam` / `modal` cho hosted single-node deployment. Xem [docs/qdrant-connection.md](docs/qdrant-connection.md).

## Tập dữ liệu và enrichment

GeoNames `cities15000` là backbone địa lý canonical. Who's On First enrichment tùy chọn bổ sung tên đa ngôn ngữ thông qua exact GeoNames concordance matching. Tên tiếng Việt bản địa được giữ nguyên và ưu tiên hơn enrichment.

Xây dựng public dataset:

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

Dịch base dataset hiện có bằng `npm run dataset:translate`:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Cloud translation đọc các key được đánh số theo provider như `OPENAI_KEY1`, `GEMINI_KEY1`, `NVIDIA_KEY1` và `GROQ_KEY1`, hỗ trợ retry/cooldown có giới hạn và dùng cache identity không bao giờ lưu giá trị API key. Chi tiết ở [docs/translation.md](docs/translation.md).

## Seeding và xác minh

Preview public seed mà không kết nối Qdrant hoặc tiêu tốn translation quota:

```bash
npm run seed:public -- \
  --sources geonames,wof \
  --types country,city \
  --limit 5000 \
  --translate groq \
  --model your-model-id \
  --dry-run
```

Xác minh canonical index hiện có:

```bash
npm run verify:canonical-config
npm run verify:semantic-index -- 20000
npm run seed:status -- --once --expected 20000
```

Production lifecycle không bao giờ âm thầm rebuild canonical collection.

## Kiểm tra

Node tests:

```bash
npm test
```

Python embedding-engine tests:

```bash
PYTHONPATH=embedding-service \
python -m unittest discover -s embedding-service/tests -v
```

Tích hợp Qdrant thực:

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

## Phạm vi retrieval đã được xác thực

Bộ compatibility sentinel ổn định đạt:

```text
Thailand EN          = PASS
Tokyo VI             = PASS
Beijing VI           = PASS
Casablanca negative  = PASS
```

Các smoke sentinel này là một **end-to-end regression gate nhỏ gọn và xác định**, không phải quality benchmark cho toàn bộ corpus 20K. Chúng xác minh rằng đường dẫn `query → embedding → Qdrant → search policy → API response` đã được chấp nhận vẫn duy trì hành vi positive/negative đã biết sau thay đổi runtime, snapshot hoặc deployment. Chất lượng retrieval rộng hơn được đánh giá riêng bằng các benchmark suite đã commit trong [benchmarks/README.md](benchmarks/README.md).

Một bộ relation-style diagnostics hẹp hơn cho thấy các giới hạn ranking model/snapshot đã biết. Cụ thể, query dạng quan hệ thủ đô nghiêm ngặt của Thái Lan có thể tạo near-tie giữa Bangkok-city và Thailand-country; các query Fuji/Japan vẫn chỉ mang tính diagnostic. Những trường hợp này được ghi nhận như limitation thay vì bị che giấu hoặc tổng quát hóa thành canonical PASS.

Chi tiết đầy đủ: [docs/releases/v1.0.0.vi.md](docs/releases/v1.0.0.vi.md).

## Bản đồ repository

```text
src/                Node.js API, search, Qdrant, seed and dataset logic
embedding-service/  Python FastAPI Qwen3-Embedding-4B embedding runtime
data/               fixtures, source catalogs and data provenance
scripts/            build, seed, verification, benchmark and demo tooling
docs/               architecture, operations, release and evidence documentation
tests/              unit, HTTP, architecture and integration tests
```

## Tài liệu

- [Ghi chú release v1.0.0](docs/releases/v1.0.0.vi.md)
- [Kaggle production-demo notebook](docs/kaggle-production-demo-notebook.vi.md)
- [Production demo](docs/production-demo.vi.md)
- [Profile Kaggle CPU Transformers FP16](docs/qwen3-embedding-kaggle-transformers-fp16.vi.md)
- [Kiến trúc](docs/architecture.md)
- [Tập dữ liệu và seeding](docs/dataset.md)
- [Translation providers](docs/translation.md)
- [Kết nối Qdrant](docs/qdrant-connection.md)
- [Testing](docs/testing.md)
- [Engineering portfolio](docs/portfolio.md)
- [Changelog](CHANGELOG.vi.md)

## Branch tham chiếu

`runtime/true-fp32` giữ lại implementation CPU true-FP32 dựng sẵn đã được chứng minh như một branch kỹ thuật/tham chiếu. Nó không phải canonical portable profile `v1.0.0`; `main` vẫn dùng CPU FP16 vì có memory headroom tốt hơn trên Kaggle.

## Hạn chế đã biết

- Demo/runtime portable hướng CPU, không phải low-latency GPU serving.
- Không có reranker.
- Không có hybrid sparse+dense retrieval.
- Không có lớp RAG.
- Không tự động reseed lúc runtime.
- Relation-style diagnostics có thể bộc lộ giới hạn ranking model/snapshot ngay cả khi canonical semantic verification PASS.

## Bảo mật và nguồn gốc

- Không bao giờ commit API key thật.
- Qdrant và embedding service phải giữ private/local trừ khi được bảo mật có chủ đích để dùng từ xa.
- Application code tuân theo license của repository.
- Dataset source có yêu cầu attribution riêng; xem [data/LICENSE-DATA.md](data/LICENSE-DATA.md).

## Cộng đồng và governance

- [Đóng góp](.github/CONTRIBUTING.vi.md) / [Contributing](.github/CONTRIBUTING.md)
- [Security policy](.github/SECURITY.md)
- [Hỗ trợ](.github/SUPPORT.vi.md) / [Support](.github/SUPPORT.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Issue templates](.github/ISSUE_TEMPLATE) và [pull-request checklist](.github/PULL_REQUEST_TEMPLATE.md)

## Bản phát hành

`v1.0.0` là release công khai đầu tiên của dự án này.

Xem GitHub Release và [docs/releases/v1.0.0.vi.md](docs/releases/v1.0.0.vi.md) để biết validated profile, evidence scope và reproduction pointers.
