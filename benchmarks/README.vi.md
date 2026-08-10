# Benchmark truy xuất ngữ nghĩa
> 🌐 Language / Ngôn ngữ: [English](README.md) | **Tiếng Việt**

Các bộ dữ liệu benchmark đã được commit phục vụ hai mục đích khác nhau và không được hợp nhất hoặc viết lại tại chỗ.

## Baseline chuẩn: `bilingual.json`

Đây là 30 truy vấn EN/VI benchmark ban đầu được sử dụng để so sánh lịch sử trực tiếp với E5 baseline. Giữ nó không thay đổi để việc so sánh giữa mô hình với mô hình vẫn có thể lặp lại được.

Chạy nó với:

```bash
BENCHMARK_OUTPUT='reports/qwen3-4b-v1-20k-benchmark.json' npm run benchmark
```

## Bộ hardening: `bilingual-hard-v2.json`

Bộ phần mềm này chứa 100 queries. Đây là một bộ tính năng mạnh mẽ xung quanh 15 thực thể thực tế cơ bản về quốc gia/thành phố đã được xác minh từ canonical benchmark; nó cố tình không yêu cầu phạm vi bảo hiểm thực thể rộng hơn.


- 50 tiếng Anh và 50 tiếng Việt;
- 80 địa lý có thể trả lời queries;
- 20 queries không có câu trả lời rõ ràng/ngoài miền;
- diễn giải, quan hệ ngầm, phủ định kiểu thực thể cứng, đầu vào nhiễu, code-switching, lỗi chính tả, tiếng Việt không dấu, bí danh và queries được nén.

Người đánh giá luôn requests raw top 5 candidates với `score_threshold=0`. Điều này giữ cho bằng chứng xếp hạng còn nguyên vẹn. Nếu API xuất bản ngưỡng mặc định, báo cáo cũng đánh giá ngưỡng đó ngoại tuyến mà không thay đổi truy xuất request.

Chạy:

```bash
BENCHMARK_OUTPUT='reports/qwen3-4b-v1-20k-hard-v2.json' npm run benchmark:hard
```

Báo cáo cho biết thêm:

- `answerableCases` / `noAnswerCases`;
- MRR và Recall@K chỉ dành cho những trường hợp có thể trả lời được;
- chất lượng theo ngôn ngữ, thể loại và thách thức;
- mỗi truy vấn `top1Top2Margin` và `rankingMargins` tổng hợp;
- `decisionQuality` ở ngưỡng tìm kiếm được định cấu hình/mặc định;
- phân tích latency tương tự được sử dụng bởi canonical benchmark.

## Hiệu chỉnh ngưỡng

Sau benchmark cứng, quét các ngưỡng từ 0,30 đến 0,70 mà không cần nhúng lại hoặc gọi lại Qdrant:

```bash
npm run benchmark:calibrate-threshold -- reports/qwen3-4b-v1-20k-hard-v2.json
```

Theo mặc định điều này viết:

```text
reports/qwen3-4b-v1-20k-hard-v2-threshold-calibration.json
```

Ngưỡng được đề xuất trước tiên sẽ tối đa hóa `decisionAccuracy` nghiêm ngặt từ đầu đến cuối. Một trường hợp tích cực chỉ được tính đúng khi thực thể top 1 còn sống sót là ID dự kiến; trường hợp không có câu trả lời chỉ được tính đúng khi không có candidate nào vượt qua ngưỡng. Các mối quan hệ được giải quyết bằng khả năng trả lời F1, độ chính xác top 1, độ chính xác không có câu trả lời, sau đó là ngưỡng dưới.

Không thay đổi ngưỡng production của API cho đến khi có báo cáo hiệu chuẩn điểm chuẩn cứng thực sự.

## Tập trung `embedding_text` v1 so với v2 A/B

Sau khi Hard v2 tạo ra một báo cáo thực, hãy so sánh cách trình bày tài liệu v1 và v2 mà không cần gieo hạt lại hoặc sửa đổi canonical Qdrant collection:

```bash
FOCUSED_AB_HARD_REPORT='reports/qwen3-4b-v1-20k-hard-v2.json' \
FOCUSED_AB_OUTPUT='reports/qwen3-4b-text-v1-v2-focused-ab.json' \
npm run benchmark:text-ab 2>&1 | tee reports/qwen3-4b-text-v1-v2-focused-ab.log
```

