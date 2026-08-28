# Bằng chứng Portfolio

Tài liệu này thuộc gói portfolio song ngữ của
`nodejs-qdrant-bilingual-search`. Mọi giá trị dưới đây được capture từ stack
Kaggle trực tiếp trong lần chạy portfolio demo, lần corrective one-shot nghiêm
ngặt, hoặc từ Git source đã đóng băng. Đây là bản ghi live-demo và tái tạo, không
phải benchmark, và dự án **không** tuyên bố SLA về độ trễ request.

## Runtime provenance

```text
RUNTIME_SOURCE_BRANCH=feat/runtime-contract-reuse-hardening
RUNTIME_SOURCE_HEAD=743800828c89db582cae90fc275bec19fb9b00e3
```

HEAD nguồn đã chạy runtime được đóng băng và tree tracked sạch. Mọi bằng chứng
trực tiếp tham chiếu HEAD runtime-proven này. Các cải tiến tài liệu nằm trên một
docs branch tách biệt, bắt nguồn từ HEAD này và chỉ thay đổi tài liệu (xem
`RELEASE_CANDIDATE.json` và thư mục `docs/`).

## Hardware/runtime contract

Được xác minh so với các dịch vụ đang chạy:

| Khu vực | Giá trị đã chứng minh |
|---|---|
| Model | Qwen/Qwen3-Embedding-4B |
| Device | cpu |
| Dtype | float32 (true, đã xác minh) |
| Runtime | pytorch-cpu |
| Runtime contract | embedding-runtime-dtype-verified-v1 |
| Embedding dimension | 2560 |
| Transport | binary-f32 |
| Construction count | 1 |
| Warm-up count | 1 |
| Search threshold | 0.55 |
| Translation | tắt |

Gate kiểm định ghi nhận `PORTFOLIO_RUNTIME_CONTRACT=PASS`.

## Qdrant canonical index

| Khu vực | Giá trị |
|---|---|
| Collection | knowledge_entities_qwen3_4b_text_v21 |
| Status | green |
| Points / indexed | 20000 / 20000 |
| Distance | Cosine |
| Reseed lúc serving | Không |

Canonical 20K index có sẵn được dùng lại nguyên trạng; không reseed hay thay đổi
dữ liệu cho lần capture portfolio này.

## Bằng chứng search trong warm session thành công

Các probe trực tiếp sau được capture từ một session Kaggle CPU đã chạy và đang
ấm. Chúng chứng minh **chức năng** tìm kiếm, không phải cam kết về độ trễ
request:

- **en-thailand** — "Southeast Asian country whose capital is Bangkok"
  → kết quả đầu là **Thailand** (country), HTTP 200.
- **vi-thailand** — "quốc gia Đông Nam Á có thủ đô Bangkok"
  → kết quả đầu là **Thailand** (country), HTTP 200.
- **en-vietnam-capital** — "What is the capital of Vietnam?"
  → kết quả đầu là **Hanoi** (city), HTTP 200.
- **en-casablanca-negative** — "What is the plot of the movie Casablanca?"
  → HTTP 200, kết quả rỗng (xem dưới).

Các file JSON request/response/timing thô của những capture warm-session này
được giữ trong thư mục `searches/` của gói portfolio. Sentinels demo ghi nhận
`PORTFOLIO_DEMO_SENTINELS=PASS` cho các capture đó.

## Kết quả corrective one-shot nghiêm ngặt

Lần corrective acceptance one-shot nghiêm ngặt sau đó đã **không** đạt. Probe
đầu tiên (`en-thailand`) được gửi đúng một lần với biên client 120 giây đã cấu
hình:

```text
en-thailand
chỉ attempt #1
CURL_RC=28
HTTP_CODE=000
TOTAL_SECONDS=120.001360
0 byte phản hồi nhận được
không retry
các probe sau không chạy
RESULT=DEMO_CAPTURE_REGRESSION
```

Bằng chứng corrective nghiêm ngặt được giữ bất biến (xem Chuỗi bằng chứng bên
dưới), được tham chiếu bằng tên file và SHA-256, không tải lại trong gói này.

## Diễn giải về độ trễ

Môi trường Kaggle CPU dùng chung ghi nhận độ trễ request biến thiên đáng kể.
Các truy vấn trong warm session trước đó đã hoàn tất thành công, trong khi lần
corrective capture one-shot nghiêm ngặt sau đó timeout tại biên client 120 giây
đã cấu hình. Evidence hiện có không cô lập được một nguyên nhân duy nhất, vì vậy
dự án không tuyên bố SLA về độ trễ request cho deployment profile Kaggle CPU
dùng chung này.

## Ranh giới tuyên bố công khai

Portfolio mô tả một **production-oriented demo**, không phải dịch vụ production
đã chứng minh độ trễ. Nó tuyên bố giá trị kỹ thuật đã chứng minh (runtime CPU
true-FP32, loaded dtype đã xác minh, dùng lại canonical 20K, tìm kiếm song ngữ,
consistency và safe-guard domain/entity-intent, chuỗi bằng chứng tái tạo được)
nhưng **không** tuyên bố: độ trễ request ổn định, mọi request hoàn tất trong 120
giây, SLA về độ trễ request, đảm bảo throughput/QPS, mức sẵn sàng production quy
mô internet, việc corrective demo one-shot nghiêm ngặt đã đạt, hoặc việc nguyên
nhân timeout đã được cô lập.

