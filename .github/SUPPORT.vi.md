# Hỗ trợ

> 🌐 Language / Ngôn ngữ: [English](SUPPORT.md) | **Tiếng Việt**

Đây là repository mã nguồn mở, không phải dịch vụ hỗ trợ được vận hành theo SLA. Không có thời gian phản hồi được cam kết, nhưng report có phạm vi rõ và có thể tái tạo sẽ dễ review hơn nhiều.

## Trước khi yêu cầu hỗ trợ

Hãy xem:

- [`README.vi.md`](../README.vi.md) cho runtime được chấp nhận và quick start;
- [`docs/production-demo.vi.md`](../docs/production-demo.vi.md) cho vòng đời production demo;
- [`docs/testing.vi.md`](../docs/testing.vi.md) cho các lệnh validation;
- [`docs/releases/v1.0.0.vi.md`](../docs/releases/v1.0.0.vi.md) cho phạm vi release, evidence và limitation đã biết.

## Thông tin nên cung cấp

Trong support request hoặc bug report, hãy cung cấp các mục phù hợp sau:

- commit/tag của repository;
- phiên bản Node.js;
- phiên bản Qdrant server và kiểu kết nối;
- môi trường chạy (Linux local, Kaggle, CI, v.v.);
- command hoặc API request chính xác;
- hành vi mong đợi và hành vi quan sát được;
- các bước tái tạo tối thiểu;
- log hoặc error output đã được làm sạch.

Không bao giờ đưa API key, token, private tunnel URL, credential hoặc evidence archive chưa được làm sạch vào issue.

## Nơi gửi yêu cầu

- Dùng form **bug report** cho lỗi có thể tái tạo.
- Dùng form **feature request** cho đề xuất thay đổi hành vi hoặc capability.
- Dùng form **documentation** cho tài liệu sai, thiếu hoặc khó hiểu.
- Với vulnerability hoặc credential exposure, hãy làm theo [`SECURITY.md`](SECURITY.md) và không công khai chi tiết nhạy cảm trong issue.

Known limitation đã được tài liệu hóa không mặc nhiên là bug. Nếu report phản biện một release claim đã được chấp nhận, hãy kèm evidence có thể kiểm chứng độc lập.
