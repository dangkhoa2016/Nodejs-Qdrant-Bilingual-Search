# Notebook demo Kaggle CPU-FP16 hướng đến production
> 🌐 Language / Ngôn ngữ: [English](kaggle-production-demo-notebook.md) | **Tiếng Việt**

Điểm vào Kaggle tương tác canonical là:

```text
notebooks/kaggle-cpu-fp16-production-demo.ipynb
```

notebook tuân theo quy trình làm việc đầu tiên của kho lưu trữ: nhập nó từ GitHub, sau đó sao chép ô mã đầu tiên hoặc làm mới cứng repository chính thức vào `/kaggle/working`. GitHub vẫn là nguồn gốc của sự thật.

## Bắt đầu nhanh

1. Tạo Kaggle Notebook mới và sử dụng **Tệp → Nhập Notebook → GitHub**.
2. Chọn repository `dangkhoa2016/Nodejs-Qdrant-Bilingual-Search` và notebook `notebooks/kaggle-cpu-fp16-production-demo.ipynb`.
3. Bật **Internet** và đặt **Accelerator=None**.
4. Đính kèm model `dangkhoa2016/qwen-qwen3-embedding-4b`, biến thể `Transformers/default`.
5. Đính kèm tập dữ liệu `dangkhoa2016/qdrant-bilingual-search-canonical-v2-1-20k`.
6. Giữ mặc định an toàn:

``` con trăn
RUN_LIVE_DEMO = Đúng
ENABLE_PUBLIC_TUNNEL = Sai
```

7. Sử dụng **Khởi động lại phiên → Chạy tất cả**.

## Làm sạch repository bootstrap

checkout tại `/kaggle/working/Nodejs-Qdrant-Bilingual-Search` được coi là trạng thái nguồn dùng một lần. Khi nó đã tồn tại, bootstrap thực hiện tìm nạp, `reset --hard origin/main`, sau đó là `git clean -ffd`. Thao tác này sẽ xóa các tệp hoặc thư mục cũ không bị theo dõi do lần thử Kaggle trước đó để lại, bao gồm cả thư mục `snapshots/` cũ, trước khi notebook kiểm tra xem Git có sạch không.

Dữ liệu liên tục/runtime được cố tình giữ bên ngoài nguồn checkout. Bộ lưu trữ Canonical Qdrant sử dụng `/kaggle/working/qdrant-bilingual-search/qdrant-data`; khôi phục ảnh chụp nhanh tạm thời process sử dụng `/kaggle/working/qdrant-bilingual-search/snapshot-restore-runtime`, bao gồm các thư mục `snapshots/` và `tmp/` rõ ràng. Do đó, Qdrant không thể tạo lại các tệp runtime snapshot bên trong Git checkout trong quy trình khôi phục canonical.

### Chạy lại khôi phục snapshot an toàn

Đường dẫn khôi phục canonical an toàn để chạy lại trong cùng phiên Kaggle. Trước khi chạm vào snapshot, `restore-canonical-qdrant-snapshot.sh` gọi `prepare-canonical-qdrant-restore.sh`, sử dụng lại quyền sở hữu bản demo sản xuất model để chỉ dừng processes được chứng minh là thuộc sở hữu của repository này. Thao tác này sẽ dọn sạch ngăn xếp Node/embedding/Qdrant trước đó mà vẫn có thể giữ port `6333` sau khi chạy notebook một phần hoặc lặp lại.

Ranh giới an toàn vẫn là fail-closed: services bên ngoài hoặc được tái sử dụng không bao giờ bị tiêu diệt bởi quá trình dọn dẹp này. Sau khi dọn dẹp quy trình sở hữu, port `6333` phải trống. Nếu service khác vẫn đang nghe, hãy hủy bỏ khôi phục thay vì sử dụng lại hoặc chấm dứt service đó.

Các điểm đánh dấu trước khi khôi phục dự kiến ​​là:

```text
QDRANT_PORT_6333=CLEAN
QDRANT_PRE_RESTORE_OWNED_CLEANUP=PASS
```

## Lõi bắt buộc demo so với demo công khai tùy chọn

notebook cố tình tách hai lớp xác thực.

### Lõi cục bộ demo - bắt buộc

Phần 1–5 khôi phục và chạy toàn bộ ngăn xếp canonical trên loopback:

```text
Node/Hono API       127.0.0.1:3000
Embedding service   127.0.0.1:8001
Qdrant              127.0.0.1:6333
```

Kaggle profile buộc Node host chuyển sang `127.0.0.1` một cách rõ ràng. Trình thu thập bằng chứng không đóng được nếu Node, Qdrant hoặc embedding service đang nghe trên giao diện ký tự đại diện.

Sự chấp nhận ổn định của địa phương có bảy kiểm tra:

```text
/health
/ready
canonical /api/v1/info
Thailand EN
Tokyo VI
Beijing VI
Casablanca negative
```

Điểm đánh dấu dự kiến:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=7
```

### Demo công khai được xác thực - tùy chọn

Phần 6–7 chỉ chạy khi:

```python
ENABLE_PUBLIC_TUNNEL = True
```

Họ **không bắt buộc phải xác thực Kaggle demo lõi**. Khi được bật, cấu trúc liên kết công khai là:

```text
Internet
  -> Cloudflare Quick Tunnel
  -> 127.0.0.1:8090 authenticated gateway
  -> 127.0.0.1:3000 Node/Hono API
  -> 127.0.0.1:8001 embedding service
  -> 127.0.0.1:6333 Qdrant
