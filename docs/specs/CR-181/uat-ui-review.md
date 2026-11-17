# CR-181 · Soát UI bằng trình duyệt thật (bản test, công ty Demo)

Ngày 2026-11-18 · https://app-test.evoluconsulting.com · Playwright (chromium, 1 trình duyệt) · 3 vai: `cuong.le` (sale), `binh.tran` (trưởng phòng), `demo-owner` (giám đốc).
Ảnh: `D:\AI\ai-system\.data\uat-cr181\` (mỗi màn có `-1440.png` và `-390.png`; đo tràn ngang và nút < 44px ghi ở `metrics-s*.json`). Script: `D:\AI\ai-system\.data\uat-cr181\scripts\`.
Không sửa code, không commit. Dữ liệu ghi trên HĐ mẫu của Demo: sale/trưởng phòng/giám đốc đã tạo chữ ký, HĐ mẫu đã chuyển sang «Đang duyệt», trưởng phòng đã ký (7 chữ ký) và Đạt; bước Ký đang chờ.

## Kết quả theo kịch bản
| Mã | Kết quả |
|---|---|
| K01 tạo chữ ký lần đầu (cả 3 người) | Đạt (không có «Làm sau», tạo xong vào được) |
| K02 HĐ mẫu | Một phần: cả hai tệp để «Cần ký» TẮT (kịch bản nói hợp đồng mặc định «Cần ký») |
| K03 chuẩn bị chỗ ký, Tự đặt | Một phần: chỉ ra 1 chỗ (Bên A), không có Bên B; ô đè chữ |
| K04 Gửi duyệt | Đạt, nhưng trang HĐ sau khi gửi không nói rõ «chờ Trưởng phòng» ở phần đầu trang |
| K05–K06 trưởng phòng: kéo từ khay, giáp lai, chuột phải, chép mọi trang, Lưu, Đạt | Đạt (7 chữ ký, 1 giáp lai, 6 trang; Đạt bị khoá tới khi ký) |
| K07 giám đốc ký | KHÔNG ĐẠT, chặn (lỗi 1 bên dưới) |
| K08 Xem bản đã ký (sale) | Đạt (chọn bản, danh sách chữ ký, Tải về, chỉ đọc); chỉ soi được bản sau trưởng phòng |
| K09 Hồ sơ duyệt | Đạt cho bước trưởng phòng (tên, thời điểm, ý kiến, «1 tệp đã ký»); chưa có bước giám đốc |
| K10 Cài đặt › Chữ ký (quản trị) | CHƯA SOÁT ĐƯỢC (không tìm thấy lối vào, xem lỗi 6) |
| «Chữ ký của tôi» | Đạt (1440 và 390 đều gọn, nút lớn) |
| K11 Trả lại | Chưa chạy |
| M01–M04 | Chỉ chụp 390px từng màn; chưa thao tác cảm ứng thật (xem Giới hạn) |

## Bảng lỗi
| # | Màn | Mức | Mô tả | Ảnh | Đề xuất sửa |
|---|---|---|---|---|---|
| 1 | Giám đốc › Ký hợp đồng (K07) | Cao | `demo-owner` (Giám đốc, Toàn quyền) mở `/contracts/sign/<id>` chỉ thấy «Bạn chưa đến lượt ký hoặc không có quyền ký hợp đồng này», dù bước Ký đã «Đang chờ ký» và trưởng phòng đã Đạt. Trang HĐ của ông chỉ có khối «Ký số / Tải lên bản đã ký» (đường cũ), KHÔNG có thẻ «Mở và ký». Tổng quan ghi «Chờ bạn: 0 ký · 3 duyệt». Thiếu: người trong nhóm `nguoi-ky-hd` không gồm demo-owner (lỗi seed?) hoặc điều kiện «đến lượt» sai. Không có câu nói rõ AI là người ký. | `29-FAIL-ky-1440.png`, `28-gd-K07-hd-cho-ky-1440.png` | Điều phối kiểm nhóm ký của seed `--sign-only` (kịch bản nói người ký = Giám đốc = demo-owner). Màn từ chối nên nêu tên nhóm/người đang được chờ ký. Cần chạy lại K07, K09 bước giám đốc, M02 sau khi sửa. |
| 2 | HĐ › bước Ký | Cao | Bước «Ký hợp đồng · Đang chờ ký · Người ký: Người ký HĐ» chỉ ghi tên vai/nhóm, không ghi tên người; sale và trưởng phòng không biết ai ký tiếp. Chỗ ký hiện «Chờ Đại diện Người ký HĐ ký» ở cả màn ký của trưởng phòng và bản đã ký. | `28-…-1440.png`, `34-sale-M03-viewer-390.png` | Ghi «Chờ Nguyễn Văn An (Giám đốc) ký». |
| 3 | HĐ › Phần đầu (sale, giám đốc) | Trung | Khối «Ký số · Tải lên bản đã ký» (ký ngoài) nằm trên cùng, nhãn «Ký số» lẫn với «Chữ ký số» đã chốt là chứng thư số; dễ nhầm với ký trên tài liệu. | `28-gd-K07-hd-cho-ky-1440.png` | Đổi nhãn khối («Đã ký bên ngoài?») và đẩy xuống sau nút Mở và ký. |
| 4 | Chuẩn bị chỗ ký | Trung | «Tự đặt theo ĐẠI DIỆN BÊN A/B» chỉ đặt 1 chỗ (Bên A); không có chỗ Bên B (đối tác Evolu có email) dù kịch bản/ nghiệp vụ nói cả hai; dải người ký chỉ có «Bên A». Ô ký bắt đầu đè lên dòng «(Ký, ghi rõ họ tên)» và nhãn ô đè chữ «ĐẠI DIỆN BÊN A». | `09-sale-K03-trang-cuoi-1440.png`, `08-…-390.png` | Đặt ô ngay dưới dòng chú thích; nhãn đặt ngoài ô. Nếu Bên B chưa có người ký, nói rõ «Bên B chưa có người ký, thêm ở…». |
| 5 | Màn ký/chuẩn bị (mọi vai) | Trung | Cột trang nhỏ bên trái bị cắt: chỉ thấy khoảng 1/3 chiều ngang trang; khó nhận trang. | `08-…-1440.png`, `16-head-K06-man-ky-1440.png` | Co ảnh thu nhỏ vừa khung. |
| 6 | Cài đặt › Chữ ký (K10) | Trung (chưa xác minh) | Không vào được: `/contracts/settings?sec=signature` (đích chuông «Xin đổi chữ ký») chuyển về Tổng quan; `/contracts/settings/signature` cũng về Tổng quan; trang Cài đặt hiện là «Thành viên & phòng ban» và không thấy mục «Chữ ký». Chưa xác minh được công tắc «Ký trên tài liệu», ô chữ ký số khoá. | `35-gd-K10-cai-dat-chu-ky-1440.png` | Kiểm lối vào mục Chữ ký; sửa đích chuyển hướng. |
| 7 | Hợp đồng nháp › Tài liệu kèm | Trung | Hợp đồng mặc định «Cần ký» TẮT (kịch bản K02 nói bật sẵn). Dòng «File ký: chưa có» luôn hiện kể cả sau khi đã đặt chỗ ký. Nhãn «Cần ký» ở phụ lục kèm «— Tham khảo» trái nghĩa nhau; sau Gửi duyệt cả hai nút «Cần ký» vẫn nhìn như bật được nhưng khoá, không nói lý do. Hai thông báo trùng («Chưa có tệp nào cần ký» và «Có ít nhất một tệp cần ký ✗»). | `06-sale-K02-hd-mau-1440.png`, `12-sale-K04-sau-gui-duyet-1440.png` | Bỏ dòng trùng, thêm nhãn «Chờ ký / Đã ký / Tham khảo» thay công tắc khi khoá. |
| 8 | HĐ đang duyệt (trưởng phòng) | Thấp | Chữ lặp «Đang chờ Trưởng phòng duyệt duyệt». Nút mở ý kiến tên «Duyệt» còn kịch bản/nghiệp vụ dùng «Đạt»; khung ý kiến sát viền, không có lề. | `14-head-K05-hd-dang-duyet-1440.png`, `15-head-K06-hop-duyet-chua-ky-1440.png` | Sửa chuỗi, thống nhất «Đạt», thêm padding. |
| 9 | Màn ký (trưởng phòng) | Thấp | Chưa ký xong thì nút «Lưu» mờ không nói lý do; khay chỉ có «Chữ ký của tôi», không có lời nhắc «Kéo vào tài liệu hoặc bấm chuột phải» (thao tác ẩn). Nhãn «Giáp lai 2 trang: 1, 2» bị thanh công cụ che nửa. Dòng «Chờ Đại diện Người ký HĐ ký» trong màn ký của người duyệt gây hiểu lầm. | `16-…-1440.png`, `18-head-K06-giap-lai-1440.png` | Thêm gợi ý một dòng, tooltip cho Lưu. |
| 10 | Mobile 390 · các màn | Thấp | Nút nhỏ hơn 44px: công tắc «Cần ký» (24px), nút «Đóng» trong hộp «Đã lưu chỗ ký» (16px), Sáng/Tối/VI/EN trong menu người dùng (26px). Màn HĐ: mục «Các mốc thực hiện» bị bóp (tiêu đề xuống 2 dòng, ngày vỡ nhiều dòng, nút lớn chiếm chỗ). Hộp xác nhận lưu ở 390: nhãn chỗ ký đè chữ trên trang thu nhỏ. Hộp chữ ký ở 390 vẫn tràn ngang 0px (tốt). | `10-sale-K03-sau-luu-cho-ky-390.png`, `31-gd-K09-ho-so-duyet-mo-390.png`, `23-head-K06-xac-nhan-luu-390.png`, `metrics-*.json` | Tăng vùng chạm, xếp mốc thành thẻ dọc. |
| 11 | Xem bản đã ký (390 và 1440) | Thấp | Ô chọn bản xuống 2 dòng («Sau khi Trần Thị Bình ký · 05:35 18/11/26»); nút nổi «Chữ ký trong bản này» che chữ trang; tab tệp có nhãn «Chưa ký» cho cả tệp đã có chữ ký trưởng phòng (đang chờ giám đốc, nên «Chưa ký» dễ hiểu sai là chưa ai ký). | `33/34-…-390.png` | Dùng «Đang ký 1/2». |
| 12 | Trang HĐ đang duyệt | Thấp | Sau Đạt: dòng «Đã gửi duyệt. Đang giao cho người duyệt kế tiếp…» xuất hiện cho cả người duyệt không phải người gửi; khối «Giao hàng / Xác nhận đã giao» hiện nút hành động khi HĐ còn đang duyệt, lẫn với việc ký. Ngoài phạm vi CR-181, ghi nhận. | `26-head-K06-sau-dat-1440.png` | Ẩn mốc thực hiện tới khi HĐ đã ký. |

Tổng: Cao 2 · Trung 5 · Thấp 5.

## Tốt (đã xác minh)
- Màn «Tạo chữ ký của bạn» gọn, không có «Làm sau», không tràn ở 390.
- Màn ký: kéo từ khay, chuột phải «Thêm chữ ký của tôi ở đây», giáp lai hít qua khe, «Chép sang mọi trang», hộp «Lưu chữ ký? 7 chữ ký, 1 giáp lai, trên 6 trang. Sau khi lưu không sửa được; bản gốc vẫn giữ» đều chạy.
- «Đạt» khoá khi chưa ký, mở sau khi ký.
- Xem bản đã ký: Bản gốc + bản sau trưởng phòng, 7 chữ ký bấm nhảy tới trang, «Chờ ký còn chờ», Tải về.
- Hồ sơ duyệt: ý kiến, thời điểm, «1 tệp đã ký», «Xem».

## Giới hạn của lần chạy
- Chưa kiểm: chữ ký in trên PDF tải về (chỉ xem bản trong trình xem; giáp lai khớp hai trang chưa đối chiếu ở PDF), bước giám đốc (bị chặn bởi lỗi 1), Cài đặt › Chữ ký (lỗi 6), K11 Trả lại.
- 390px: chỉ đổi cỡ cửa sổ chụp ảnh, không thao tác cảm ứng thật (chạm giữ mở menu M04, ngăn kéo chọn chữ ký M01, kéo bằng ngón tay M04 chưa thử). Số đo «nút < 44px» chỉ tính phần tử trong màn hình đầu.
- Chạy 1 lần; HĐ mẫu đã rời Nháp nên muốn chạy lại cần HĐ Kinh doanh mới dưới 100 triệu.
