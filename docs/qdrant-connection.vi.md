# Lớp kết nối Qdrant cho production
> 🌐 Language / Ngôn ngữ: [English](qdrant-connection.md) | **Tiếng Việt**

Ứng dụng coi Qdrant là một phần phụ thuộc logic ngay cả khi triển khai vật lý là cục bộ, Beam.cloud hoặc Modal.com.

## Ranh giới

```text
QDRANT_PROVIDER + provider-specific env
                │
                ▼
       configuration resolver
                │ one immutable profile
                ▼
       QdrantConnection factory
                │
        raw QdrantClient (private)
                │ retry / timeout / probe
                ▼
          QdrantService
                │
       search / entity / seed
```

Chỉ có cơ sở hạ tầng cấu hình và kết nối mới biết tên provider. `QdrantService`, tìm kiếm, thực thể, các tuyến Hono và logic nghiệp vụ seed không bao giờ branch trên Beam hoặc Modal.

`tests/unit/qdrant-boundary.test.js` thực thi quy tắc kiến ​​trúc này.

## Lựa chọn Provider

```bash
# Local
QDRANT_PROVIDER=local
QDRANT_LOCAL_URL=http://127.0.0.1:6333

# Beam
QDRANT_PROVIDER=beam
QDRANT_BEAM_URL=https://YOUR-BEAM-QDRANT-ENDPOINT
QDRANT_BEAM_API_KEY=...

# Modal
QDRANT_PROVIDER=modal
QDRANT_MODAL_URL=https://YOUR-MODAL-QDRANT-ENDPOINT
QDRANT_MODAL_API_KEY=...
```

Chính xác một profile được giải quyết khi process khởi động. Lớp kết nối không chứa danh sách endpoints dự phòng, do đó retry không thể âm thầm di chuyển dữ liệu hoặc queries sang triển khai khác.

`QDRANT_URL` / `QDRANT_API_KEY` chung vẫn giữ nguyên khả năng tương thích dự phòng cho profile đã chọn; các biến dành riêng cho nhà cung cấp được ưu tiên.

## Tại sao không có chuyển đổi dự phòng Beam ↔ Modal tự động

Các hoạt động triển khai này là các phiên bản Qdrant một Node độc lập. Chuyển đổi lưu lượng truy cập tự động sẽ chỉ chính xác sau khi chứng minh hợp đồng sao chép/phiên bản dữ liệu được chia sẻ. Do đó, Retry có nghĩa là **retry provider đã chọn**, không bao giờ chọn provider khác.

## Phân loại Retry

Thất bại thoáng qua:

```text
HTTP 408, 425, 429, 500, 502, 503, 504
ECONNRESET / ECONNREFUSED / ETIMEDOUT / EAI_AGAIN / ENOTFOUND / EPIPE
Undici connect/header/body/socket timeout failures
fetch/network/socket failures
```

Lỗi xác thực/cấu hình:

```text
HTTP 401 / 403 → do not retry
other non-transient 4xx → do not retry
```

Điều này quan trọng đối với vòng đời Modal đã được thử nghiệm, trong đó request bên ngoài trước tiên có thể nhìn thấy provider/bộ định tuyến `503` trong quá trình khởi động nguội và sau đó đạt đến Qdrant đã được xác thực. Việc lặp lại khóa API không tốt sẽ không cải thiện tính khả dụng, vì vậy 401/403 sẽ dừng ngay lập tức.

Backoff được giới hạn theo cấp số nhân với jitter:

```text
min(maxDelay, baseDelay * 2^(attempt - 1)) ± jitter
```

Runtime requests và `waitUntilReady()` sử dụng quỹ nỗ lực riêng biệt. Mặc định:

```text
request: 3 attempts, 250ms base, 2000ms max
startup/CLI: 8 attempts, 500ms base, 5000ms max
SDK request timeout: 10000ms
jitter: 20%
```

## Readiness

`GET /health` chỉ kiểm tra xem Node process có hoạt động hay không.

`GET /ready` thực hiện **một** đầu dò Qdrant đã được xác thực và một đầu dò dịch vụ nhúng. Nó không ngủ trong ngân sách retry khởi động, giúp readiness kiểm tra nhanh chóng đối với người điều phối.

Ví dụ trong quá trình khởi động nguội theo phương thức:

```json
{
  "ready": false,
  "qdrant": {
    "ready": false,
    "provider": "modal",
    "status": "unavailable",
    "http_status": 503,
    "transport_code": null,
    "latency_ms": 12.3
  },
  "embedding": {
    "ready": true,
    "status": "ready"
  }
}
```

Đầu dò 401/403 ánh xạ tới `status: "unauthorized"`. Khóa API và thông báo lỗi ngược dòng thô không bao giờ được trả về.

Các luồng CLI phải đợi Qdrant, chẳng hạn như seed, gọi `waitUntilReady()` và sử dụng chính sách khởi động giới hạn dài hơn.

## Ranh giới liên tục được kế thừa từ xác thực Qdrant Native Portable

Lớp kết nối **không** thực hiện sao lưu hoặc khôi phục. Trách nhiệm đó nằm trong quá trình triển khai Qdrant đã chọn.

Việc xác thực provider thiết kế này dựa trên việc thiết lập:

- Phương thức: snapshots bền định kỳ trên Khối lượng phương thức, đã kiểm tra độ bền danh nghĩa RPO `<= 600s`, không đảm bảo tắt máy vào giây cuối cùng snapshot.
- Beam: DB trực tiếp cục bộ cộng với snapshots đầy đủ bền vững trên Beam Volume, khôi phục hợp lệ mới nhất, dự phòng bị hỏng-mới nhất, hành vi fail-closed hoàn toàn bị hỏng.
- Trong quá trình kiểm tra fail-closed bị hỏng hoàn toàn của Beam, các đầu dò bên ngoài vẫn ở mức 503 thay vì hiển thị một cơ sở dữ liệu trống hoàn toàn sai.