```

Sự chấp nhận của công chúng bổ sung thêm một bước kiểm tra `401` chưa được xác thực trước bảy bước kiểm tra cốt lõi tương tự. Do đó, một sự chấp nhận công khai được xác thực hoàn chỉnh có tám bước kiểm tra:

```text
PRODUCTION_DEMO_ACCEPTANCE_PASS=8
```

notebook chỉ báo cáo `AUTHENTICATED_PUBLIC_DEMO=PASS` sau khi Phần 6 và 7 thực sự kết thúc thành công. Nếu chế độ công khai bị tắt hoặc bị bỏ qua, nó sẽ báo cáo `AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` thay vì PASS sai.

Quick Tunnel là demo endpoint tạm thời, không phải dịch vụ lưu trữ 24/7 được hỗ trợ SLA.

## Hợp đồng runtime và snapshot đông lạnh

```text
model                  = Qwen/Qwen3-Embedding-4B
backend                = transformers
runtime                = pytorch-cpu
device                 = cpu
internal dtype         = float16
batch size             = 1
dimension              = 2560
public vector dtype    = float32
transport              = binary-f32
embedding text         = v2.1

Qdrant                 = 1.18.3
collection             = knowledge_entities_qwen3_4b_text_v21
points                 = 20000
indexed vectors        = 20000
distance               = Cosine
```

Snapshot chuẩn:

```text
knowledge_entities_qwen3_4b_text_v21-20260827T013824Z.snapshot
bytes  = 283812352
sha256 = 71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f
```

notebook xác minh danh tính snapshot và khôi phục nó mà không cần gieo hạt lại.

## Vệ sinh bằng chứng và xuất bản

Mục 8 kêu gọi:

```text
scripts/kaggle/collect-production-demo-notebook-evidence.sh
```

Nó tạo ra:

```text
nodejs-qdrant-v1.0.0-production-demo-evidence-<UTC>.zip
nodejs-qdrant-v1.0.0-production-demo-evidence-<UTC>.zip.sha256
```

Các biện pháp bảo vệ xuất bản bao gồm:

- Cây làm việc Git phải sạch sẽ; `.runtime/` bị bỏ qua ở trạng thái phù du.
- Qdrant tạm thời khôi phục snapshots và các tệp tạm thời nằm ngoài nguồn checkout.
- Bằng chứng Process bỏ qua các đối số dòng lệnh đầy đủ để thông tin xác thực phiên Kaggle/Jupyter không thể bị rò rỉ qua đầu ra `ps`.
- Kiểm tra trình nghe Qdrant, embedding và Node không thành công khi hiển thị ký tự đại diện.
- Các giá trị mã thông báo mang và các tệp có tên mã thông báo bị từ chối khỏi bằng chứng.
- `SHA256SUMS` nội bộ sử dụng các đường dẫn tương đối, loại trừ chính nó và được xác minh lại sau khi trích xuất ZIP độc lập.
- `.zip.sha256` bên ngoài chỉ chứa tên cơ sở ZIP và có thể di chuyển được với `sha256sum -c` sau khi tải xuống.
- Các điểm đánh dấu PASS công khai yêu cầu nhật ký chấp nhận công khai thực sự với `401` và `PRODUCTION_DEMO_ACCEPTANCE_PASS=8` chưa được xác thực.
- `system/environment.txt` phân biệt `SYSTEM_NODE_VERSION` (shell PATH được bộ sưu tập sử dụng) với `DEMO_NODE_VERSION` (Node API đang chạy thực tế runtime được báo cáo bởi `/api/v1/info`).
- notebook theo dõi `evidence_completed=False` cho đến khi Phần 8 tạo thành công ZIP và sidecar dự kiến. Phần 9 phát ra `EVIDENCE_COLLECTION=FAIL` và `PRODUCTION_ORIENTED_DEMO_NOTEBOOK=INCOMPLETE` thay vì PASS tổng thể nếu việc đóng gói bằng chứng không hoàn thành.

Các điểm đánh dấu cuối cùng thành công dự kiến ​​chỉ dành cho địa phương bao gồm:

```text
CORE_LOCAL_DEMO=PASS
EVIDENCE_COLLECTION=PASS
AUTHENTICATED_PUBLIC_DEMO=NOT_RUN
PRODUCTION_ORIENTED_DEMO_NOTEBOOK=PASS
```

## Trạng thái xác thực

GitHub CI xác thực cấu trúc notebook, đánh dấu hướng dẫn song ngữ, hành vi khởi động sạch, dọn dẹp Qdrant sở hữu an toàn với hành vi fail-closed dịch vụ bên ngoài, vệ sinh đường dẫn chụp nhanh Qdrant runtime, tính trung thực trạng thái bằng chứng cuối cùng, hợp đồng cấu trúc liên kết localhost/công khai, vệ sinh xuất bản, cú pháp trợ giúp, kiểm tra Node, Python Kiểm tra embedding và tích hợp Qdrant. Kaggle mới **Phiên khởi động lại → Chạy tất cả** trên HEAD `main` cuối cùng vẫn là gate trực tiếp có thẩm quyền trước khi nhắm mục tiêu lại `v1.0.0` hoặc ghi đè nội dung/ghi chú release công khai.