Thí nghiệm này được cố tình cô lập:

- model được cố định thành `Qwen/Qwen3-Embedding-4B`, kích thước 2560, CUDA FP16;
- Chiến lược/lệnh query phải giữ nguyên `prompt` / `geo-retrieval-v1:d014d3ec6df87e49`;
- chiến lược tài liệu vẫn là `raw`;
- các chuỗi Hard v2 query đã cam kết được truyền không thay đổi;
- mỗi query được nhúng một lần và query vector giống nhau được sử dụng lại cho cả hai biến thể tài liệu;
- ID candidate giống hệt nhau cho v1 và v2;
- candidates chứa tất cả các thực thể dự kiến ​​đã được xác minh, các yếu tố phân tâm kết quả hàng đầu thực tế từ chín trường hợp Hard v2 không xếp hạng1 đã biết, sau đó các phần bổ sung quốc gia/thành phố có liên quan xác định lên tới 75 tài liệu theo mặc định;
- xếp hạng là độ tương tự cosine cục bộ, do đó thử nghiệm không bao giờ ghi vào Qdrant và không thể ghi đè `knowledge_entities_qwen3_4b_v1`.

Đầu ra:

```text
reports/qwen3-4b-text-v1-v2-focused-ab.json
reports/qwen3-4b-text-v1-v2-focused-ab.log
reports/qwen3-4b-text-v1-v2-focused-candidate-texts.json
reports/qwen3-4b-text-v1-v2-focused-candidate-manifest.json
```

Báo cáo so sánh v1/v2/delta cho MRR và Recall@1/3/5 tổng thể cũng như theo ngôn ngữ/danh mục/thử thách, đồng thời ghi lại `expectedRank`, `top1Top2Margin` và `targetVsBestDistractorMargin` cho mỗi query. Ba trường hợp `no-diacritics` vẫn nằm trong bằng chứng nhưng được gắn cờ riêng vì chúng chủ yếu là giả thuyết về độ chắc chắn của phía truy vấn chứ không phải là bằng chứng ủng hộ hoặc chống lại văn bản-tài liệu v2.


## `embedding_text` v1 tập trung so với v2.1 A/B

Kết quả v2 cho thấy sự đánh đổi hữu ích nhưng không cân bằng: khả năng truy xuất quốc gia/phủ định cứng được cải thiện, trong khi một số thành phố thủ đô queries đã đúng lại bị thụt lùi do tài liệu quốc gia sử dụng câu quan hệ quá gần với thành phố query. v2.1 chỉ thay đổi cách diễn đạt chữ quốc gia và giữ nguyên văn bản tài liệu thủ đô giống hệt với v2.

Ví dụ về quan hệ quốc gia:

```text
v2:   The capital city of Japan is Tokyo.
v2.1: Japan has Tokyo as its capital.
```

Chạy thử nghiệm tiếp theo dựa trên cùng một báo cáo Hard v2 và cùng một cách xây dựng 75 ứng cử viên xác định:

```bash
FOCUSED_AB_HARD_REPORT='reports/qwen3-4b-v1-20k-hard-v2.json' \
FOCUSED_AB_OUTPUT='reports/qwen3-4b-text-v1-v21-focused-ab.json' \
npm run benchmark:text-ab-v21 2>&1 | tee reports/qwen3-4b-text-v1-v21-focused-ab.log
```

Đầu ra mặc định:

```text
reports/qwen3-4b-text-v1-v21-focused-ab.json
reports/qwen3-4b-text-v1-v21-focused-ab.log
reports/qwen3-4b-text-v1-v21-focused-candidate-texts.json
reports/qwen3-4b-text-v1-v21-focused-candidate-manifest.json
```

Báo cáo bao gồm đánh giá fail-closed `acceptance`. v2.1 chỉ được chấp nhận khi tất cả những điều này đều phù hợp với thử nghiệm 80 truy vấn tập trung:

- `country-factual` Thu hồi@1 >= 0,95;
- `hard-negative` Thu hồi@1 >= 0,933333333333;
- `city-capital` Thu hồi@1 >= 0,916666666667;
- `compressed` Thu hồi@1 >= 0,80;
- `implicit-relation` Thu hồi@1 = 1,00;
- 0 queries xếp hạng #1 trong v1 sẽ tụt xuống dưới hạng #1 trong v2.1.