Do đó, ứng dụng Node sử dụng readiness và ngữ nghĩa dữ liệu; nó không sắp xếp vòng đời provider snapshot.

## Các hoạt động thử lại an toàn được sử dụng bởi repository này

Tất cả các hoạt động Qdrant hiện được định tuyến qua `execute()` đều có thể thử lại an toàn trong ngữ cảnh ứng dụng này:

- query / truy xuất / thống kê / danh sách collection được đọc;
- upsert sử dụng ID điểm UUIDv5 xác định;
- Việc tạo collection chấp nhận một chủng tộc đã được tạo;
- Việc tạo chỉ mục tải trọng chấp nhận một cuộc đua đã được lập chỉ mục.

Nếu một hoạt động Qdrant không bình thường trong tương lai được đưa vào, thì ngữ nghĩa retry của nó phải được xem xét trước khi định tuyến nó qua ranh giới retry chung.

## Khả năng tương thích Seed gate

`seed:public` không chỉ coi việc nâng cấp UUID xác định là đủ giá trị bình thường. Trước khi xây dựng tập dữ liệu đắt tiền, `seed:public` không chạy thử trước tiên sẽ kiểm tra tính tương thích của embedding và Qdrant readiness/lược đồ, sau đó xác thực lại chúng ngay trước khi xác minh trạng thái hạt giống và embedding. Trước khi viết điểm nó:

1. xác minh embedding service báo cáo model/thứ nguyên đã được định cấu hình và nguồn gốc runtime theo ngữ nghĩa thực; seed công khai từ chối các chương trình phụ trợ mô phỏng/chưa được xác minh;
2. xác minh Qdrant collection sử dụng thứ nguyên vector chưa được đặt tên đã định cấu hình với khoảng cách Cosine;
3. đảm bảo và xác thực tất cả các loại dữ liệu chỉ mục payload, bao gồm `index_fingerprint: keyword`;
4. tính toán dấu vân tay v2 từ các thực thể cuối cùng cộng với embedding model/phiên bản, phiên bản văn bản nhúng và xuất xứ runtime;
5. thích số lượng chính xác của Qdrant cho trạng thái tổng/vân tay; nếu chế độ nghiêm ngặt vô hiệu hóa tìm kiếm chính xác, hãy thực hiện đếm phía ứng dụng chính xác thông qua cuộn phân trang được giới hạn với vectors bị tắt và chỉ chọn `index_fingerprint`.

Dự phòng cuộn tôn trọng `strict_mode_config.max_query_limit`, vì vậy quy trình làm việc seed không yêu cầu tắt chế độ nghiêm ngặt Qdrant. collection trống là `fresh`. Một phần collection chỉ chứa cùng một dấu vân tay là `resume`. Một kết quả khớp hoàn toàn chính xác là `idempotent` và bỏ qua embedding/upsert. Bất kỳ dấu vân tay nước ngoài hoặc điểm bổ sung bất ngờ không được đóng lại. Điều này cố tình tránh việc xóa tự động; quá trình di chuyển nên sử dụng tên collection mới hoặc quy trình đặt lại rõ ràng.


### Kiểm tra xuất xứ chỉ số ngữ nghĩa

Sau seed thực, `npm run verify:semantic-index -- 20000` thực hiện kiểm tra phân trang read-only đối với collection đã được định cấu hình. Nó chỉ chọn `embedding_backend`, `embedding_implementation` và `embedding_semantic` (không có vectors), tuân thủ các giới hạn query ở chế độ nghiêm ngặt và không thành công trừ khi mọi điểm dự kiến ​​đều khớp với embedding ngữ nghĩa trực tiếp đã được xác minh. Collections được gieo trước dấu vân tay v2 không chứa bằng chứng này và phải được coi là chưa được xác minh để đánh giá chất lượng ngữ nghĩa.

## Tiến trình Curl và seed đã được xác thực

SDK Node.js nhận khóa profile của API đã chọn thông qua `QdrantClient({ apiKey })`. Các lệnh `curl` thô phải thực hiện tương đương một cách rõ ràng bằng cách sử dụng tiêu đề `api-key` của Qdrant; không đặt khóa vào URL:

```bash
curl -fsS \
  -H "api-key: $QDRANT_API_KEY" \
  "$QDRANT_URL/collections/$QDRANT_COLLECTION" \
  | jq .
```

Để theo dõi seed/nhập, hãy ưu tiên trình trợ giúp vì nó giải quyết `QDRANT_<PROVIDER>_URL` / `QDRANT_<PROVIDER>_API_KEY` dành riêng cho nhà cung cấp đã chọn trước tiên, sau đó là dự phòng chung và không in thông tin xác thực:

```bash
npm run seed:status -- --expected 20000 --interval 5
```

`--once` thực hiện một request đã được xác thực và thoát. Chế độ đồng hồ mặc định lặp lại sau mỗi năm giây.

Tất cả các điểm vào seed cũng ghi một dòng tiến trình mà con người có thể đọc được được điều chỉnh cộng với trạng thái có thể đọc được bằng máy:

```text
reports/seed-progress.json
reports/seed-progress.jsonl
```

Mỗi lần chạy sẽ nhận được `seedRunId`. Bản ghi tiến trình bao gồm giai đoạn, batch/tổng ​​batches, số lượng được nhúng/tăng cường, phần trăm, thực thể/giây, ETA, thời gian embedding tích lũy và thời gian nâng cấp Qdrant tích lũy. `stage=failed` duy trì các bộ đếm đã cam kết cuối cùng khi hoạt động embedding hoặc Qdrant không thành công.
