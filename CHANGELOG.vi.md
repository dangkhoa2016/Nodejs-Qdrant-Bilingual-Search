# Nhật ký thay đổi
> 🌐 Language / Ngôn ngữ: [English](CHANGELOG.md) | **Tiếng Việt**

## [1.0.0] - 2026-08-29

### Đã thêm
- API tìm kiếm ngữ nghĩa song ngữ EN/VI với Node.js/Hono và Qdrant
- profile embedding canonical Qwen3-Embedding-4B 2560 chiều
- công cụ dataset, seeding, evaluation và reproducibility xác định
- profile release Kaggle Transformers CPU-FP16
- công cụ semantic index verification và acceptance
- Kaggle production-demo notebook được tích hợp trong repository
- helper khôi phục canonical Qdrant snapshot theo fail-closed
- đóng gói evidence đã làm sạch kèm xác minh SHA-256
- optional authenticated public-demo gateway và Quick Tunnel path
- tài liệu và hướng dẫn notebook song ngữ Anh/Việt

### Trạng thái publication `v1.0.0` cuối cùng đã xác thực

Danh tính publication đã freeze:

```text
annotated tag object = ce9cbf6d814a2cf0f4a16251dca55aa1ad918bc5
release commit       = 93d9117e4777ab2570522d25d79ba69709f43fbd
release tree         = 4cfb514413b02fea9ad1cec052abfb71038c6a13
exact-main CI        = #154 / run 34302179233 / PASS
exact-tag CI         = #155 / run 34303663281 / PASS
```

Final fresh post-LICENSE Kaggle qualification:

```text
evidence timestamp          = 20260909T024546Z
Qdrant                      = 20000 / 20000
snapshot restore            = PASS
RESEED_PERFORMED            = NO
Search Showcase             = PASS
stable local acceptance     = 13 / 13 PASS
semantic sentinels          = 10 / 10 PASS
authenticated public demo   = NOT_RUN
```

`AUTHENTICATED_PUBLIC_DEMO=NOT_RUN` là kết quả chấp nhận được cho core release vì `ENABLE_PUBLIC_TUNNEL=False` là mặc định an toàn. Optional public topology vẫn được CI kiểm tra theo contract riêng.

### Bối cảnh historical qualification

Các lần qualification trên reconstructed source trước đó dùng những compatibility acceptance set nhỏ hơn, gồm historical local set 7 checks và optional authenticated-public extension. Những con số này chỉ còn ý nghĩa historical cho source state nơi chúng được thu thập.

Chúng **không** phải final `v1.0.0` publication contract. Final local qualification authoritative là post-LICENSE **13/13** ở trên.

Historical clean Kaggle evidence ngày 2026-08-31 vẫn được giữ cho reconstructed source commit `b316619ad94947571e91124adfe96071bbd1f255`; bằng chứng đó không được đổi nhãn thành evidence cho frozen release tip về sau.

### Canonical runtime và semantic profile
- Qwen3-Embedding-4B, 2560 chiều, cosine distance
- internal runtime Transformers / PyTorch / CPU / FP16
- public vector `Float32[2560]` đã chuẩn hóa qua `binary-f32`
- query profile `qwen3`
- query instruction ID `geo-retrieval-v1:d014d3ec6df87e49`
- embedding text contract `v2.1`
- canonical collection `knowledge_entities_qwen3_4b_text_v21`
- canonical snapshot SHA-256 `71f12fe14ef51966069347290ad15302d389e488d7904dab6cf0cf190f43064f`

### Stable compatibility và diagnostics
- stable search showcase: Thailand EN, Tokyo VI, Beijing VI = PASS
- final semantic sentinels: 10/10 PASS
- relation-style cases về Thailand capital và Fuji/Japan vẫn chỉ là diagnostic known limitations
- historical full-20K v2.1 evaluation: xấp xỉ R@1 96.25%, R@3 100%, R@5 100%

### Security và vận hành
- canonical Node API, embedding service và Qdrant giữ loopback-only trừ khi chủ động expose qua optional gateway
- public routes yêu cầu Bearer authentication khi optional public path được bật
- search inference concurrency được giới hạn trong khi health/readiness vẫn phản hồi
- evidence collection fail-closed khi source state bẩn và từ chối secret leakage
- `/kaggle/input` luôn read-only; writable Qdrant runtime state nằm dưới `/kaggle/working/qdrant-bilingual-search`
- canonical snapshot restore không bao giờ tự động reseed final collection

### Sáu controlled publication assets cuối cùng

GitHub Release đã freeze chính xác sáu custom assets:

```text
nodejs-qdrant-bilingual-search-v1.0.0-kaggle-cpu-fp16-production-demo.ipynb
  3f9b61694c3d2b2a9e73afa401dfc3f4ecf40d69bc11d551609499570a4df823

nodejs-qdrant-bilingual-search-v1.0.0-kaggle-cpu-fp16-production-demo.ipynb.sha256
  3fa610c0d759559a17c105c990586dd24e68e0addc857a1be8079a69ac127c33

nodejs-qdrant-v1.0.0-production-demo-evidence-20260909T024546Z.zip
  110ab61b97927ae74949badcd0d9dfc382608978b1ffbaa8795d3a2529a7255c

nodejs-qdrant-v1.0.0-production-demo-evidence-20260909T024546Z.zip.sha256
  990bde3daafe9a792023ab7c87bdefa8baa2409d442a26f026d6b8d0b28b07b9

nodejs-qdrant-v1.0.0-release-manifest.json
  2bdc13febab013937b657947ada11cc29e346b222890743d9ad5a23efb56dd76

nodejs-qdrant-v1.0.0-release-manifest.json.sha256
  bd7e32d44d0b29b797422f85ee87587de0b125b6b17426b736db6f8e504228a9
```

### Ghi chú tài liệu hậu-publication

Sau khi public release đã freeze, tài liệu trên nhánh `main` được corrective để khớp với final public provenance và asset set. Follow-up chỉ liên quan tài liệu này không retarget `v1.0.0`, không thay release assets và không reopen release qualification.