Việc vượt qua gate tập trung này là bằng chứng để tiếp tục xác nhận; bản thân nó không được phép ghi đè hoặc reseed canonical 20k v1 collection.

## Xác thực căng thẳng: `embedding_text` v1 so với v2.1 trên 500–1.000 candidates

PASS tập trung vào 75 ứng cử viên không phải là bằng chứng đầy đủ cho cuộc di cư 20 nghìn vì các địa phương và thành phố lớn chưa được nhìn thấy có thể trở thành những điểm tiêu cực mới. Đóng băng `embedding_text v2.1` và chỉ mở rộng vũ trụ candidate:

```bash
STRESS_AB_HARD_REPORT='reports/qwen3-4b-v1-20k-hard-v2.json' \
STRESS_AB_OUTPUT='reports/qwen3-4b-text-v1-v21-stress-ab.json' \
npm run benchmark:text-ab-v21-stress \
  2>&1 | tee reports/qwen3-4b-text-v1-v21-stress-ab.log
```

Bộ candidate căng thẳng mặc định là 750 tài liệu, với tối đa cứng là 1.000. Nó mang tính quyết định và đối nghịch hơn là một mẫu ngẫu nhiên. candidates bắt buộc là:

- mọi thực thể quốc gia trong bộ dữ liệu canonical;
- mọi thành phố có `facts.capital === true`;
- tất cả các thực thể dự kiến ​​​​benchmark;
- mọi kết quả cao nhất không mong đợi được quan sát thấy đối với các trường hợp Hard-v2 có thể trả lời.

Sau đó, trình xây dựng sẽ điền vào mục tiêu bằng candidates, các thành phố có dân số cao liên quan đến các quốc gia/khu vực dự kiến, các thành phố có dân số cao trên toàn cầu và cuối cùng là các phần bổ sung theo thứ tự ID xác định. Nó không đóng được nếu bộ bắt buộc vượt quá mức tối đa được cấu hình.

Đầu ra mặc định:

```text
reports/qwen3-4b-text-v1-v21-stress-ab.json
reports/qwen3-4b-text-v1-v21-stress-ab.log
reports/qwen3-4b-text-v1-v21-stress-candidate-texts.json
reports/qwen3-4b-text-v1-v21-stress-candidate-manifest.json
```

Ứng suất gate cố tình mạnh hơn gate được tập trung. v2.1 chỉ được chấp nhận để xem xét di chuyển 20k khi tất cả những điều sau đều đúng:

- tổng thể Recall@1 cải thiện so với v1 ít nhất 0,025;
- Recall@1 sau khi loại trừ `no-diacritics` cải thiện so với v1 ít nhất 0,020;
- `hard-negative` Recall@1 duy trì ít nhất 14/15;
- `city-capital`, `country-factual`, `compressed` và `implicit-relation` Recall@1 không hồi quy từ v1;
- không queries xếp hạng #1 trong v1 sẽ giảm xuống dưới xếp hạng #1 trong v2.1.

Tệp kê khai ghi lại số lượng nhóm nguồn, lý do bằng chứng chồng chéo và số lượng cấp được chọn loại trừ lẫn nhau để bằng chứng có thể hiển thị chính xác cách tập hợp candidate đối nghịch. Lệnh này không bao giờ ghi vào Qdrant và không sửa đổi `knowledge_entities_qwen3_4b_v1`.


## Collection A/B đầy đủ 20k: canonical v1 so với bóng v2.1

Sau khi `knowledge_entities_qwen3_4b_text_v21` được gieo hạt và xác minh ở mức 20.000/20.000 xuất xứ phù hợp, hãy so sánh trực tiếp với canonical v1 collection được bảo quản:

```bash
npm run benchmark:full20k-v21-ab \
  2>&1 | tee reports/qwen3-4b-text-v1-v21-full20k-collection-ab.log
```

collections mặc định và các đầu vào được cố định ở giai đoạn xác thực hiện tại:

```text
v1 collection:   knowledge_entities_qwen3_4b_v1
v2.1 collection: knowledge_entities_qwen3_4b_text_v21
query corpus:    benchmarks/queries/bilingual-hard-v2.json
dataset:         data/generated/entities.final.json
expected points: 20000
result limit:    5
rank probe:      100
```

