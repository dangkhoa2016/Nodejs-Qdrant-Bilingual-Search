# Cấp phép dữ liệu và xuất xứ
> 🌐 Language / Ngôn ngữ: [English](LICENSE-DATA.md) | **Tiếng Việt**

Mã ứng dụng và dữ liệu được tạo có mối quan tâm cấp phép riêng biệt. Mọi thực thể được chuẩn hóa đều giữ nguồn gốc thông qua `source`, `sourceId` và `sourceRefs`.

## Nguồn GeoNames

GeoNames là xương sống địa lý canonical. GeoNames xuất bản công báo của mình theo **Creative Commons Attribution 4.0 (CC BY 4.0)**.

Dự án sử dụng `cities15000.zip`, `countryInfo.txt`, `admin1CodesASCII.txt` và `alternateNamesV2.zip`. releases công khai hoặc các cuộc trình diễn được tổ chức để phân phối lại hoặc tiết lộ dữ liệu GeoNames phái sinh phải giữ lại thuộc tính GeoNames thích hợp và tham chiếu đến CC BY 4.0.

## Nguồn Who's On First

Who's On First là tính năng làm giàu đa ngôn ngữ tùy chọn. Tài liệu của WOF nêu rõ rằng nên ghi công cho Who's On First và bắt buộc phải liên kết trở lại **Giấy phép Who's On First**. WOF vừa là tác phẩm gốc vừa là bản sửa đổi/tổng ​​hợp của nhiều nguồn dữ liệu mở và một số nguồn thành phần yêu cầu ghi công riêng của chúng.

Do đó, việc phân phối lại công khai các tên/bí danh có nguồn gốc từ WOF phải bao gồm:

- tín dụng “Dữ liệu từ Who's On First”;
- một liên kết/tham chiếu đến Giấy phép Who's On First;
- thông tin thuộc tính/nguồn WOF có liên quan cho dữ liệu được phân phối snapshot.

Tệp kê khai bản dựng ghi lại các URL lưu trữ WOF và các giá trị SHA-256 để có thể xác định chính xác phần phong phú được tải xuống snapshot.

## Tiếng Việt do máy tạo ra

Dịch máy là tính năng làm giàu được tạo tùy chọn. Nó không bao giờ được trình bày dưới dạng dữ liệu GeoNames hoặc WOF gốc. Các trường được tạo được đánh dấu là `machine_translation` và giữ lại siêu dữ liệu provider/model/prompt/lingu/source-hash/version.

Thông tin đăng nhập trên đám mây và tên vị trí khóa API không bao giờ được nhúng vào nguồn gốc của tập dữ liệu.

## Khả năng tái tạo

Các nguồn công cộng phát triển. Để có khả năng tái tạo benchmark/release nghiêm ngặt, hãy lưu trữ tập dữ liệu đã tạo cùng với đầu vào GeoNames và kho lưu trữ WOF được lưu trong bộ nhớ đệm được sử dụng cho release đó. Các giá trị SHA-256 của kho lưu trữ WOF được phát ra trong tệp kê khai tập dữ liệu.
