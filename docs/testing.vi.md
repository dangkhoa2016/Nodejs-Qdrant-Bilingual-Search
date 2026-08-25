# Chiến lược thử nghiệm
> 🌐 Language / Ngôn ngữ: [English](testing.md) | **Tiếng Việt**

## Kiểm tra đơn vị

Các ranh giới cơ sở hạ tầng và miền thuần túy được kiểm tra mà không cần tải xuống Qdrant hoặc ML: cấu hình, lựa chọn provider, phân loại/ngược lại retry, hệ thống dây readiness, runtime, ranh giới kiến trúc, thực thể chuẩn hóa, xuất xứ, văn bản HTTP embedding client, bản dịch client, trình tạo bộ lọc, hình dạng cuộc gọi Qdrant, UUID xác định, ánh xạ điểm, phân nhóm seed, lưu trữ/chuẩn hóa WOF, số liệu và dọn dẹp runtime.

Kiểm tra kết nối sử dụng máy khách, đồng hồ, chức năng ngẫu nhiên và chức năng ngủ được tiêm. Điều này làm cho việc khôi phục 503, hành vi không nhanh 401 và độ trễ retry chính xác được xác định mà không cần chờ đợi thực sự.

## Kiểm tra kiến ​​trúc

`tests/unit/qdrant-boundary.test.js` ngăn chặn việc xây dựng `QdrantClient` thô bên ngoài nhà máy kết nối production và ngăn chặn việc phân nhánh dành riêng cho nhà cung cấp rò rỉ vào các lớp QdrantService/search/entity/Hono/seed.

## Các bài kiểm tra HTTP

Hono trong quá trình xử lý của `app.request()` xác thực mã trạng thái tuyến đường và hợp đồng JSON công khai mà không cần mở TCP port. Các thử nghiệm bao gồm tính sống động, readiness có cấu trúc, xác thực tên miền và ánh xạ `QDRANT_UNAVAILABLE` an toàn.

## Kiểm tra Python

embedding và công cụ dịch thuật chấp nhận model/phụ trợ giả mạo. Do đó, tiền tố, kích thước, ràng buộc hướng và kết quả không hợp lệ có thể được kiểm tra mà không cần tải xuống models lớn.

## Tích hợp Qdrant thực

`tests/integration/qdrant.integration.test.js` được chọn tham gia. Nó sử dụng **cùng một nhà máy kết nối production** làm ứng dụng, chờ Qdrant readiness, tạo một collection tạm thời, chạy `SeedService` thực hai lần để chứng minh hành vi vân tay của `fresh → idempotent`, xác thực các chỉ mục payload và xác minh trạng thái hạt giống chính xác (đếm chính xác hoặc dự phòng cuộn ở chế độ nghiêm ngặt), thực hiện Query Truy xuất + số liệu thống kê API và xóa collection khi phân tích.

CI chạy thử nghiệm này với Qdrant v1.19.0.

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

## Tại sao các bài kiểm tra chất lượng mô hình lại riêng biệt

Kiểm tra đơn vị không được phụ thuộc vào lượt tải xuống model hoặc các giá trị tương tự không xác định. Chất lượng truy xuất được đo bằng kho ngữ liệu song ngữ benchmark đã cam kết thông qua `npm run benchmark`.

## Chạy thử nghiệm tích hợp thực tế với provider đã chọn

Thử nghiệm tích hợp sử dụng profile giống như production và chỉ thực hiện các hoạt động phá hủy bên trong một collection tạm thời duy nhất mà nó sẽ loại bỏ sau đó. Nó được chọn tham gia thông qua `RUN_QDRANT_INTEGRATION=1`.

CI cục bộ/mặc định:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

Chùm tia:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=beam \
QDRANT_BEAM_URL=https://YOUR-BEAM-QDRANT-ENDPOINT \
QDRANT_BEAM_API_KEY='...' \
npm run test:integration
```

Phương thức:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=modal \
QDRANT_MODAL_URL=https://YOUR-MODAL-QDRANT-ENDPOINT \
QDRANT_MODAL_API_KEY='...' \
npm run test:integration
```

Không có dự phòng cho provider khác nếu cái đã chọn không có sẵn.