Trước query đầu tiên, lệnh không đóng được trừ khi cả hai collections đều là `green`, sử dụng Cosine vector 2560 chiều không tên, chứa chính xác 20.000 điểm, mang xuất xứ ngữ nghĩa canonical Qwen runtime, mang `embedding_text_version` dự kiến và khớp với dấu vân tay chỉ mục được tính toán lại từ tập dữ liệu canonical hiện tại. Siêu dữ liệu vân tay canonical mặc định là `embeddingVersion=qwen3-4b-v1` và `datasetVersion=public-v1`.

Mỗi Hard-v2 query được nhúng chính xác một lần. Sau đó, đối tượng vector tương tự được gửi đến cả collection queries bằng `score_threshold=0`. 5 kết quả hàng đầu dẫn đến MRR/Recall@1/3/5, trong khi thăm dò xếp hạng rộng hơn ghi lại `expectedRank`, `top1Top2Margin` và `targetVsBestDistractorMargin` khi mục tiêu nằm trong cửa sổ thăm dò.

Báo cáo bao gồm:

- số liệu tổng thể, ngôn ngữ, danh mục và thách thức v1/v2.1/delta;
- so sánh 77 truy vấn không phải `no-diacritics`;
- chín trường hợp trọng tâm lịch sử không xếp hạng1;
- năm trường hợp sentinel quá thiên về quốc gia v2;
- phân phối điểm số cao nhất không có câu trả lời và đồng bằng điểm cho mỗi truy vấn để hiệu chỉnh ngưỡng sau này;
- kiểm tra chấp nhận đầy đủ 20k có thể đọc được bằng máy;
- cả kiểm tra collection/runtime và dấu vân tay chỉ mục dự kiến/đã xác minh.

gate đầy đủ 20k yêu cầu mức tăng Recall@1 tổng thể quan trọng và không có dấu phụ, không hồi quy ở mức độ phủ định cứng/city-capital/country-factual/compression/implicit-relation Recall@1, không có hồi quy v1-rank1 mới, tất cả v2.1 nhắm mục tiêu còn lại trong top 5 và tất cả năm sentinels còn lại xếp hạng #1. Điểm không trả lời chỉ là bằng chứng; lệnh này không thúc đẩy một ngưỡng.


## Sau khuyến mãi canonical v2.1 được chấp nhận thông qua Node công khai API

Sau khi hoàn tất quảng cáo canonical và A/B toàn bộ 20k trực tiếp, hãy chạy cột ngữ nghĩa cuối cùng thông qua ranh giới ứng dụng thay vì trực tiếp với Qdrant:

```bash
npm run acceptance:post-promotion-v21-api
```

Bộ chấp nhận được cố ý thu gọn và sử dụng lại văn bản Hard-v2 đã cam kết chính xác. Nó chứa mười trường hợp duy nhất: các cách diễn giải dễ dàng bằng tiếng Anh và tiếng Việt, tất cả năm trường hợp quá thiên về quốc gia v2 trong lịch sử sentinels, và cả ba trường hợp v2.1 xếp hạng-2 đã biết. Những trường hợp đó cũng đề cập đến những thách thức về âm cứng, nén và tiếng Việt không dấu.

POST requests ngữ nghĩa sử dụng rõ ràng `score_threshold=0` và `limit=5` để người chạy có thể quan sát hành vi xếp hạng #1/#2 mà không cần kiểm duyệt ngưỡng. Điều này **không** thay đổi chính sách production: preflight yêu cầu `/api/v1/info` báo cáo canonical `embedding_text=v2.1` và `searchDefaultScoreThreshold=0.55`. Nó cũng yêu cầu `/ready=true`, collection 20k màu xanh lá cây với tất cả 20k vectors được lập chỉ mục và Qwen3 CUDA/FP16 query runtime chính xác (`prompt`, `geo-retrieval-v1:d014d3ec6df87e49`, chiến lược tài liệu `raw`).

