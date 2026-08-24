# Bản demo production
> 🌐 Language / Ngôn ngữ: [English](production-demo.md) | **Tiếng Việt**

production-oriented Kaggle demo giữ nguyên tìm kiếm đã xác minh profile trong khi làm cho bằng chứng xuất bản và cấu trúc liên kết runtime trở nên rõ ràng.

## Profile chuẩn

Kaggle runtime được chấp nhận là `Qwen/Qwen3-Embedding-4B`, Transformers/PyTorch, CPU, FP16, batch kích thước 1, 2560 kích thước, `binary-f32`, embedding văn bản `v2.1`, collection `knowledge_entities_qwen3_4b_text_v21`, ngưỡng `0.55`, với canonical 20.000 điểm Qdrant snapshot hiện có. demo khôi phục snapshot và không bao giờ tự động khởi động lại.

## Notebook Kaggle chuẩn

Sử dụng:

```text
notebooks/kaggle-cpu-fp16-production-demo.ipynb
```

Nhập nó từ GitHub vào Kaggle Notebook mới, bật Internet, sử dụng `Accelerator=None`, đính kèm Bộ dữ liệu canonical model và snapshot, sau đó chạy **Khởi động lại phiên → Chạy tất cả**.

Các mặc định an toàn là:

```python
RUN_LIVE_DEMO = True
ENABLE_PUBLIC_TUNNEL = False
```

Do đó, notebook xác thực ngăn xếp lõi cục bộ theo mặc định. Phần 6–7 là lớp công khai được xác thực tùy chọn.

## Cấu trúc liên kết cục bộ cốt lõi

```text
Node/Hono API       127.0.0.1:3000
Embedding service   127.0.0.1:8001
Qdrant              127.0.0.1:6333
```

Trình bao bọc Kaggle CPU-FP16 buộc `HOST=127.0.0.1` và Node server chuyển tên máy chủ đó cho `@hono/node-server`. Bằng chứng người nghe gate không đóng được nếu Node, embedding service hoặc Qdrant bị liên kết với một địa chỉ ký tự đại diện.

Quá trình chấp nhận triển khai cục bộ thực hiện bảy lần kiểm tra và kết thúc bằng:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=7
```

## Cấu trúc liên kết công cộng được xác thực tùy chọn

Để kiểm tra quyền truy cập công cộng tạm thời, hãy đặt rõ ràng:

```python
ENABLE_PUBLIC_TUNNEL = True
```

Con đường công cộng là:

```text
Internet
  -> Cloudflare Quick Tunnel
  -> 127.0.0.1:8090 Bearer-auth gateway
  -> 127.0.0.1:3000 Node API
  -> 127.0.0.1:8001 embedding service
  -> 127.0.0.1:6333 Qdrant
```

Cổng bổ sung xác thực, danh sách cho phép tuyến đường an toàn, giới hạn tốc độ, giới hạn nội dung, ID request, timeout ngược dòng và đồng thời tìm kiếm công khai 1. Bearer token là phiên cục bộ và giá trị của nó không bao giờ được công bố.

Sự chấp nhận công khai đã được xác thực trước tiên chứng minh `/health` request chưa được xác thực trả về HTTP `401`, sau đó chạy bảy bước kiểm tra cốt lõi tương tự. Do đó, một cuộc chạy công khai hoàn chỉnh sẽ kết thúc bằng:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=8
```

PASS công khai không chỉ được suy ra từ `ENABLE_PUBLIC_TUNNEL=True`. Nó chỉ được ghi lại sau khi ô chấp nhận công khai thực sự hoàn thành. Mặt khác, notebook báo cáo `AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` hoặc `AUTHENTICATED_PUBLIC_DEMO=INCOMPLETE`.

Quick Tunnel là demo endpoint tạm thời, không phải dịch vụ lưu trữ 24/7 được hỗ trợ SLA.

## Các trường hợp chấp nhận ổn định

gates cứng là:

```text
Thailand EN = PASS target
Tokyo VI    = PASS target
Beijing VI  = PASS target
Casablanca geographic false-positive = absent
```

Fuji/Nhật Bản và trường hợp quan hệ hình thức vốn Thái Lan-VI vẫn chỉ mang tính chất chẩn đoán.

Sự chấp nhận của địa phương:

```bash
node scripts/kaggle/production-demo-acceptance.mjs
```

Sự chấp nhận của công chúng:

```bash
API_URL="$(cat .runtime/production-demo-public/public.url)" \
DEMO_BEARER_TOKEN_FILE=.runtime/production-demo-public/demo-token \
node scripts/kaggle/production-demo-acceptance.mjs
```

## Bằng chứng và công bố gate

notebook đóng gói bằng chứng với:

```bash
bash scripts/kaggle/collect-production-demo-notebook-evidence.sh
```

Nhà sưu tập hiện thực thi các hợp đồng xuất bản sau:

- Git working tree phải sạch; `.runtime/` bị bỏ qua ở trạng thái phù du;
- Siêu dữ liệu process loại trừ các đối số dòng lệnh đầy đủ nên thông tin xác thực phiên Kaggle/Jupyter không thể vào kho lưu trữ;
- Qdrant ports `6333/6334`, embedding port `8001` và Node port `3000` không được nghe trên giao diện ký tự đại diện;
- các giá trị mã thông báo mang chính xác và các tệp có tên mã thông báo bị từ chối;
- PASS công khai yêu cầu nhật ký chấp nhận công khai thực sự chứa `401` và `PRODUCTION_DEMO_ACCEPTANCE_PASS=8` chưa được xác thực;
- `SHA256SUMS` nội bộ sử dụng các đường dẫn tương đối, loại trừ chính nó và vượt qua xác minh trích xuất lại độc lập;
- `.zip.sha256` bên ngoài chỉ lưu trữ tên cơ sở ZIP, giúp `sha256sum -c` có thể di động sau khi tải xuống.

Bằng chứng chỉ có ở địa phương ghi lại rõ ràng:

```text
AUTHENTICATED_PUBLIC_DEMO=NOT_RUN
```

Một hồ sơ chạy công cộng hoàn chỉnh:

```text
AUTH_GATEWAY=PASS
UNAUTHENTICATED_REQUEST=401
PUBLIC_TUNNEL_TARGET=http://127.0.0.1:8090
PUBLIC_TUNNEL=PASS
AUTHENTICATED_PUBLIC_DEMO=PASS
```

Một Kaggle mới **Phiên khởi động lại → Chạy tất cả** trên HEAD `main` cuối cùng, sau đó là đánh giá bằng chứng độc lập, vẫn cần thiết trước khi nhắm mục tiêu lại `v1.0.0` hoặc ghi đè ghi chú/tài sản release công khai.

## Ghi chú vòng đời lịch sử

Vòng đời chung vẫn hỗ trợ `DEMO_PUBLIC=1` cho Quick Tunnel chưa được xác thực trực tiếp tới Node API để tương thích/phát triển ngược. Đó **không phải** là đường dẫn canonical công khai Kaggle. canonical notebook luôn khởi động lõi bằng `DEMO_PUBLIC=0` và sau đó khi được yêu cầu sẽ thêm cổng xác thực riêng biệt.
