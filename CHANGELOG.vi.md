# Nhật ký thay đổi
> 🌐 Language / Ngôn ngữ: [English](CHANGELOG.md) | **Tiếng Việt**

## [1.0.0] - 2026-08-29

### Đã thêm
- tìm kiếm ngữ nghĩa EN/VI song ngữ API với Node.js/Hono và Qdrant
- Profile embedding Qwen3-Embedding-4B 2560 chiều chuẩn
- tập dữ liệu xác định/seed/công cụ đánh giá/khả năng tái tạo
- Profile phát hành Kaggle Transformers CPU-FP16
- Công cụ xác minh và chấp nhận chỉ số ngữ nghĩa
- Điểm khởi chạy production demo Kaggle tích hợp kho lưu trữ notebook
- Trình trợ giúp khôi phục fail-closed canonical Qdrant snapshot
- đóng gói bằng chứng đã được làm sạch và chấp nhận notebook ổn định
- Cổng thử nghiệm công khai được xác thực với Bearer token mỗi phiên
- Đường dẫn công cộng Quick Tunnel bị giới hạn ở cổng tại `127.0.0.1:8090`
- Các ô Markdown giải thích song ngữ Anh/Việt trong toàn bộ Kaggle notebook

### Đã xác thực
- Trình xác minh ngữ nghĩa 20K/20K
- khả năng tương thích ổn định/canonical sentinel được đặt ở vị trí số 1 (Thái Lan EN, Tokyo VI, Bắc Kinh VI)
- chẩn đoán kiểu quan hệ nghiêm ngặt nằm trong phạm vi chỉ chẩn đoán (dạng viết hoa tiếng Thái VI; Fuji/Nhật Bản)
- Chấp nhận bộ nhớ CPU FP16 không có OOM/oom_kill
- Node di động 22/24 bootstrap mới có xác minh SHA-256
- có thể tái tạo npm-ci CI và tính toàn vẹn của việc đóng gói và lưu trữ bằng chứng
- notebook JSON/hợp đồng nguồn và cú pháp trợ giúp Kaggle trong CI
- kiểm tra đơn vị cổng xác thực trên Node 22 và Node 24
- Hợp đồng CI cấu trúc liên kết công cộng yêu cầu nguồn gốc đường hầm là `127.0.0.1:8090`
- Các đường dẫn lưu trữ Kaggle Qdrant mới được chuẩn hóa trước khi tạo và kiểm tra hồi quy trên Node 22/24
- chấp nhận ngữ nghĩa cục bộ chứa 7 kiểm tra; Sự chấp nhận công khai đã được xác thực bao gồm 8 bước kiểm tra bao gồm `401` gate chưa được xác thực
- Làm mới cứng Kaggle repository loại bỏ trạng thái checkout cũ không bị theo dõi chẳng hạn như `snapshots/` sau `reset --hard`, đã được kiểm tra hồi quy trên Node 22/24
- Các đường dẫn Qdrant snapshot/temp runtime tạm thời được đưa ra bên ngoài từ nguồn checkout và được kiểm tra hồi quy trên Node 22/24
- Khôi phục snapshot được chạy lại an toàn cho Qdrant processes thuộc sở hữu của dự án trong khi vẫn duy trì hành vi fail-closed cho trình nghe bên ngoài trên port `6333`
- PASS tổng thể của notebook được kiểm soát bởi bằng chứng thành công collection và không thể đóng thành `INCOMPLETE` nếu không
- bằng chứng phân biệt phiên bản Node shell Collector với demo Node runtime đang chạy thực tế

### Bảo mật và vận hành
- canonical Kaggle CPU-FP16 profile liên kết rõ ràng Node API với `127.0.0.1`; Qdrant, embedding service và Node backend đều phải duy trì ở chế độ vòng lặp ngược
- các tuyến API công khai yêu cầu `Authorization: Bearer <token>` khi được hiển thị thông qua đường dẫn công cộng notebook tùy chọn
- tìm kiếm đồng thời inference được giới hạn ở một request công khai trong khi health/readiness vẫn phản hồi
- cổng thực thi danh sách cho phép tuyến đường an toàn, giới hạn tốc độ, giới hạn nội dung yêu cầu, ID request và timeout ngược dòng
- public Phần 6–7 là tùy chọn và bị tắt theo mặc định với `ENABLE_PUBLIC_TUNNEL=False`
- Điểm đánh dấu PASS công khai notebook chỉ được phát ra sau khi quá trình chấp nhận công khai được xác thực thực sự hoàn tất
- bằng chứng collection bị lỗi trên cây công việc Git bẩn, bỏ qua các dòng lệnh process đầy đủ, từ chối rò rỉ mã thông báo Bearer và xác minh cấu trúc liên kết trình nghe backend
- bằng chứng bên ngoài `.zip.sha256` sidecar sử dụng tên cơ sở ZIP di động; `SHA256SUMS` nội bộ vẫn tương đối và được xác minh lại trích xuất độc lập
- nguồn checkout là nguồn dùng một lần và được làm sạch bằng `git clean -ffd`; bộ lưu trữ Qdrant runtime liên tục vẫn nằm ngoài repository theo `/kaggle/working/qdrant-bilingual-search`
- trình trợ giúp khôi phục đặt rõ ràng Qdrant snapshots và các tệp tạm thời trong `/kaggle/working/qdrant-bilingual-search/snapshot-restore-runtime`
- trước khi khôi phục canonical snapshot, demo processes thuộc sở hữu của dự án sẽ ngừng sử dụng quyền sở hữu PID/chữ ký model hiện có; service bên ngoài/tái sử dụng vẫn chiếm `6333` không bao giờ bị tắt và chặn khôi phục
- trạng thái notebook cuối cùng ghi lại `EVIDENCE_COLLECTION=PASS/FAIL` và không bao giờ thừa nhận PASS tổng thể mà không đóng gói bằng chứng hoàn chỉnh

### Ghi chú
- vectors công khai vẫn được chuẩn hóa Float32[2560]
- Việc tái sử dụng canonical snapshot đã được phê duyệt; không cần reseed
- Khôi phục canonical snapshot được ghim vào Qdrant 1.18.3 và SHA-256 `71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f`
- Kaggle thực **Phiên khởi động lại → Chạy tất cả** trên `main` HEAD cuối cùng vẫn là gate được chấp nhận cuối cùng trước khi siêu dữ liệu release bị ghi đè
- xác thực Kaggle cốt lõi cục bộ không yêu cầu đường hầm công cộng được xác thực tùy chọn; mọi xác nhận quyền sở hữu release demo công khai đều yêu cầu Phần 6–7 và `PRODUCTION_DEMO_ACCEPTANCE_PASS=8`
