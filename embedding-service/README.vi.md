# Dịch vụ embedding cục bộ
> 🌐 Language / Ngôn ngữ: [English](README.md) | **Tiếng Việt**

Đây là thành phần Python ML duy nhất. Ứng dụng công cộng server vẫn là Hono/Node.js; Python được phân lập thành embedding inference.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

## Hồ sơ được hỗ trợ

### Baseline E5

Hành vi mặc định vẫn tương thích ngược với baseline được chấp nhận:

```text
EMBEDDING_MODEL=intfloat/multilingual-e5-small
EMBEDDING_PROFILE=auto
EMBEDDING_DIMENSION=384
```

Queries sử dụng `query:` và các tài liệu sử dụng `passage:`.

### Candidate Qwen3

```text
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-4B
EMBEDDING_PROFILE=qwen3
EMBEDDING_DIMENSION=2560
EMBEDDING_DEVICE=cuda
EMBEDDING_DTYPE=float16
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_SEQ_LENGTH=512
```

Qwen queries sử dụng hướng dẫn truy xuất tiếng Anh theo phiên bản, trong khi tài liệu được nhúng dưới dạng các đoạn ngữ nghĩa thô. service sử dụng phần đệm mã thông báo bên trái theo khuyến nghị của tích hợp Qwen3 model.

`EMBEDDING_MODEL` là danh tính ngữ nghĩa canonical được báo cáo bởi `/model`, `/health` và xuất xứ. `EMBEDDING_MODEL_PATH` tùy chọn trỏ vào mục tiêu tải hệ thống tệp cục bộ/model (ví dụ: Trích xuất đầu vào read-only Kaggle) và chỉ kiểm soát vị trí tải trọng số. Khi `EMBEDDING_MODEL_PATH` vắng mặt/trống, tải sẽ quay trở lại `EMBEDDING_MODEL`:

```bash
export EMBEDDING_MODEL='Qwen/Qwen3-Embedding-4B'
export EMBEDDING_MODEL_PATH='/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/transformers/default/1'
```

Dtype Qwen model đã tải được xác minh dựa trên dtype runtime được yêu cầu ngay sau khi tải; service không đóng được do không khớp và không bao giờ âm thầm thay thế BF16 trong khi báo cáo FP32.

`/model` có đủ nguồn gốc xuất xứ để phân biệt thế hệ Qwen CUDA/FP16 với thế hệ E5 baseline cũ. Xem `docs/qwen3-embedding-colab.md` để biết quy trình làm việc Colab T4 + Cloudflare Quick Tunnel.

## Thống kê và nhật ký Runtime

`GET /stats` hiển thị công việc embedding thành công tích lũy mà không cần tải vectors vào response:

```bash
curl -fsS http://127.0.0.1:8001/stats | jq .requests
```

Nó báo cáo số lượng query/tài liệu request, tổng số tài liệu được nhúng, kích thước batch của tài liệu cuối cùng, thời gian inference tích lũy và thời gian hoạt động của service. requests thành công cũng được ghi lại thông qua bộ ghi được cấu hình của Uvicorn, ví dụ:

```text
embedding_documents_completed batch=8 requests=125 documents=1000 inference_ms=...
```

Các bộ đếm này mang tính quy trình cục bộ và được đặt lại khi embedding service khởi động lại. Họ đo lường công việc inference đã hoàn thành; Qdrant `points_count` vẫn là số điểm duy nhất đã cam kết có thẩm quyền.

## Hợp đồng transport cho tài liệu

JSON endpoint kế thừa vẫn có sẵn:

```text
POST /embed/documents
Content-Type: application/json
```

Đối với lưu lượng truy cập Qwen seed/nhập khẩu chiều cao, service cũng hiển thị Float32 endpoint thô:

```text
POST /embed/documents/binary
Accept: application/x-float32
Content-Type: application/x-float32
```

Phần thân nhị phân liền kề **Float32 nhỏ**, hàng chính, có hình dạng `[count, dimension]`. Các tiêu đề Response mang khung và hợp đồng thời gian server:

```text
X-Embedding-Count
X-Embedding-Dimension
X-Embedding-Dtype: float32
X-Embedding-Inference-Ms
```

`GET /model` quảng cáo các khả năng mà không thay đổi nguồn gốc ngữ nghĩa:

```json
{
  "transports": {
    "json": true,
    "float32_binary": true
  }
}
```

Node client mặc định là `EMBEDDING_TRANSPORT=json` để tương thích ngược. Đặt `EMBEDDING_TRANSPORT=binary-f32` cho Qwen seed/nhập. Chế độ nhị phân không đóng được nếu `/model` không quảng cáo `float32_binary=true`; không có dự phòng im lặng và không có mã hóa Base64.
