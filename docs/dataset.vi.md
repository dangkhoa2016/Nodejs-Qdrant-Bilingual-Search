# Pipeline dữ liệu công khai
> 🌐 Language / Ngôn ngữ: [English](dataset.md) | **Tiếng Việt**

Bản dựng công khai sử dụng **GeoNames `cities15000` làm xương sống địa lý canonical** và **Who's On First (WOF) làm nội dung đa ngôn ngữ tùy chọn**. Wikidata không nằm trong đường dẫn nhập công khai.

## Xương sống GeoNames

GeoNames cung cấp danh tính ứng dụng canonical và thông tin địa lý. GeoNames xuất bản công báo theo **CC BY 4.0**. ID thành phố vẫn còn:

```text
geonames:city:<geonameid>
geonames:country:<geonameid>
```

Trình xây dựng đọc `cities15000.zip`, `countryInfo.txt`, `admin1CodesASCII.txt`, sau đó chỉ truyền `alternateNamesV2.zip` cho các thực thể tồn tại trong lựa chọn đại diện xác định. Tên thay thế `en`/`vi` rõ ràng có thể thay thế tên dự phòng GeoNames không được gắn thẻ. Các tên thay thế được gắn thẻ tiếng Việt vẫn giữ nguyên chuẩn hóa kế thừa hẹp `Ð/ð → Đ/đ`.

GeoNames không hoạt động nhanh đối với UTF-8 không đúng định dạng, ký tự thay thế, hình dạng hàng không hợp lệ, tọa độ không hợp lệ và ID không hợp lệ. QA địa lý vẫn từ chối bộ dữ liệu thành phố lớn mất Bắc hoặc Nam Mỹ.

## Làm giàu Who's On First

WOF là **nguồn làm giàu có nỗ lực cao nhất**, không bao giờ là nguồn địa lý canonical. Các bản tải xuống hiện tại là kho lưu trữ GeoJSON `tar.bz2` của địa phương và quốc gia toàn cầu do Geocode Earth xuất bản.

WOF chỉ được nối bởi sự phù hợp chính GeoNames duy nhất `wof:concordances["gn:id"]`. Sự phù hợp thay thế và các trường `gn:geonameid` đã nhập không bao giờ là danh tính canonical và các bản ghi có nhiều ID GeoNames chính sẽ bị cách ly. Không có sự trùng khớp tên mờ. Các loại địa điểm được chấp nhận là:

- canonical `city` → WOF `locality`;
- canonical `country` → WOF `country` hoặc `dependency`.

Ưu tiên tiếng Anh là tên ưa thích WOF > tiếng Anh GeoNames rõ ràng > dự phòng GeoNames. Ưu tiên tiếng Việt là rõ ràng GeoNames Tiếng Việt > Tiếng Việt ưu tiên WOF > thiếu. Tên/bí danh WOF `vie` chứa `Ð/ð` kế thừa sẽ bị loại bỏ thay vì viết lại và các tên chính không được chọn sẽ được giữ lại làm bí danh. WOF chỉ đóng góp siêu dữ liệu ngôn ngữ/danh tính (`wofId`, loại địa điểm, tên, bí danh, `sourceRefs`); GeoNames tiếp tục sở hữu dân số, tọa độ, dữ liệu quốc gia/quản trị viên và múi giờ.

Nếu nhiều bản ghi WOF yêu cầu cùng một ID GeoNames hoặc một ID WOF yêu cầu nhiều thực thể GeoNames thì danh tính đó sẽ bị cách ly: bản ghi GeoNames được giữ nguyên và việc làm giàu WOF bị bỏ qua đối với bản ghi đó. Đường dẫn lưu trữ là bộ nhớ giới hạn: `bzip2` phát ra luồng TAR, trình đọc đóng khung một mục nhập GeoJSON tại một thời điểm, chỉ giải mã đối tượng `properties` của nó, từ chối các sự phù hợp GeoNames không liên quan trước `JSON.parse` và releases mục nhập thô trước khi tiếp tục. Hình học không bao giờ được giữ lại trong quá trình làm giàu candidates. Các bản ghi WOF có liên quan không đúng định dạng sẽ được tính và bỏ qua. Nếu không có một kho lưu trữ WOF, quá trình xây dựng sẽ tiếp tục với GeoNames và ghi lại trạng thái `partial`/`unavailable` trong tệp kê khai.

## Cache và độ tái lập

Theo mặc định, kho lưu trữ WOF được lưu trữ trong `data/cache/wof`. Tải xuống được ghi nguyên tử và SHA-256 được ghi trong `manifest.wofEnrichment.archives`. Chạy lại mà không có `--wof-refresh` sẽ sử dụng lại kho lưu trữ đã lưu trong bộ nhớ đệm.

```bash
npm run dataset:build -- \
  --sources geonames,wof \
  --types country,city \
  --limit 20000
```

Sử dụng cache tùy chỉnh hoặc buộc snapshot ngược dòng mới:

```bash
npm run dataset:build -- \
  --wof-cache-dir /path/to/wof-cache \
  --wof-refresh \
  --limit 20000
```

baseline chỉ dành cho GeoNames vẫn khả dụng:

```bash
npm run dataset:build -- --sources geonames --types city --limit 20000
```

## Bản kê khai v6

Tệp kê khai ghi lại số lượng nguồn, số lượng đã chọn, phạm vi địa lý/ngôn ngữ, tên tập dữ liệu GeoNames và chẩn đoán làm giàu WOF. `wofEnrichment` chứa trạng thái, số lượng được yêu cầu/khớp/không rõ ràng/không hợp lệ, bộ đếm lưu trữ `scanned` và `skippedUnmatched`, trạng thái theo loại, URL lưu trữ/tệp/SHA-256 và các mẫu không rõ ràng giới hạn. Trong quá trình quét thực, tiến trình stderr định kỳ bao gồm các bản ghi được quét, ID mục tiêu trùng khớp, số lượng bị bỏ qua/không hợp lệ, vùng heap, RSS và thời gian đã trôi qua.

`dataQuality.policy` là `geonames_fail_fast_wof_best_effort`: canonical GeoNames lỗi chất lượng vẫn nghiêm trọng trong khi các sự cố WOF tùy chọn không phá hủy tập dữ liệu hợp lệ. `dataQuality.checks` ghi lại các bất biến đầu ra cuối cùng cho các ID canonical trùng lặp, các tham chiếu nguồn trùng lặp và văn bản `Ð/ð` kế thừa tiếng Việt còn lại; sự chấp nhận yêu cầu cả ba bộ đếm đều bằng 0.

## Dịch thuật

Dịch máy vẫn là một giai đoạn tùy chọn riêng biệt. Thiếu tiếng Việt là hợp lệ. Tiếng Việt gốc GeoNames hoặc WOF không bao giờ bị ghi đè. Các giá trị được tạo được đánh dấu `machine_translation` bằng xuất xứ provider/model/prompt/source-hash/version.