## Ví dụ Casablanca domain/entity-intent

```text
query = What is the plot of the movie Casablanca?
```

Candidate địa lý của Casablanca bị domain/entity-intent gate loại bỏ vì intent
suy ra là non-geographic:

```text
domain_entity_intent.enabled = true
domain_entity_intent.applied = true
intent.domain = media-work
rejected_count = 1
rejection_reason_counts = { "geographic-entity-for-nongeographic-intent": 1 }
final results = []
```

Điều này cho thấy gate loại bỏ false-positive địa lý cho intent không-địa-lý mà
không hạ score threshold (0.55) và không hard-code tên thực thể.

## Bộ test

Source test mới trên nguồn runtime đã đóng băng:

| Suite | Kết quả |
|---|---|
| Node test suite | 420/420 PASS |
| pytest (embedding-service) | 52/52 PASS |
| unittest (embedding-service) | 46/46 PASS |

`git diff --check` sạch và `git fsck` chỉ báo cáo các object dangling lịch sử
(không có corruption hoặc object thiếu).

## Giải thích bộ nhớ

Model embedding là nguồn tiêu thụ RAM chính. Trong memory snapshot đã capture,
tiến trình embedding (`python -m uvicorn app:app`) báo RSS khoảng 14.9 GB.
Memory cgroup của session hiển thị `memory.current` ≈ 16.9 GB trong host 32 GB,
với `oom=0` và `oom_kill=0` và không có swap — run được chấp nhận ghi nhận
**không có sự kiện OOM / oom_kill**. Đây là giá trị snapshot runtime quan sát
được, không phải benchmark peak-memory và không nên được trình bày như RAM vật
lý phổ quát.

## Chuỗi bằng chứng

Các artifact bất biến sau được giữ nguyên (không viết lại ở đây). Sidecar
SHA-256 của chúng đã được xác minh trong lần chạy này:

| Artifact | SHA-256 |
|---|---|
| 20260828T085406Z-fp32-corrective-final.zip | 98c46baff92e3e6b57695a2e15ed0c2ffa36d08eacecf7aa8aad18e2a31f722b |
| 20260828T114914Z-fp32-post-closure-polish.zip | 56ea6c59adaa51a289c8bbdec9019beaf0a023a38b381b553a87b0e9feb426e1 |
| nodejs-qdrant-bilingual-search-fp32-corrective-743800828c89-polished-with-git.zip | 09e288026e92894336ad0e620fcc061a4afb4b7b55de5dd3f92c1a152d17778d |

Các hash này được capture từ session hiện tại và ghi trong
`historical/artifact-sha256.txt` và `historical/sidecar-verification.txt`. Nếu
một sidecar bị thiếu ở session khác, nó sẽ được ghi nhãn
`SHA sidecar not present in current Kaggle session` thay vì đoán hash.

Các định danh canonical của giai đoạn finalization này (xem thêm
`source/PROVENANCE.txt` trong gói finalization):

```text
runtime-proven HEAD
743800828c89db582cae90fc275bec19fb9b00e3

previous docs candidate HEAD
2996f20fa9ec8108bc8ad25c4d7151c3609d09ad

strict corrective failure artifact
20260828T135326Z-nodejs-qdrant-fp32-portfolio-corrective.zip

strict corrective SHA-256
c8699f7a3665f88035f9ac6a040113de1264e6b4078405d132e9018d98210813
```

Chuỗi bằng chứng hardening canonical trước đó vẫn còn hiệu lực và được giữ nguyên
ở đây; nó không bị xóa chỉ vì lần corrective sau đó thất bại.

## Anomaly đã biết

Sentinels Mount-Fuji/Japan bị đóng băng có hiện tượng semantic drift cross-runtime
vì canonical vectors ban đầu được seed trong một numerical runtime khác với
runtime CPU true-FP32 dùng cho query. Dự án không hạ production threshold hay
viết lại expected answer để che giấu hành vi này. Mount-Fuji được cố ý loại khỏi
capture demo portfolio nhỏ này.

## Ghi chú tái tạo

Nguồn runtime được đóng băng tại `7438008`. Stack canonical (Qdrant + embedding
service + Node API) đã chạy sẵn và được dùng lại cho capture portfolio; không
reseed, không đổi threshold, không mở lại benchmark, và không thay đổi
semantic/source code. Lần corrective one-shot nghiêm ngặt thất bại ở probe đầu
tiên và không được retry. Giai đoạn finalization chỉ thay đổi đúng bốn tài liệu
được phép trên docs branch tách biệt. Xem `ACCEPTANCE_CHECKLIST.txt`,
`RESULT.txt` và `RELEASE_DECISION.md` trong gói finalization để biết trạng thái
cuối cùng.
