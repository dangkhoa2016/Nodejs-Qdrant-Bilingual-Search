# Đóng góp cho Node.js Qdrant Bilingual Open Knowledge Search

> 🌐 Language / Ngôn ngữ: [English](CONTRIBUTING.md) | **Tiếng Việt**

Cảm ơn bạn đã cân nhắc đóng góp. Repository này xem semantic contract đã được chấp nhận, danh tính Qdrant snapshot, release evidence và nội dung publication song ngữ là các hợp đồng công khai cần được review, không phải chi tiết triển khai tùy ý.

## Trước khi tạo thay đổi

1. Tìm issue và pull request hiện có liên quan đến vấn đề.
2. Giữ mỗi thay đổi tập trung vào một mục tiêu nhất quán.
3. Khi nội dung hướng người dùng thay đổi, cập nhật tài liệu tiếng Anh và tiếng Việt cùng nhau nếu phù hợp.
4. Không commit API key, Bearer token, tunnel credential, runtime state riêng tư, secret trong model cache hoặc evidence log chưa được làm sạch.
5. Không âm thầm rebuild hoặc reseed canonical Qdrant collection trong một thay đổi không liên quan.

## Quy trình phát triển

Cài dependencies Node.js bằng runtime được hỗ trợ:

```bash
npm ci
```

Chạy bộ test Node:

```bash
npm test
```

Khi Python embedding service thay đổi, chạy unit test trong môi trường có đủ Python dependencies:

```bash
PYTHONPATH=embedding-service \
python -m unittest discover -s embedding-service/tests -v
```

Khi tích hợp Qdrant/search thay đổi, chạy integration test thật với Qdrant local được cấu hình có chủ đích:

```bash
RUN_QDRANT_INTEGRATION=1 \
QDRANT_PROVIDER=local \
QDRANT_LOCAL_URL=http://127.0.0.1:6333 \
npm run test:integration
```

Đối với thay đổi liên quan canonical profile, chạy thêm:

```bash
npm run verify:canonical-config
npm run verify:semantic-index -- 20000
npm run seed:status -- --once --expected 20000
```

## Các invariant canonical

Trừ khi pull request chủ động đề xuất, mô tả và requalify một thay đổi contract, hãy giữ nguyên danh tính `v1.0.0` đã được chấp nhận:

- model: `Qwen/Qwen3-Embedding-4B`;
- embedding dimension: `2560`;
- public vector: normalized `Float32[2560]`;
- transport: `binary-f32`;
- profile: `qwen3`;
- query strategy: `prompt`;
- document strategy: `raw`;
- query instruction id: `geo-retrieval-v1:d014d3ec6df87e49`;
- embedding text version: `v2.1`;
- canonical collection: `knowledge_entities_qwen3_4b_text_v21`;
- việc reuse canonical snapshot tiếp tục fail-closed và không bao giờ bị thay thế âm thầm bằng reseed.

Nếu thay đổi một trong các giá trị trên, pull request phải mô tả tác động compatibility và cung cấp qualification evidence mới thay vì đổi nhãn cho evidence cũ.

## Kỷ luật release và evidence

Release note, manifest, notebook, snapshot và evidence archive phải giữ provenance source trung thực. Corrective chỉ liên quan tài liệu hoặc governance không được đổi source identity của runtime evidence cũ thành release tip mới nhất.

Evidence công khai phải được làm sạch và không chứa secret, command line có credential, private endpoint hoặc runtime state không liên quan.

## Pull request

Một pull request tốt cần giải thích:

- vấn đề và kết quả mong muốn;
- file và contract bị ảnh hưởng;
- validation đã chạy;
- semantic profile, snapshot, runtime, public topology, security posture hoặc release provenance có thay đổi hay không;
- limitation hoặc follow-up work còn lại.

Pull-request template chứa checklist review cuối cùng.

## Vấn đề bảo mật

Không công khai chi tiết vulnerability, credential bị lộ hoặc exploit material trong public issue. Hãy làm theo [SECURITY.md](SECURITY.md).
