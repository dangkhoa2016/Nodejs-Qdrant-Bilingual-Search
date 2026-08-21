# Node.js Qdrant Tìm kiếm kiến ​​thức mở song ngữ

[![CI](https://github.com/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search?display_name=tag&sort=semver)](https://github.com/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search/releases/latest)
[![License: MIT](https://img.shields.io/github/license/dangkhoa2016/Nodejs-Qdrant-Bilingual-Search)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Qdrant 1.18.3](https://img.shields.io/badge/Qdrant-1.18.3-DC244C)](https://github.com/qdrant/qdrant/releases/tag/v1.18.3)
[![Model: Qwen3-Embedding-4B](https://img.shields.io/badge/Model-Qwen3--Embedding--4B-6f42c1)](https://huggingface.co/Qwen/Qwen3-Embedding-4B)

> 🌐 Language / Ngôn ngữ: [English](README.md) | **Tiếng Việt**

Tìm kiếm ngữ nghĩa tiếng Anh/tiếng Việt trên kho ngữ liệu địa lý mở gồm 20.000 thực thể có thể tái tạo, được cung cấp bởi **Node.js + Hono + Qdrant + Qwen3-Embedding-4B**.

`v1.0.0` runtime được chấp nhận được thiết kế cho môi trường Kaggle CPU di động: model Qwen3-Embedding-4B được tải read-only từ `/kaggle/input`, inference chạy với **Transformers / PyTorch / CPU / FP16** và giao diện embedding công khai vẫn được chuẩn hóa **Float32[2560]** qua `binary-f32` transport.


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
| Bộ kiểm tra Node | 447/447 ĐẠT |
| CI | Node 22 + Node 24 + Công cụ Python + Tích hợp Qdrant |

repository này là **demo/runtime profile tìm kiếm ngữ nghĩa di động đã được xác thực**. Nó không được trình bày dưới dạng ngăn xếp phân phối GPU có độ trễ thấp.

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

Cấu trúc liên kết service cục bộ mặc định:

```text
Qdrant             http://127.0.0.1:6333
Embedding service  http://127.0.0.1:8001
Node API           http://127.0.0.1:3000
```

Chỉ Node API được dự định hiển thị công khai bởi đường hầm demo tùy chọn. Qdrant và embedding service vẫn chỉ ở chế độ localhost.

## Bắt đầu nhanh

### Yêu cầu

- Node.js `>=22`
- Môi trường Python có khả năng chạy embedding service
- Các tệp Qwen3-Embedding-4B model
- Qdrant với canonical collection hoặc collection riêng biệt do bạn tự xây dựng

Cài đặt phụ thuộc Node:

```bash
npm ci
```

### Profile Kaggle CPU-FP16 chuẩn

Gắn model Qwen3-Embedding-4B trong Đầu vào Kaggle và trỏ demo vào bộ lưu trữ Qdrant liên tục chứa 20K collection đã được xác minh:

```bash
export QDRANT_STORAGE_PATH=/kaggle/working/qdrant-bilingual-search/qdrant-data
bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Trình bao bọc không đóng được trên các cài đặt runtime xung đột. Nó phân giải model read-only từ `/kaggle/input`, thực thi CPU FP16 với batch kích thước 1, cho phép tải model ngoại tuyến, sau đó bắt đầu vòng đời sản xuất-bản demo.

Các lệnh vòng đời hữu ích:

```bash
./run.sh status
./run.sh restart
./run.sh stop
```

Đối với hoạt động chỉ cục bộ mà không có Cloudflare Quick Tunnel công khai:

```bash
DEMO_PUBLIC=0 bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Xem [docs/production-demo.md](docs/production-demo.md) và [docs/qwen3-embedding-kaggle-transformers-fp16.md](docs/qwen3-embedding-kaggle-transformers-fp16.md) để biết hợp đồng điều hành đầy đủ.

## Ví dụ API

Sau khi services đã sẵn sàng:

```bash
curl -sS http://127.0.0.1:3000/api/v1/search \
  -H 'content-type: application/json' \
  -d '{"query":"quốc gia Đông Nam Á sử dụng đồng baht","language":"vi","limit":5,"score_threshold":0}'
```

Lọc có cấu trúc được hỗ trợ như một phần của tìm kiếm request:

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

embedding service hiển thị:

```text
GET  /health
GET  /model
POST /embed/query
POST /embed/documents
POST /translate   # only when local translation is enabled
```

## Hợp đồng runtime chuẩn

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

Độ chính xác model nội bộ và độ chính xác vector công khai có sự khác biệt có chủ ý:

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

Lời nhắc query chính xác:

```text
Instruct: Retrieve the geographic entity that best answers the query
Query:
```

Các mã định danh này là một phần của danh tính ngữ nghĩa được chấp nhận và phải luôn liên kết với Qdrant snapshot đang được truy vấn.

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

Đối với `v1.0.0` snapshot được chấp nhận:

```text
RESEED = NO
SNAPSHOT_REUSE = APPROVED
```

Việc tái sử dụng Snapshot được kiểm soát bằng xác minh danh tính ngữ nghĩa chứ không chỉ bằng tên tệp. Xem [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) để biết bằng chứng và phạm vi của release.

Cấu hình Qdrant client được chọn một lần thông qua `QDRANT_PROVIDER`: `local` cho kết nối cục bộ mặc định hoặc `beam` / `modal` để triển khai một Node được lưu trữ. Xem [docs/qdrant-connection.md](docs/qdrant-connection.md).

## Tập dữ liệu và làm giàu

GeoNames `cities15000` là xương sống địa lý canonical. Làm giàu Who's On First tùy chọn đóng góp các tên đa ngôn ngữ thông qua đối sánh phù hợp chính xác GeoNames. Tên bản địa tiếng Việt được giữ nguyên và ưu tiên làm giàu.

Xây dựng tập dữ liệu công khai:

```bash
npm run dataset:build
```

Ví dụ về bản dựng 20K:

```bash
npm run dataset:build -- \
  --sources geonames,wof \
  --types country,city \
  --limit 20000
```

Làm giàu bản dịch là tùy chọn:

```text
none | local | openai | gemini | nvidia | groq
```

Dịch tập dữ liệu cơ sở hiện có bằng `npm run dataset:translate`:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Dịch đám mây đọc các khóa được đánh số theo nhà cung cấp, chẳng hạn như `OPENAI_KEY1`, `GEMINI_KEY1`, `NVIDIA_KEY1` và `GROQ_KEY1`, hỗ trợ hành vi retry/thời gian hồi chiêu bị giới hạn và sử dụng danh tính cache không bao giờ duy trì các giá trị khóa API. Thông tin chi tiết có trong [docs/translation.md](docs/translation.md).

## Seeding và xác minh

Xem trước seed công khai mà không cần kết nối với Qdrant hoặc sử dụng hạn ngạch dịch:

```bash
npm run seed:public -- \
  --sources geonames,wof \
  --types country,city \
  --limit 5000 \
  --translate groq \
  --model your-model-id \
  --dry-run
```

Xác minh chỉ mục canonical hiện có:

```bash
npm run verify:canonical-config
npm run verify:semantic-index -- 20000
npm run seed:status -- --once --expected 20000
```

Vòng đời production không bao giờ âm thầm xây dựng lại canonical collection.

## Kiểm tra

Kiểm tra Node:

```bash
npm test
```

Kiểm tra công cụ nhúng Python:

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

Production demo kiểm tra:

```bash
npm run demo
npm run smoke:production
```

## Phạm vi truy xuất đã được xác thực

Bộ sentinel tương thích ổn định vượt qua:

```text
Thailand EN          = PASS
Tokyo VI             = PASS
Beijing VI           = PASS
Casablanca negative  = PASS
```

Những sentinels khói này là một **hồi quy end-to-end nhỏ gọn, xác định gate**, không phải là benchmark chất lượng cho toàn bộ kho văn bản 20K. Họ xác minh rằng đường dẫn `query → embedding → Qdrant → search policy → API response` được chấp nhận tiếp tục tạo ra hành vi tích cực và tiêu cực đã biết sau runtime, snapshot hoặc các thay đổi triển khai. Chất lượng truy xuất rộng hơn được đánh giá riêng biệt bởi bộ benchmark đã cam kết trong [benchmarks/README.md](benchmarks/README.md).

Bộ chẩn đoán kiểu quan hệ hẹp hơn cho thấy các giới hạn xếp hạng model/snapshot đã biết. Đặc biệt, query dạng thủ đô nghiêm ngặt của Thái Lan có thể tạo ra mối quan hệ gần như hòa giữa thành phố Bangkok và quốc gia Thái Lan và mối quan hệ giữa Fuji/Nhật Bản queries vẫn chỉ mang tính chẩn đoán. Những trường hợp này được ghi lại dưới dạng hạn chế thay vì ẩn hoặc khái quát hóa thành kết quả vượt qua canonical.

Chi tiết đầy đủ: [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md).

## Bản đồ Repository

```text
src/                Node.js API, search, Qdrant, seed and dataset logic
embedding-service/  Python FastAPI Qwen3-Embedding-4B embedding runtime
data/               fixtures, source catalogs and data provenance
scripts/            build, seed, verification, benchmark and demo tooling
docs/               architecture, operations, release and evidence documentation
tests/              unit, HTTP, architecture and integration tests
```

## Tài liệu

- [Ghi chú Release v1.0.0](docs/releases/v1.0.0.md)
- [Bản demo production](docs/production-demo.md)
- [Profile Kaggle CPU Transformers FP16](docs/qwen3-embedding-kaggle-transformers-fp16.md)
- [Kiến trúc](docs/architecture.md)
- [Tập dữ liệu và seeding](docs/dataset.md)
- [Bản dịch providers](docs/translation.md)
- [Kết nối Qdrant](docs/qdrant-connection.md)
- [Đang kiểm tra](docs/testing.md)
- [Danh mục kỹ thuật](docs/portfolio.md)
- [Nhật ký thay đổi](CHANGELOG.md)

## Tham khảo branch

`runtime/true-fp32` giữ lại triển khai CPU true-FP32 dựng sẵn đã được chứng minh dưới dạng branch kỹ thuật/tham chiếu. Nó không phải là canonical `v1.0.0` di động profile; `main` vẫn là CPU FP16 vì khoảng không gian bộ nhớ Kaggle tốt hơn.

## Những hạn chế đã biết

- demo/runtime di động hướng CPU, không phục vụ GPU có độ trễ thấp.
- Không có người xếp hạng lại.
- Không có truy xuất thưa thớt + dày đặc kết hợp.
- Không có lớp RAG.
- Không có khả năng gieo hạt runtime tự động.
- Chẩn đoán kiểu quan hệ có thể bộc lộ các giới hạn xếp hạng model/snapshot ngay cả khi xác minh ngữ nghĩa canonical vượt qua.

## An ninh và xuất xứ

- Không bao giờ có khóa commit thực API.
- Qdrant và embedding service phải ở chế độ riêng tư/cục bộ trừ khi được bảo mật có chủ ý để sử dụng từ xa.
- Mã ứng dụng tuân theo giấy phép repository.
- Nguồn tập dữ liệu có các yêu cầu ghi công riêng biệt; xem [data/LICENSE-DATA.md](data/LICENSE-DATA.md).

## Bản phát hành

`v1.0.0` là release công khai đầu tiên của dự án này.

Xem GitHub Release và [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) để biết profile, phạm vi bằng chứng và con trỏ sao chép đã được xác thực.
