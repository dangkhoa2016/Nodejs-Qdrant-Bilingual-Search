# Qdrant production connection layer

## Mục tiêu

Application layer không được quan tâm Qdrant đang chạy ở local, Beam hay Modal. Chỉ composition/configuration layer biết provider; `QdrantService`, SearchService, EntityService và SeedService chỉ thấy một `QdrantConnection` thống nhất.

## Chọn provider

```env
QDRANT_PROVIDER=local
```

hoặc `beam`, `modal`. Không có Beam↔Modal auto-failover. Hai deployment độc lập chưa có replication contract chứng minh data/version luôn đồng nhất nên tự chuyển traffic có thể trả dữ liệu khác nhau.

Provider-specific variables được ưu tiên:

```env
QDRANT_BEAM_URL=https://...
QDRANT_BEAM_API_KEY=...
QDRANT_MODAL_URL=https://...
QDRANT_MODAL_API_KEY=...
```

`QDRANT_URL` và `QDRANT_API_KEY` chỉ là compatibility fallback cho provider đã được chọn.

## Runtime retry

Retryable HTTP: `408`, `425`, `429`, `500`, `502`, `503`, `504` và các Node/Undici transport error phổ biến. `401/403` fail-fast vì retry credential sai không thể khôi phục kết nối.

Runtime policy:

```env
QDRANT_REQUEST_TIMEOUT_MS=10000
QDRANT_RETRY_MAX_ATTEMPTS=3
QDRANT_RETRY_BASE_DELAY_MS=250
QDRANT_RETRY_MAX_DELAY_MS=2000
QDRANT_RETRY_JITTER_RATIO=0.2
```

CLI/startup `waitUntilReady()` dùng budget dài hơn:

```env
QDRANT_STARTUP_MAX_ATTEMPTS=8
QDRANT_STARTUP_BASE_DELAY_MS=500
QDRANT_STARTUP_MAX_DELAY_MS=5000
```

Điều này phù hợp với provider lifecycle có cold start. `/ready` không sleep/retry lâu; nó chỉ probe nhanh một lần để orchestrator nhận state thật.

## Boundary

Raw `@qdrant/js-client-rest` client chỉ được tạo trong `src/qdrant/create-qdrant-connection.js` và được giữ private. Mọi operation database đi qua `connection.execute()`. Architecture test sẽ fail nếu raw SDK construction xuất hiện lại ở controller/service/seed.

`ensureCollection()` được thiết kế retry-safe: nếu request create đã thành công nhưng response bị mất, lần retry gặp “already exists” được coi là idempotent success cho collection/index đã mong muốn.

## Health và readiness

`/health`: Hono process đang sống.

`/ready`: Qdrant probe + embedding health. Output chỉ chứa provider/status/http code/transport code/latency; không có endpoint credential hay raw secret.

Seed CLI gọi `waitUntilReady()` trước collection operations, sau đó toàn bộ create/query/upsert/retrieve/stats dùng cùng selected connection.

## Ví dụ

Local:

```bash
QDRANT_PROVIDER=local QDRANT_LOCAL_URL=http://127.0.0.1:6333 npm start
```

Beam:

```bash
QDRANT_PROVIDER=beam \
QDRANT_BEAM_URL='https://86ceecc1-a8a1-4623-aa06-387112d104e1-6333.app.beam.cloud' \
QDRANT_BEAM_API_KEY='...' npm start
```

Modal:

```bash
QDRANT_PROVIDER=modal \
QDRANT_MODAL_URL='https://bsmith888--qnp-qdrant-single-qdrantserver.us-east.modal.direct' \
QDRANT_MODAL_API_KEY='...' npm start
```

Hai URL chỉ là example từ deployment validation, không phải default hard-code của source.

## Cổng tương thích khi seed

`seed:public` không còn xem việc upsert UUID deterministic là đủ để bảo đảm idempotency. Trước public-dataset build tốn thời gian, non-dry-run `seed:public` kiểm tra trước embedding compatibility cùng Qdrant readiness/schema, rồi kiểm tra lại ngay trước seed-state verification và embedding. Trước khi ghi point, pipeline:

1. xác minh embedding service dùng đúng model/dimension và khai báo runtime semantic thật; public seed từ chối mock/runtime chưa xác minh;
2. xác minh Qdrant collection dùng unnamed vector đúng dimension và Cosine distance;
3. tạo/xác minh đúng kiểu của toàn bộ payload index, bao gồm `index_fingerprint: keyword`;
4. tính fingerprint v2 từ tập entity cuối cùng cùng embedding model/version, embedding-text version và runtime provenance;
5. ưu tiên exact count của Qdrant cho tổng/fingerprint state; nếu strict mode cấm exact search thì tự đếm chính xác bằng bounded paginated scroll, tắt vector và chỉ lấy `index_fingerprint`.

Scroll fallback tôn trọng `strict_mode_config.max_query_limit`, nên seed workflow không yêu cầu tắt Qdrant strict mode. Collection rỗng là `fresh`. Collection dở dang nhưng chỉ chứa cùng fingerprint là `resume`. Nếu đã đủ point với đúng fingerprint thì là `idempotent` và bỏ qua embedding/upsert. Chỉ cần có fingerprint khác hoặc số point dư bất thường thì pipeline fail closed. Mặc định không tự xóa dữ liệu; migration nên dùng collection mới hoặc workflow reset explicit.


### Audit provenance của semantic index

Sau khi seed real, `npm run verify:semantic-index -- 20000` audit read-only theo trang trên collection được cấu hình. Lệnh chỉ lấy `embedding_backend`, `embedding_implementation`, `embedding_semantic` (không lấy vector), tôn trọng query limit của strict mode, và fail nếu bất kỳ point nào không khớp runtime semantic đang được xác minh. Collection seed trước fingerprint v2 không có bằng chứng này và phải xem là chưa xác minh khi đánh giá semantic quality.

## Curl có authentication và theo dõi seed

Node.js SDK truyền API key của profile đã chọn qua `QdrantClient({ apiKey })`. Với `curl` trực tiếp, phải truyền key bằng header `api-key`; không đưa key vào URL:

```bash
curl -fsS \
  -H "api-key: $QDRANT_API_KEY" \
  "$QDRANT_URL/collections/$QDRANT_COLLECTION" \
  | jq .
```

Để theo dõi seed/import, nên dùng helper của repository. Helper ưu tiên `QDRANT_<PROVIDER>_URL` / `QDRANT_<PROVIDER>_API_KEY`, sau đó mới dùng biến generic, và không in credential:

```bash
npm run seed:status -- --expected 20000 --interval 5
```

`--once` chỉ gọi một lần rồi thoát. Chế độ mặc định theo dõi lặp lại mỗi 5 giây.

Các lệnh seed cũng ghi progress có throttle vào:

```text
reports/seed-progress.json
reports/seed-progress.jsonl
```

Mỗi lần chạy có `seedRunId` riêng. Mỗi record có stage, batch, số entity đã embed/upsert, phần trăm, tốc độ entity/giây, ETA, tổng thời gian embedding và tổng thời gian upsert Qdrant. Nếu embedding/Qdrant lỗi giữa chừng, `stage=failed` giữ lại counters cuối cùng để điều tra.