Việc chấp nhận không thành công nếu có bất kỳ lỗi request nào hoặc trả về không phải 200, ánh xạ response không chứa kết quả được ghi điểm cao nhất, thiếu thành phần thời gian, sentinel v2 không xếp hạng #1 hoặc trường hợp xếp hạng-2 đã biết rơi xuống dưới #2. Việc cải thiện trường hợp xếp hạng 2 đã biết lên số 1 được chấp nhận. Trình bao bọc phát ra JSON, nhật ký hoạt động kết hợp, tổng kiểm tra và gói bằng chứng zip trong `reports/`.

## Ngưỡng không có câu trả lời v2.1 mở rộng benchmark: Ngưỡng cứng v3

Sau khi đóng cột mốc API công khai canonical v2.1, ngưỡng công việc sẽ chuyển sang kho dữ liệu từ chối lớn hơn mà không cần mở lại model hoặc thiết kế biểu diễn. Kho văn bản đã cam kết là:

```text
benchmarks/queries/bilingual-hard-v3-threshold.json
```

Nó mở rộng Hard-v2 byte-for-byte thành 100 trường hợp đầu tiên, sau đó thêm 100 trường hợp không có câu trả lời rõ ràng mới:

```text
200 total
80 answerable
120 no-answer
```

100 bổ sung được cân bằng 50 tiếng Anh / 50 tiếng Việt và được chia thành mười lớp đối kháng, mỗi lớp có mười queries:

```text
lexical-collision
entity-name-collision
wrong-relation-type
contradictory-geography
plausible-absent-entity
science
software-technology
sports
commercial-product
finance-legal
```

Kho dữ liệu SHA-256 bị khóa bởi người chạy. Không viết lại queries tại chỗ; tạo một phiên bản kho văn bản mới nếu ngữ nghĩa benchmark thay đổi.

Chạy toàn bộ luồng bằng chứng trên ngăn xếp canonical trực tiếp:

```bash
npm run benchmark:expanded-v21-threshold
```

Trình bao bọc trước tiên xác minh cấu hình canonical, nguồn gốc ngữ nghĩa 20.000/20.000 và trạng thái Qdrant màu xanh lục/được lập chỉ mục. Sau đó nó thực hiện tất cả 200 requests ngữ nghĩa thông qua:

```text
POST /api/v1/search
```

Requests chỉ sử dụng `score_threshold=0` và `limit=5` để thu thập bằng chứng xếp hạng/điểm số không bị kiểm duyệt. runtime trực tiếp vẫn phải báo cáo ngưỡng production `0.55` trong quá trình chiếu trước.

Giai đoạn collection viết:

```text
reports/expanded-noanswer-v21-api.json
```

Nó phải bảo toàn baseline v2.1 có 80 câu trả lời đã biết trong khi coi điểm không có câu trả lời là bằng chứng chẩn đoán chứ không phải là tình trạng lỗi thực thi. Đặc biệt, không có hồi quy cấp 1 mới có thể trả lời nào được chấp nhận, ba trường hợp cấp 2 phiên bản 2.1 đã biết có thể vẫn ở cấp độ #2 hoặc cải thiện lên #1 và tất cả các mục tiêu có thể trả lời phải nằm ở top 5.

Giai đoạn hiệu chỉnh hoàn toàn ngoại tuyến và ghi:

```text
reports/expanded-v21-threshold-calibration.json
```

Nó đánh giá các ngưỡng cố định `0.50`, `0.51`, `0.53` và `0.55`, báo cáo ID trường hợp dương tính giả/âm tính giả, tỷ lệ dương tính giả với khoảng Wilson 95% và dương tính giả được nhóm theo thử thách đối thủ.

Production **không** được thay đổi tự động. Chính sách quyết định mang tính bảo thủ có chủ ý:

- chỉ đề xuất `0.53` nếu nó phục hồi các trường hợp có thể trả lời được mà `0.55` từ chối và không làm trầm trọng thêm các kết quả dương tính giả đối nghịch;
- giữ lại `0.55` khi việc hạ thấp không mang lại lợi ích thu hồi có thể đo lường được;
- giữ lại `0.55` và điều tra các lớp dương tính giả khi âm tính đối nghịch vẫn vượt qua `0.55`.

Do đó, benchmark này trả lời một câu hỏi khác với tác phẩm A/B đại diện trước đó: liệu ngưỡng có khả năng trả lời thấp hơn có hợp lý hay không sau khi bản thân truy xuất canonical v2.1 đã được chấp nhận.
