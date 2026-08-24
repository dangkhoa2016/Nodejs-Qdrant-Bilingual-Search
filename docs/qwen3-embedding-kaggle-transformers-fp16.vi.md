# Biến thể Kaggle CPU Transformers FP16 — Qwen3-Embedding-4B
> 🌐 Language / Ngôn ngữ: [English](qwen3-embedding-kaggle-transformers-fp16.md) | **Tiếng Việt**

Tiện ích bổ sung này dành cho `nodejs-qdrant-bilingual-search`. Nó ports bản gốc v0.2 đã được chứng minh
Transformers/PyTorch **CPU FP16** embedding runtime để repository có thể phục vụ
Chỉ mục canonical 20K Qwen3 sử dụng `transformers` (`AutoModel`/`AutoTokenizer` gốc)
backend trên Kaggle CPU, thay vì trình thực thi GPU SentenceTransformers lịch sử.

## Nguồn mục tiêu baseline

```text
branch:  feat/qwen3-transformers-fp16-kaggle-input
HEAD:    743800828c89db582cae90fc275bec19fb9b00e3 (start)
```

Nó giữ nguyên hợp đồng tìm kiếm ngữ nghĩa canonical chính xác:

```text
model identity            Qwen/Qwen3-Embedding-4B
vector dimension          2560
embedding profile         qwen3
query strategy            prompt
document strategy         raw
query instruction ID      geo-retrieval-v1:d014d3ec6df87e49
prompt                    "Instruct: Retrieve the geographic entity that best answers the query\nQuery:"
embedding text version    v2.1
canonical collection      knowledge_entities_qwen3_4b_text_v21
score threshold           0.55
public vector dtype       float32 (L2-normalized, finite)
```

## Những thay đổi gì

Người trợ giúp Kaggle được thêm / cập nhật:

```text
scripts/kaggle/ensure-node22.sh
scripts/kaggle/resolve-qwen3-transformers-input.mjs
scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
scripts/kaggle/package-review-evidence.sh
```

Bộ điều hợp Transformers gốc thay thế đường dẫn số SentenceTransformers trong
dịch vụ embedding:

```text
embedding-service/transformers_engine.py   AutoTokenizer + AutoModel adapter
embedding-service/pooling.py               last-token pooling -> Float32 -> L2 normalize
```

Đường dẫn số là v0.2 runtime đã được chứng minh:

```text
tokenize -> forward (FP16, use_cache off, CPU) -> last-token pooling
  -> cast to Float32 -> L2 normalize in Float32 -> Float32[2560]
```

Không có sự thay thế BF16 hoặc FP32 nào được thực hiện âm thầm. Loại tham số model được tải là
được xác minh dựa trên `float16` được yêu cầu ngay sau khi tải và service không thành công
đóng cửa do không khớp.

## Nguồn Model: Đầu vào Kaggle (read-only)

model đến từ Đầu vào Kaggle, **không** từ Hugging Face và **không** là bản sao hoạt động:

```text
/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/transformers/default/1
```

`/kaggle/input` là read-only. Không tải xuống từ HF và không có bản sao trọng số của cây làm việc
được thực hiện. Trình phân giải xác thực gốc model mà không cần đọc từng byte trọng số.

service báo cáo siêu dữ liệu trung thực:

```text
backend=transformers
implementation=python-fastapi
runtime=pytorch-cpu
device=cpu
dtype=float16
dimension=2560
profile=qwen3
```

## Lệnh điều hành

Bắt đầu embedding service (và, thông qua vòng đời repository, demo đầy đủ) với
trình bao bọc chuyên dụng:

```bash
bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

Hợp đồng repository là Node.js 22+. Trước khi trình phân giải JavaScript được gọi,
nguồn trình bao bọc `scripts/kaggle/ensure-node22.sh`. Node tương thích đã có trên `PATH` là
tái sử dụng. Mặt khác, Node 22 di động được lưu trong bộ nhớ đệm trong `/kaggle/working` sẽ được sử dụng lại; nếu không
tồn tại, người trợ giúp tải xuống kho lưu trữ Node 22 chính thức được ghim, xác minh nó dựa trên
`SHASUMS256.txt` chính thức và thêm thư mục `bin` của nó vào `PATH`. Hiện tại được ghim
mặc định là `22.23.2`; chỉ đặt `KAGGLE_NODE_VERSION` một cách rõ ràng khi có chủ ý
nâng cấp toán tử này profile. Bản thân model vẫn hoàn toàn ngoại tuyến/read-only trong
`/kaggle/input`.

Trình bao bọc xuất hợp đồng fail-closed:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cpu
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=1
EMBEDDING_MAX_SEQ_LENGTH=512
EMBEDDING_TRANSPORT=binary-f32
MAX_CONCURRENT_INFERENCE=1
UVICORN_WORKERS=1
WARMUP_ON_STARTUP=true
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

Nó không đóng được nếu đã có xung đột model/profile/dimension/device/dtype/transport
đã xuất khẩu. Kiểm tra hợp đồng chạy thử không khởi động service:

```bash
QWEN3_TRANSFORMERS_DRY_RUN=1 bash scripts/kaggle/run-qwen3-transformers-fp16-cpu.sh
```

## Tái sử dụng chỉ mục Canonical Qdrant

Đây là **chỉ thay đổi model artifact trong thời gian chạy truy vấn**. Nó **không** reseed
canonical 20K collection. Quá trình thực thi GPU/FP16 SentenceTransformers lịch sử
xuất xứ được đưa vào snapshot payload (`backend=sentence-transformers`,
`gpu`/`cuda`/`pytorch-cuda`) khác với trình thực thi `transformers` CPU trực tiếp. Bởi vì
`model`, `dimension`, `profile`, query/chiến lược tài liệu, ID lệnh và văn bản
tất cả đều khớp, trình xác minh chỉ mục ngữ nghĩa của repository coi hai thời gian chạy là
tương thích về mặt ngữ nghĩa trong khi tiếp tục thực thi danh tính ngữ nghĩa một cách nghiêm ngặt.

## Chấp nhận Runtime

Sau khi khởi động, `/model` phải báo cáo `backend=transformers`, `dtype=float16`,
`device=cpu`, `dimension=2560`. Đối với một tài liệu nhị phân vector, transport trả về
`1 x 2560 x 4 = 10240` byte cuối nhỏ Float32 giải mã thành hữu hạn, chuẩn hóa L2
vector.

Các thử nghiệm chấp nhận mô hình thực tế chọn tham gia tồn tại và bị bỏ qua trừ khi bị kiểm soát:

```bash
cd embedding-service
RUN_REAL_MODEL_TESTS=1 python -m pytest -q tests/real_model
```

## Giới hạn chẩn đoán đã biết (Fuji/Nhật Bản và VI trên toàn quốc)

Trình xác minh ngữ nghĩa Canonical 20K = `20000 / 20000 PASS`. Khả năng tương thích ổn định/canonical
Bộ sentinel giữ: Thái Lan EN, Tokyo VI và Bắc Kinh VI đều giữ vị trí số 1. Riêng biệt, chặt chẽ hơn
bộ chẩn đoán kiểu quan hệ hẹp hơn: người Việt “đất nước có thủ đô/nổi tiếng vì X”
query dạng viết hoa không trả lại quốc gia ở vị trí số 1 - model bị đóng băng đạt điểm số
thành phố cùng tên cao hơn một chút so với quốc gia mẹ (thành phố Bangkok ≈ 0,660 trên đất nước Thái Lan
≈ 0,659 đối với dạng viết hoa VI), do đó `entity_type=country` gate nghiêm ngặt từ chối thành phố và
quốc gia mong đợi không được trả về ở vị trí số 1 cho biểu mẫu query đó. Điều tương tự cũng đúng đối với
EN/VI mối quan hệ "đất nước nổi tiếng với núi Phú Sĩ" (thành phố Fuji phía trên Nhật Bản). Trên FP32 thực sự cũng vậy
Thứ tự xếp hạng thành phố trên toàn quốc được sao chép trên cùng một snapshot với một chút khác biệt
điểm, vì vậy đây là bằng chứng cho thấy kết quả không dành riêng cho FP16, không phải bằng chứng về
các đầu ra kiểu chéo giống hệt byte chứ không phải float16 artifact. Fuji/Nhật Bản và những thứ này
mối quan hệ giữa thành phố và quốc gia queries vẫn chỉ mang tính chẩn đoán và không phải là gate giai đoạn.

## Kiểm tra tập trung

```bash
node --test tests/unit/kaggle-qwen3-transformers-input.test.js
node --test tests/unit/runtime-provenance.test.js tests/unit/qdrant-service.test.js
```

Bộ phần mềm này bao gồm trình phân giải Kaggle, hợp đồng trình bao bọc CPU/FP16, mô hình thực chọn tham gia
sự chấp nhận và trình phân loại ngữ nghĩa-nhận dạng-so với thực thi-xuất xứ.


## Quy tắc đóng gói bằng chứng

Release/bằng chứng chấp nhận không được tự băm. Chỉ xây dựng kho lưu trữ bằng chứng sau khi
tất cả các tập tin đánh giá là cuối cùng:

```bash
bash scripts/kaggle/package-review-evidence.sh \
  "$RUN_ROOT/review" \
  "/kaggle/working/${RUN_ID}-qwen3-transformers-fp16-node-acceptance.zip"
```

Người trợ giúp cố tình loại trừ `SHA256SUMS.txt` khỏi bảng kê khai của chính nó, xác minh
bảng kê khai trước khi đóng gói, giải nén lại ZIP, xác minh lại bảng kê khai, chạy
`unzip -t` và ghi ZIP `.sha256` bên ngoài. Đừng đưa SHA-256 vào bằng chứng
ZIP bên trong `review/result.json`: điều đó sẽ tạo ra một vòng tự tham chiếu vì
việc thay đổi `result.json` sẽ thay đổi bản tóm tắt ZIP. Thông báo lưu trữ có thẩm quyền là
tập tin `<archive>.sha256` bên ngoài.
