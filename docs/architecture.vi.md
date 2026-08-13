# Kiến trúc
> 🌐 Language / Ngôn ngữ: [English](architecture.md) | **Tiếng Việt**

## Ranh giới

Ứng dụng này sở hữu tính năng xác thực, chuẩn hóa đa ngôn ngữ, xuất xứ bản dịch, xây dựng văn bản embedding, xây dựng bộ lọc, ID xác định, phân nhóm, ánh xạ lỗi, đánh giá và hợp đồng REST.

Qdrant sở hữu bộ lưu trữ vector/payload, chỉ mục payload, lọc và xếp hạng tương tự. Sao lưu/khôi phục Provider nằm trong Qdrant service đã triển khai thay vì ứng dụng Node. Python service chỉ sở hữu ML inference cục bộ; Node vẫn là ứng dụng chính.

## Ranh giới kết nối Qdrant

```text
QDRANT_PROVIDER
      ↓
config resolver
      ↓ exactly one local/Beam/Modal profile
QdrantConnection
      ├─ private raw @qdrant/js-client-rest client
      ├─ bounded retry + exponential backoff + jitter
      ├─ request timeout
      ├─ single-probe readiness
      └─ waitUntilReady startup/CLI policy
      ↓
QdrantService
      ↓
SearchService / EntityService / SeedService
```

Cố tình không có tính năng tự động chuyển đổi dự phòng của Beam↔Modal. Các lớp trên không chứa branches dành riêng cho nhà cung cấp.

## Đường dẫn tìm kiếm

```text
HTTP request
→ Hono
→ SearchService validation
→ high-confidence structured constraint extraction
→ EmbeddingProvider.embedQuery
→ application FilterBuilder
→ QdrantService.querySemantic
→ QdrantConnection.execute
→ selected Qdrant provider
→ bounded candidate pool
→ structured consistency verification (country / continent / capital, when applicable)
→ high-confidence domain/entity-intent compatibility gate (when applicable)
→ requested/default score-threshold-preserving result set
→ response mapper + timings + sanitized consistency + domain-intent observability
```


## Xác minh tính nhất quán Production

Canonical v2.1 duy trì khả năng truy xuất dày đặc làm công cụ truy xuất và thêm trình xác minh sau truy xuất thận trọng cho các ràng buộc có cấu trúc rõ ràng. Trình xác minh được bật theo mặc định với `SEARCH_CONSISTENCY_VERIFICATION_ENABLED=true`; đã giới hạn queries tìm nạp quá mức lên tới `SEARCH_CONSISTENCY_CANDIDATE_MULTIPLIER=5` nhân với giới hạn kết quả công khai, bị giới hạn bởi `SEARCH_MAX_LIMIT`. Qdrant score threshold không được hạ xuống hoặc bỏ qua.

Chỉ các ràng buộc `country`, `continent` và `capital` có độ tin cậy cao mới được thực thi. Nếu trình phân tích cú pháp không thể trích xuất ràng buộc như vậy thì việc xác minh có cấu trúc sẽ không được áp dụng. Sau đó, lớp domain/entity-intent có độ tin cậy cao riêng biệt sẽ từ chối các kết quả `city`/`country` theo địa lý chỉ dành cho các mục đích đạt được thành tích của câu lạc bộ thể thao hoặc nội dung truyền thông phi địa lý đã được chứng minh. gate này được kích hoạt chuẩn với `SEARCH_DOMAIN_ENTITY_INTENT_GATE_ENABLED=true`; nó chạy sau khi xác minh tính nhất quán có cấu trúc, không thêm embedding/Qdrant request mới và chỉ hiển thị siêu dữ liệu đã được lọc sạch. Lớp xác minh có thể bị vô hiệu hóa để rollback hoạt động, nhưng `verify:canonical-config` từ chối trạng thái đó vì không chính tắc.

## Đường dẫn dữ liệu

```text
GeoNames cities15000
        ↓ canonical geographic entities
representative deterministic selection
        ↓
GeoNames alternateNamesV2 (EN/VI)
        ↓
WOF exact gn:id enrichment (best effort)
        │ cache + archive SHA-256
        │ EN/VI preferred names + aliases only
        ↓
optional cached translation
none/local/openai/gemini/nvidia/groq
        ↓
buildEmbeddingText
        ↓
embedDocuments(batch)
        ↓
UUIDv5(canonical GeoNames entity ID)
        ↓
QdrantService → QdrantConnection
        ↓
deterministic batch upsert
```

GeoNames sở hữu các thông tin về tọa độ/dân số/quản trị viên/múi giờ. WOF không bao giờ khóa lại thực thể và không bao giờ thực hiện khớp danh tính mờ. Việc làm giàu WOF không rõ ràng hoặc không đúng định dạng sẽ bị cách ly thay vì không thực hiện được quá trình xây dựng canonical GeoNames.

## Qdrant collection

Canonical mặc định: `knowledge_entities_qwen3_4b_text_v21` với vector dày đặc cosin 2560 chiều được tạo bởi `Qwen/Qwen3-Embedding-4B` và `embedding_text v2.1`. `knowledge_entities_qwen3_4b_v1` vẫn là rollback/collection được giữ lại. Các chỉ mục Payload bao gồm `type`, `continent`, `region`, `country_code`, `source`, `population` và `index_fingerprint` hoạt động. Trước seeding, ứng dụng xác thực các loại dữ liệu thứ nguyên/khoảng cách vector và chỉ mục tải trọng collection hiện có. Xác minh trạng thái hạt giống chính xác cộng với dấu vân tay xác định ngăn chặn tập dữ liệu hỗn hợp/trạng thái model mà không xóa dữ liệu hiện có. Ưu tiên số lượng chính xác Qdrant; Việc triển khai ở chế độ nghiêm ngặt vô hiệu hóa tìm kiếm chính xác chỉ sử dụng cuộn phân trang có giới hạn trên `index_fingerprint`.

Việc thay đổi chiều embedding/model sẽ tạo ra một collection mới thay vì âm thầm trộn vectors không tương thích.

## Chính sách dịch thuật

Dịch máy là tùy chọn vì embedding model là đa ngôn ngữ. Người Việt bản xứ thắng; Tiếng Việt còn thiếu vẫn còn nhìn thấy được. Tiếng Việt được tạo ra được đánh dấu `machine_translation` và ghi provider, model, phiên bản nhắc nhở, phiên bản băm nguồn và phiên bản dịch.
