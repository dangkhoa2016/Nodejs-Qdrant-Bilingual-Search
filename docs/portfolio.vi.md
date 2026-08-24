# Portfolio — Song ngữ Qwen3 + Qdrant Tìm kiếm ngữ nghĩa
> 🌐 Language / Ngôn ngữ: [English](portfolio.md) | **Tiếng Việt**

Đây là câu chuyện kỹ thuật hướng đến người đánh giá dành cho `nodejs-qdrant-bilingual-search` `v1.0.0`. Nó không phải là nhật ký chạy thô; nó giải thích vấn đề, kiến ​​trúc, các quyết định và bằng chứng kỹ thuật dẫn đến release profile được chấp nhận.

## 15.1 Tuyên bố vấn đề

Truy xuất ngữ nghĩa tiếng Anh/tiếng Việt trên kho ngữ liệu kiến ​​thức địa lý mở, sử dụng Node.js/Hono API, embeddings cục bộ và Qdrant. Mục tiêu là nhập dữ liệu công cộng có thể tái tạo, làm giàu bản dịch có thể kiểm tra, seeding xác định và chất lượng truy xuất có thể đo lường được — không phải Qdrant proxy mỏng.

## 15.2 Kiến trúc

```text
read-only Qwen3 model in /kaggle/input
        ↓
Python FastAPI embedding service
        ↓
normalized Float32[2560] vectors over binary-f32
        ↓
Node.js/Hono search API
        ↓
Qdrant canonical 20K collection
```

Cấu trúc liên kết trực tiếp (runtime thực tế):

```text
embedding : 127.0.0.1:8001
Node/Hono : 127.0.0.1:3000
Qdrant    : 127.0.0.1:6333
```

model được tải read-only từ `/kaggle/input` — không bao giờ từ Hugging Face và không bao giờ từ bản sao làm việc có thể thay đổi.

## 15.3 Sự phát triển về chất lượng ngữ nghĩa

Trình bày tài liệu được thăng cấp là `embedding_text v2.1`:

```text
v2 relation/type improvements were useful but created country over-bias;
v2.1 corrected the asymmetry;
v2.1 was tested on candidate/adversarial/full-20K evaluations;
full-20K quality reached approximately:
R@1  = 96.25%
R@3  = 100%
R@5  = 100%
```

Đây là kết quả đánh giá lịch sử từ giai đoạn đóng băng, không được tạo mới trong tài liệu release này.

## 15.4 Snapshot tái sử dụng và nhận dạng ngữ nghĩa

Nhận dạng ngữ nghĩa không giống với nguồn gốc thực thi. Trình xác minh xử lý model, thứ nguyên, profile, query/chiến lược tài liệu, ID lệnh và phiên bản văn bản nhúng dưới dạng gates ngữ nghĩa cứng, trong khi báo cáo riêng nguồn gốc thực thi (ví dụ: `sentence-transformers` so với `transformers`, thiết bị, runtime). Đây là lý do tại sao canonical 20K snapshot có thể tái sử dụng: nhận dạng ngữ nghĩa vẫn được xác minh ngay cả khi nguồn gốc thực thi lịch sử khác nhau. Người xác minh là gate an toàn - đây không phải là khẳng định rằng xuất xứ của backend là không liên quan.

## 15.5 CPU FP16 kỹ thuật

Mục tiêu thực tế:

```text
fit Qwen3-Embedding-4B inside the observed Kaggle ~32GB-class CPU environment
without changing the public vector contract.
```

Đường ống chính xác:

```text
internal FP16
public Float32 vectors
OOM=0
oom_kill=0
```

CPU latency từ profile này là hiệu suất demo/runtime di động, không phải hiệu suất phục vụ production.

## Tích hợp 15.6 Node/Hono

Các ranh giới của Service rất rõ ràng: Python FastAPI embedding service sở hữu model inference và trả về `Float32[2560]` vectors đã chuẩn hóa trên `binary-f32` transport; Node.js/Hono API sở hữu tính năng tìm kiếm và thực thể/thống kê. Lớp kết nối Qdrant luôn trung lập với nhà cung cấp (`local | beam | modal`), branches chỉ trên một profile bất biến và không bao giờ tự động chuyển đổi giữa providers.

