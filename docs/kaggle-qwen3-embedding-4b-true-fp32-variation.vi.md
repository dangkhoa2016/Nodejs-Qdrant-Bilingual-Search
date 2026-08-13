# Biến thể Kaggle CPU true-FP32 — Qwen3-Embedding-4B
> 🌐 Language / Ngôn ngữ: [English](kaggle-qwen3-embedding-4b-true-fp32-variation.md) | **Tiếng Việt**

Tiện ích bổ sung này dành cho `nodejs-qdrant-bilingual-search` sau khi tái sử dụng hợp đồng thời gian chạy hardening baseline.

## Nguồn mục tiêu baseline

```text
branch: feat/runtime-contract-reuse-hardening
HEAD:   a2919438c848ef56156d0efe7cbc786a3a36dba1
```

Nó **không** thay đổi hợp đồng tìm kiếm ngữ nghĩa canonical. Đặc biệt nó không thay đổi:

```text
model identity            Qwen/Qwen3-Embedding-4B
vector dimension          2560
embedding profile         qwen3
query strategy            prompt
document strategy         raw
query instruction ID      geo-retrieval-v1:d014d3ec6df87e49
embedding text version    v2.1
canonical collection      knowledge_entities_qwen3_4b_text_v21
score threshold           0.55
```

## Những thay đổi gì

Hai người trợ giúp Kaggle được thêm vào:

```text
scripts/kaggle/resolve-qwen3-fp32-input.mjs
scripts/kaggle/run-qwen3-fp32-cpu.sh
```

Hợp đồng `EMBEDDING_MODEL_PATH` hiện có được sử dụng lại. Danh tính canonical model vẫn là `Qwen/Qwen3-Embedding-4B`; chỉ có mục tiêu tải hệ thống tập tin thay đổi.

Người giải quyết thích:

```text
/kaggle/input/qwen-qwen3-embedding-4b/pytorch/fp32/1
```

và cũng hỗ trợ bố cục Kaggle cũ hơn:

```text
/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/pytorch/fp32/1
```

Nếu Kaggle chọn tiền tố gắn kết khác, trình phân giải sẽ tìm kiếm `/kaggle/input` để tìm `qwen-qwen3-embedding-4b/.../pytorch/fp32/...` artifact hợp lệ về mặt cấu trúc duy nhất.

Nó xác nhận gốc model mà không đọc tất cả byte trọng số:

- `config.json` tồn tại;
- `modules.json` tồn tại;
- `model.safetensors.index.json` tồn tại và có `weight_map` không trống;
- mọi phân đoạn được chỉ mục tham chiếu đều tồn tại và có thể đọc được.

embedding service hiện tại vẫn chịu trách nhiệm kiểm tra sự thật runtime mạnh mẽ hơn sau khi tải: các tham số Qwen được tải phải khớp với `float32` được yêu cầu và vòng đời production phải xem runtime contract đã được xác minh.

## Thiết lập Kaggle

Đính kèm biến thể model vào Notebook thông qua **Thêm đầu vào → Models** và chọn biến thể `Qwen/Qwen3-Embedding-4B` PyTorch `fp32`.

`/kaggle/input` là read-only. Không sao chép hoặc sửa đổi model ở đó.

Kiểm tra chỉ dành cho trình giải quyết tùy chọn:

```bash
node scripts/kaggle/resolve-qwen3-fp32-input.mjs
```

Hình dạng dự kiến:

```json
{
  "model": "Qwen/Qwen3-Embedding-4B",
  "variation": "pytorch/fp32",
  "version": 1,
  "model_path": "/kaggle/input/.../pytorch/fp32/1",
  "source": "preferred",
  "shard_count": 8,
  "indexed_tensor_keys": 398
}
```

`model_path` chính xác có thể khác nếu Kaggle thay đổi tiền tố gắn kết. Trình phân giải có chủ ý không yêu cầu một tiền tố duy nhất.

## Chạy vòng đời production với biến thể FP32

Sử dụng trình bao bọc chuyên dụng thay vì nối thủ công biến thể mặc định cũ:

```bash
bash scripts/kaggle/run-qwen3-fp32-cpu.sh
```

Đối với các lệnh phụ vòng đời:

```bash
bash scripts/kaggle/run-qwen3-fp32-cpu.sh status
bash scripts/kaggle/run-qwen3-fp32-cpu.sh stop
bash scripts/kaggle/run-qwen3-fp32-cpu.sh restart
```

Trình bao bọc xuất khẩu:

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_MODEL_PATH=<resolved PyTorch/fp32 path>
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cpu
EMBEDDING_DTYPE=float32
EMBEDDING_BATCH_SIZE=1
EMBEDDING_MAX_SEQ_LENGTH=512
EMBEDDING_TRANSPORT=binary-f32
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

Nó không đóng được nếu model/profile/dimension/device/dtype/transport xung đột đã được xuất.

Nếu một phiên cũ có nội dung như:

```bash
export EMBEDDING_MODEL_PATH=/kaggle/input/.../transformers/default/1
```

người giải quyết từ chối nó. Bỏ đặt giá trị cũ và chạy lại:

```bash
unset EMBEDDING_MODEL_PATH
bash scripts/kaggle/run-qwen3-fp32-cpu.sh
```

## Kiểm tra hợp đồng chạy thử

Không có service nào được khởi động:

```bash
QWEN3_FP32_DRY_RUN=1 \
  bash scripts/kaggle/run-qwen3-fp32-cpu.sh
```

## Chấp nhận Runtime

Sau khi khởi động, vòng đời fail-closed hiện tại dự kiến ​​sẽ chỉ chấp nhận model endpoint tương đương với:

```json
{
  "model": "Qwen/Qwen3-Embedding-4B",
  "dimension": 2560,
  "profile": "qwen3",
  "device": "cpu",
  "accelerator": "cpu",
  "dtype": "float32",
  "runtime": "pytorch-cpu",
  "runtime_contract": "embedding-runtime-dtype-verified-v1"
}
```

Kiểm tra trực tiếp nếu cần:

```bash
curl -fsS http://127.0.0.1:8001/model | jq .
```

Không chấp nhận BF16/FP16 trong khi xác nhận quyền sở hữu FP32 và không làm suy yếu quá trình kiểm tra hợp đồng thời gian chạy để vượt qua quá trình khởi động.

## Chỉ số Qdrant hiện có

Thay đổi này chỉ là **thay đổi model artifact trong thời gian chạy truy vấn**. Nó không yêu cầu gieo hạt lại canonical 20K collection chỉ vì thiết bị/dtype inference khác với nguồn gốc thực thi GPU/FP16 seed lịch sử. Giữ lại trình xác minh khả năng tương thích ngữ nghĩa hiện có và hành vi kiểm tra xuất xứ đầy đủ từ nguồn baseline.

## Kiểm tra tập trung

```bash
node --test tests/unit/kaggle-qwen3-fp32-input.test.js
```

Bộ thử nghiệm bao gồm các bố cục gắn kết Kaggle ưu tiên và cũ, khám phá dự phòng, xác thực đường dẫn rõ ràng, từ chối phân đoạn bị thiếu, từ chối khám phá không rõ ràng, từ chối đường dẫn không phải FP32 cũ và hợp đồng trình bao bọc CPU/FP32.
