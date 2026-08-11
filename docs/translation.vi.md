# Kiến trúc dịch thuật và nhiều khóa API
> 🌐 Language / Ngôn ngữ: [English](translation.md) | **Tiếng Việt**

## Nguyên tắc

Dịch là việc làm phong phú tập dữ liệu tùy chọn, không phải là yêu cầu runtime cho tìm kiếm ngữ nghĩa. Tiếng Việt bản địa từ GeoNames hoặc Who's On First không bao giờ bị ghi đè. provider mặc định là `none`.

providers được hỗ trợ là `none`, `local`, `openai`, `gemini`, `nvidia` và `groq`. Ứng dụng sử dụng `fetch` gốc cho các cuộc gọi REST trên đám mây và do đó không yêu cầu gói SDK của nhà cung cấp.

## Ranh giới Provider

`createTranslationProvider()` trả về một provider phổ biến hiển thị `provider`, `model`, `promptVersion` và `translate()`. `TranslationService` bổ sung thêm cache/xuất xứ liên tục. Mã bộ dữ liệu gọi hợp đồng đó và không biết hình dạng HTTP của nhà cung cấp.

OpenAI sử dụng Responses API. Gemini sử dụng `models/{model}:generateContent`. NVIDIA và Groq chia sẻ bộ điều hợp hoàn thành trò chuyện tương thích với OpenAI với các URL cơ sở dành riêng cho nhà cung cấp.

Không có chuyển đổi dự phòng tự động giữa các nhà cung cấp. Nếu `TRANSLATION_PROVIDER=groq`, quá trình chạy vẫn ở Groq. Điều này giữ cho đầu ra model/xuất xứ được xác định. Nhiều khóa chỉ cải thiện khả năng phục hồi và phân phối hạn ngạch **bên trong provider đã chọn**.

## Khám phá nhiều khóa

Lớp khám phá khóa chấp nhận các biến được đánh số với các khoảng trống số tùy ý:

```env
OPENAI_KEY1=...
OPENAI_KEY3=...
GEMINI_KEY1=...
GEMINI_KEY8=...
NVIDIA_KEY1=...
NVIDIA_KEY2=...
GROQ_KEY1=...
GROQ_KEY2=...
GROQ_KEY10=...
```

`OPENAI_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `GROQ_API_KEY` thông thường vẫn được hỗ trợ. Các giá trị bí mật trùng lặp sẽ được loại bỏ. Các phím được đánh số được sắp xếp theo thứ tự số trước phím dự phòng.

## Chính sách nhóm khóa

Chiến lược mặc định là `round-robin` trong số các khóa sẵn sàng.

- HTTP `401/403`: khóa hiện tại bị vô hiệu hóa đối với rest của lần chạy process đó, sau đó sẽ nhận được một khóa sẵn sàng khác.
- HTTP `429`: phím vào thời gian hồi chiêu; `Retry-After` được vinh danh khi có mặt; một khóa sẵn sàng khác được lấy.
- HTTP `408/425/500/502/503/504` và các lỗi mạng Node/Undici đã biết: retry bị giới hạn xảy ra trên **cùng một khóa**. Việc luân phiên thông tin xác thực không giải quyết được tình trạng ngừng hoạt động của provider.
- Các lỗi Request/model như `400/404/422`: hỏng nhanh thay vì lãng phí từng phím.
- Nếu tất cả các phím bị tắt, `ApiKeyPoolExhaustedError` sẽ được nâng lên.
- Nếu tất cả các phím được bật đang làm mát, nhóm chỉ chờ trong `TRANSLATION_KEY_MAX_WAIT_MS`; nếu không thì nó báo lỗi làm mát.

Cấu hình:

```env
TRANSLATION_KEY_STRATEGY=round-robin
TRANSLATION_KEY_COOLDOWN_MS=60000
TRANSLATION_KEY_MAX_WAIT_MS=60000
TRANSLATION_RETRY_MAX_ATTEMPTS=3
TRANSLATION_RETRY_BASE_DELAY_MS=250
TRANSLATION_RETRY_MAX_DELAY_MS=2000
TRANSLATION_RETRY_JITTER_RATIO=0.2
```

## Xử lý bí mật

Đối tượng thuê giữ bí mật riêng tư. `toJSON()` và nhóm khóa snapshots chỉ hiển thị tên/trạng thái/bộ đếm vị trí. Lỗi đám mây HTTP lưu trữ mã provider/trạng thái/transport nhưng không giữ lại các tiêu đề request thô hoặc giá trị khóa API.

Nguồn gốc dịch không bao giờ chứa khe khóa API vì khóa là cơ sở hạ tầng vận hành chứ không phải nguồn gốc dữ liệu.

## Cache/tiếp tục

Đường dẫn mặc định:

```text
data/generated/translation-cache.jsonl
```

Danh tính Cache là SHA-256 trên provider, model, phiên bản nhắc nhở, hướng ngôn ngữ và văn bản nguồn SHA-256. Khe khóa API bị cố ý loại trừ. Do đó, quá trình chạy có thể bắt đầu trên `GROQ_KEY1`, xoay sang `GROQ_KEY2`, khởi động lại sau và vẫn sử dụng lại các bản dịch trước đó.

cache là JSONL chỉ bổ sung và được tải vào bản đồ theo yêu cầu. requests trùng lặp đồng thời được kết hợp lại bằng một bản đồ trên chuyến bay để một văn bản không được dịch hai lần trong cùng một process.

## Xuất xứ

Các trường được tạo nhận siêu dữ liệu:

```json
{
  "provider": "groq",
  "model": "your-model-id",
  "prompt_version": "translation-v1",
  "source_language": "en",
  "target_language": "vi",
  "source_sha256": "...",
  "translation_version": "v1"
}
```

`languageProvenance.description_vi` trở thành `machine_translation`. Ruộng đồng Việt Nam vẫn giữ được nguồn gốc xuất xứ ban đầu.

## Lệnh

Chạy khô mà không tiêu tốn hạn ngạch đám mây:

```bash
npm run dataset:translate -- \
  --input data/generated/entities.base.json \
  --provider groq \
  --model your-model-id \
  --dry-run
```

Chạy:

```bash
export GROQ_KEY1='...'
export GROQ_KEY2='...'
npm run dataset:translate -- --provider groq --model your-model-id --fields description
```

Chế độ cục bộ sử dụng Python service:

```bash
TRANSLATION_PROVIDER=local \
TRANSLATION_MODEL=Helsinki-NLP/opus-mt-en-vi \
npm run dataset:translate
```

ID Cloud model không bao giờ được mã hóa cứng làm mặc định vì tính khả dụng, giá cả và hành vi có thể thay đổi. Cung cấp `TRANSLATION_MODEL` một cách rõ ràng.