## 15.7 ĐỎ→XANH Node 22 bootstrap nguyên nhân gốc rễ

Môi trường trong lành ban đầu bootstrap không thành công trong cài đặt shell nghiêm ngặt. Nguyên nhân cốt lõi ngắn gọn:

```text
set -euo pipefail
sourced bootstrap
function/local tmp variable
RETURN trap
nounset scope failure
```

Cách khắc phục:

```text
subshell
EXIT trap
same-scope tmp lifetime
checksum verification retained
```

Giá trị là phương pháp kỹ thuật (fail-closed, bootstrap xác định, có thể tái tạo), chứ không phải bản thân câu đố về vỏ. Tarball Node được ghim được xác minh dựa trên `SHASUMS256.txt` chính thức trước khi trích xuất và không đóng được do không khớp.

## 15.8 Kỹ thuật bằng chứng

Bằng chứng chấp nhận được đóng gói với sự đảm bảo tính toàn vẹn:

```text
individual sentinel JSON preservation
manifest without self-hash
source/evidence/closeout SHA verification
clean Git worktree closeout
```

Bản kê khai bằng chứng có chủ ý không tự băm, tránh việc tự tham chiếu vòng tròn.

## 15.9 release này cố tình không yêu cầu điều gì

```text
- not a low-latency GPU production service
- no reranker
- no hybrid sparse+dense search
- no RAG
- no automatic reseeding during runtime
- no claim that CPU FP16 is universally optimal
```

Những mục tiêu không phải này ngăn chặn việc yêu cầu quá cao danh mục đầu tư và giữ cho release trung thực như một demo/runtime profile di động.

## 15.10 Phạm vi sản xuất- demo

Trình xác minh ngữ nghĩa Canonical 20K = `20000 / 20000 PASS`, không có OOM. Khói production ổn định
trên canonical snapshot bị đóng băng vượt qua bộ canonical tương thích sentinel: Thái Lan EN,
Tokyo VI và Bắc Kinh VI ở vị trí số 1, chỉ số 20.000/20.000 và trình xác minh ngữ nghĩa, với
OOM/oom_kill = 0.

Một bộ chẩn đoán kiểu quan hệ riêng biệt, chặt chẽ hơn cũng được thực hiện. người Việt
Các dạng quan hệ "quốc gia có thủ đô / nổi tiếng với X" **không** trả về quốc gia ở vị trí số 1:
Qwen3-Embedding-4B model bị đóng băng cho điểm thành phố đồng âm cao hơn thành phố gốc một chút
quốc gia (đo thành phố Bangkok ≈ 0,660 > Quốc gia Thái Lan ≈ 0,659 cho "quốc gia Đông Nam Á có
thủ đô Bangkok"; thành phố Fuji phía trên Nhật Bản với "quốc gia châu Á nổi tiếng với núi Phú Sĩ").
tính nhất quán thực thể miền nghiêm ngặt gate (`entity_type=country`) sau đó từ chối thành phố candidates
và quốc gia mong đợi không được trả về ở vị trí số 1 cho biểu mẫu query đó. Đây là bản chất
Thuộc tính model+snapshot. Thứ tự xếp hạng giữa các thành phố trên toàn quốc được sao chép trên
FP32 thực sự trên cùng một snapshot; điểm số hơi khác nhau một chút, vì vậy đây là bằng chứng cho thấy
kết quả không cụ thể đối với FP16, không phải bằng chứng về đầu ra kiểu chéo giống hệt byte và không phải là
khiếm khuyết tái thiết. Fuji/Nhật Bản queries vẫn chỉ mang tính chất chẩn đoán và không phải là gate giai đoạn.

Xem [releases/v1.0.0.md](releases/v1.0.0.md) để biết ghi chú release và tóm tắt sentinel.
