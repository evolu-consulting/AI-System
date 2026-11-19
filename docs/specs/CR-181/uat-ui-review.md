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

---

# Lượt 2 (bản `bbf2e922e`, 2026-11-18)

Ảnh lượt 2: `D:\AI\ai-system\.data\uat-cr181\` (số thứ tự 101 trở lên, tên `r2-*`; PDF tải về `ban-da-ky.pdf` và ảnh trang `pdf-trang-1..6.png`). Script: `scripts\r2a..r2k.mjs`. HĐ dùng: «HĐ mẫu · Ký trên tài liệu (CR-181) · 18/11» (sale `cuong.le` → `binh.tran` ký 7 chữ ký + Đạt → bước Ký chờ giám đốc). Không còn HĐ Nháp thứ hai nên K11 không chạy.

## Trạng thái 6 điểm vừa sửa
| Điểm | Kết quả | Ghi chú / ảnh |
|---|---|---|
| Giám đốc có «Mở và ký», hết khối ký số/tải lên cũ | CÒN (Cao) | `demo-owner` và cả `em.hoang` (cùng nhóm người ký) đều KHÔNG có «Mở và ký»; khối «Ký số · Tải lên bản đã ký» vẫn nằm trên cùng; `/contracts/sign/<id>` vẫn báo «Bạn chưa đến lượt ký hoặc không có quyền ký hợp đồng này». `110-r2-gd-hd-cho-ky-1440.png`, `112-r2-gd-sign-url-1440.png`, `114-r2-em-hd-cho-ky-1440.png` |
| Tên người ký hiện đích danh | ĐÃ HẾT một phần | Bước Ký ghi «Người ký HĐ: Em, An»; dải người ký «Em, An · Bên A». Là tên gọi cuối chứ chưa đủ họ tên, không nói chức danh (Thấp). |
| «Tự đặt» ra cả Bên A và Bên B, ô không đè chữ | CÒN (Trung) | Vẫn «Đã đặt 1 chỗ ký», dải chỉ có «Bên A», không có chỗ Bên B (đối tác đã có email). Ô giờ nằm dưới chữ nhưng nhãn «Đại diện Người ký HĐ» còn đè lên dòng «(Ký, ghi rõ họ tên)». `103-r2-sale-tu-dat-trang-cuoi-1440.png` |
| Cài đặt › Chữ ký có mục, quản trị sửa được (K10) | ĐÃ HẾT (phần xem) | Mục «Chữ ký» có trong hộp Cài đặt: công tắc «Ký trên tài liệu» bật, định dạng chữ ký nội bộ, xem trước, «Chữ ký số · Chưa bật» với nút «Bật chữ ký số» mờ. `121-r2-gd-K10-cai-dat-chu-ky-1440.png`. CHƯA thử lưu một thay đổi. Lối vào: ở 1440px tôi không mở được menu người dùng bằng cách bấm tên (menu chỉ mở được khi thu cửa sổ 390px) — cần người soát bằng tay xem ở 1440px có lối vào không. |
| Tệp chính mặc định «Cần ký» | ĐÃ HẾT | Công tắc bật sẵn, kèm nhãn «Hợp đồng chính», «Chưa đặt» khi chưa có chỗ ký. `101-r2-sale-hd-moi-1440.png` |
| Cột trang không bị cắt | ĐÃ HẾT | Ảnh thu nhỏ đủ ngang trang ở màn chuẩn bị/màn ký. `103-…-1440.png`, `107-r2-head-man-ky-1440.png` |

## Trạng thái lỗi lượt 1
| # | Lượt 1 | Lượt 2 |
|---|---|---|
| 1 | Giám đốc không ký được | CÒN (Cao), xem trên |
| 2 | Không nêu tên người ký | Đỡ hơn: có tên («Em, An», «Chờ Em, An ký»), chưa đủ họ tên/chức danh |
| 3 | Khối «Ký số / Tải lên» lẫn với chữ ký số | CÒN (Trung) với giám đốc và người ký |
| 4 | Tự đặt thiếu Bên B, ô đè chữ | CÒN một phần (còn thiếu Bên B và nhãn ô đè «(Ký, ghi rõ họ tên)») |
| 5 | Cột trang bị cắt | Hết |
| 6 | Cài đặt › Chữ ký | Hết (xem) |
| 7 | «Cần ký» mặc định tắt, «File ký: chưa có» | Hết phần mặc định và «File ký» (nay hiện tên tệp); CÒN thông báo trùng («Chưa có tệp nào cần ký…» và «Có ít nhất một tệp cần ký») và công tắc «Cần ký» khoá không giải thích sau khi Gửi duyệt (Thấp) |
| 8–9 | Chữ «duyệt duyệt», nút «Duyệt» vs «Đạt», gợi ý khay, nhãn giáp lai | Không kiểm lại kỹ; «Duyệt» vẫn là tên nút; chưa thấy gợi ý trong khay (Thấp, CÒN) |
| 10 | Mobile: nút < 44px | CÒN (Thấp): công tắc «Cần ký» 24px, nút «Đóng» hộp «Đã lưu chỗ ký» 16px, hộp Cài đặt 16–20px |
| 11–12 | Xem bản đã ký, mốc thực hiện | Không kiểm lại; mốc «Giao hàng/Thu tiền» vẫn hiện khi HĐ đang duyệt (Thấp, CÒN) |

## Lỗi mới
| # | Màn | Mức | Mô tả | Ảnh | Đề xuất |
|---|---|---|---|---|---|
| 13 | HĐ (trưởng phòng, giám đốc) | Trung | Ô «Phụ trách» của người khác ghi «(người đã nghỉ hoặc không xem được)» dù sale `cuong.le` vẫn đang làm việc (người duyệt không có quyền xem hồ sơ người). Bị hiểu là sale đã nghỉ. | `105-r2-sale-truoc-gui-1440.png` (lúc tải), nội dung chữ ở log `r2b` | Hiện tên (hoặc «Lê Minh Cường») cho người duyệt. |
| 14 | HĐ sau khi bấm Gửi duyệt/tải trang | Thấp | Khung «Tài liệu kèm» hiện thanh chờ trơ khoảng vài giây rồi mới ra danh sách, Phụ trách ghi «(người đã nghỉ…)» trong lúc chờ. | `105-…-1440.png` | Hiện khung chờ có chữ hoặc đừng hiện nhãn lỗi trong lúc tải. |
| 15 | Hộp Cài đặt › Chữ ký (390px) | Thấp | Nhiều nút 16–20px (< 44px). | `121-…-390.png`, `metrics-r2k.json` | Tăng vùng chạm. |

## Hành trình lượt 2
| Mã | Kết quả |
|---|---|
| Sale: bật Cần ký, Chuẩn bị chỗ ký, Tự đặt, Lưu chỗ ký, Gửi duyệt | Đạt (thiếu Bên B) |
| Trưởng phòng: kéo từ khay, giáp lai, chuột phải, chép mọi trang, Lưu (7 chữ ký, 1 giáp lai, 6 trang), Đạt | Đạt |
| K07 giám đốc «Mở và ký» và Lưu; M02 | KHÔNG ĐẠT, chặn lần 2 (lỗi Cao) nên chưa có bản sau giám đốc |
| K09 Hồ sơ duyệt | Không chạy lại (bước giám đốc chưa có); lượt 1 đã Đạt cho bước trưởng phòng |
| K08 Xem bản đã ký | Mở được và Tải về được (`ban-da-ky.pdf`, 6 trang, 146 KB); chỉ có bản sau trưởng phòng |
| PDF bản tải về (pdf.js, `pdf-trang-1.png` và `pdf-trang-2.png`) | Đạt: chữ ký trưởng phòng in rõ kèm «Trần Thị Bình · 18/11/2026»; ký giáp lai khớp hai trang: nửa trên chữ ký ở mép dưới trang 1, nửa dưới ở mép trên trang 2. Đã xem trang 1 và 2; trang 3–6 đã render, chưa soi từng trang. |
| K11 Trả lại | Không chạy (không có HĐ Nháp thứ hai) |

Tổng còn lại sau lượt 2: Cao 1 (giám đốc không ký được) · Trung 3 (khối ký số cũ; thiếu Bên B và nhãn đè chữ; «Phụ trách» ghi «đã nghỉ») · Thấp 6 trở lên (xem bảng).

Chưa soát lượt 2: bước giám đốc và bản cuối sau giám đốc (PDF cuối, giáp lai trên bản cuối), M02, K11, K10 lưu thay đổi và lối vào ở 1440px, cảm ứng thật ở 390px, Hồ sơ duyệt đủ hai bước, tab tệp nhiều tệp trong Xem bản đã ký.

---

# Lượt 3 (HĐ «… · 18/11 · bản 2», 2026-11-18)

Ảnh: `D:\AI\ai-system\.data\uat-cr181\` (số 201–223, tên `r3-*`; PDF cuối `ban-cuoi.pdf`, ảnh trang `cuoi-trang-1..6.png`). Script `scripts\r3a..r3d.mjs`. HĐ chạy đúng quy trình «Duyệt và ký hợp đồng (ký trên tài liệu)», đối tác «Công ty Evolu (UAT đối tác)» hiện ở dải người ký.

## Kết quả
| Mã | Kết quả |
|---|---|
| Sale: «Tự đặt» | ĐẠT: «Đã đặt 2 chỗ ký», Bên A (tím) và Bên B (cam) nằm dưới «ĐẠI DIỆN BÊN A/B». Ô không đè chữ; nhãn ô nhỏ vẫn chạm dòng «(Ký, ghi rõ họ tên)» ở Bên A (Thấp). `203-r3-sale-tu-dat-trang-cuoi-1440.png` |
| Gửi duyệt | ĐẠT (dải «Em, An · Bên A 1 chỗ ký», «Công ty Evolu · Bên B 1 chỗ ký») |
| Trưởng phòng: kéo khay, giáp lai, chuột phải, chép mọi trang, Lưu (7 chữ ký), Đạt | ĐẠT |
| K07 Giám đốc: có «Mở và ký», hết khối ký số/tải lên cũ khi đang chờ ký | ĐẠT (thẻ «Ký hợp đồng · đã ký 0/1 tệp · Mở và ký»). Bấm ô «Bấm để ký» (1 ô), Lưu, hộp «Lưu chữ ký? 1 chữ ký, 0 giáp lai, trên 1 trang». |
| M02 (390px): ký và Lưu | ĐẠT một phần: chạy được ở 390px, không tràn ngang; thanh «Chép sang mọi trang / Xoá» nổi che sát ô Bên B. Chưa thử cảm ứng thật. `214-r3-gd-xac-nhan-390.png`, `215-r3-gd-sau-luu-390.png` |
| K09 Hồ sơ duyệt | ĐẠT cho bước trưởng phòng (tên, giờ, «Chữ ký nội bộ · 1 tệp đã ký», ý kiến, «Xem»). Chưa thấy dòng riêng cho bước Ký của giám đốc (chỉ thấy 1 dòng trong khối đã mở). `218-r3-gd-K09-ho-so-duyet-1440.png` |
| Xem bản đã ký (sale) | ĐẠT: có bản «Sau khi Nguyễn Văn An ký · 06:44», danh sách chữ ký (ô Trang 6), «Chỗ ký còn chờ: Công ty Evolu (UAT đối tác) · Trang 6», Tải về được. `221-r3-sale-ban-cuoi-1440.png` |
| PDF bản cuối (`ban-cuoi.pdf`, 6 trang, 174 KB; render pdf.js) | ĐẠT: trang 6 chữ ký giám đốc «Nguyễn Văn An · 18/11/2026» đúng dưới «ĐẠI DIỆN BÊN A / (Ký, ghi rõ họ tên)»; trang 1–2: giáp lai của trưởng phòng khớp (nửa trên ở mép dưới trang 1, nửa dưới ở mép trên trang 2); trang 1, 2, 6 đã xem kỹ, trang 3–5 đã render, chưa xem từng trang. Chỗ Bên B còn trống (chờ đối tác, đợt 2). |
| K10 Cài đặt › Chữ ký (sửa + lưu) | ĐẠT: bật «Giờ ký», Lưu, tải lại vẫn bật (đã lưu thật). Không có thông báo «Đã lưu» nhìn thấy (Thấp). Đã hoàn tác về tắt. Ở 1440px vẫn không mở được menu người dùng bằng bấm tên; chỉ vào được khi thu cửa sổ 390px (xem Chưa soát). |
| K11 Trả lại | Không chạy: không còn HĐ Nháp khác. |

## Lỗi/tình trạng sau lượt 3
| # | Mức | Trạng thái |
|---|---|---|
| Giám đốc không có «Mở và ký»; khối ký số cũ lúc đang chờ ký | Cao | ĐÃ HẾT (nguyên nhân seed `fields`) |
| Thiếu Bên B | Trung | ĐÃ HẾT |
| «Phụ trách: (người đã nghỉ hoặc không xem được)» khi trưởng phòng mở HĐ của sale | Trung | CÒN (trưởng phòng thấy; giám đốc và sale thấy tên bình thường). `r3b.log` |
| Sau khi giám đốc ký: HĐ ghi «Đã duyệt xong · Còn hiệu lực» và hiện lại khối «Ký số · Ký thử – không có giá trị pháp lý · Gửi ký / Tải lên bản đã ký», trong khi Bên B chưa ký; không nói ai làm bước kế (Bên B, đợt 2) | Trung | MỚI. `215-r3-gd-sau-luu-390.png` |
| Nhãn ô «Đại diện Người ký HĐ» chạm dòng «(Ký, ghi rõ họ tên)» ở Bên A | Thấp | CÒN |
| Tên người ký chỉ «Em, An» (không đủ họ tên) | Thấp | CÒN |
| Thông báo trùng ở HĐ Nháp («Chưa có tệp nào cần ký» + danh sách ✓/✗); nút «Duyệt» vs «Đạt» | Thấp | CÒN |
| Nút < 44px ở 390px (công tắc «Cần ký» 24px, «Đóng» 16px, hộp Cài đặt 16–20px) | Thấp | CÒN |
| Mốc «Giao hàng/Thu tiền» hiện nút hành động khi HĐ còn đang duyệt | Thấp | CÒN |
| K10 lưu xong không có thông báo | Thấp | MỚI |

Tổng còn: Cao 0 · Trung 2 · Thấp 6.

## Chưa soát (lượt 3)
- K11 Trả lại (không còn HĐ); đối tác Bên B ký (đợt 2).
- Lối vào Cài đặt ở 1440px (chưa thấy cách mở menu người dùng bằng chuột trên desktop trong script; cần người soát tay).
- PDF trang 3–5 chưa xem từng trang; cảm ứng thật M01–M04.
- Dữ liệu để lại: 3 HĐ mẫu trong trạng thái đang duyệt/đã duyệt; cài đặt «Giờ ký» đã hoàn tác.

---

# Lượt 4 (đợt 2: CR-182 + CR-184, bản `9346f0acd`, 2026-11-18)

Ảnh: `D:\AI\ai-system\.data\uat-cr181\` (số 301–328, tên `l4-*`). Script `scripts\l4a..l4o.mjs`. Lượt này KHÔNG đi trọn hành trình đợt 2 vì thiếu HĐ Nháp có đối tác (xem Chặn).

## Chặn lượt này
- Không có HĐ mẫu còn Nháp. Tôi tải PDF mới (`hd-lan4.pdf`) bằng `cuong.le`: ô «Khách hàng» là ô gõ tự do (không có danh sách chọn đối tác, gõ «Evolu» không ra gợi ý) nên HĐ không gắn được đối tác Evolu có email; loại HĐ AI đoán là «Thỏa thuận hợp tác» (bấm «Bán» không giữ được). Gửi duyệt không đi tiếp được (thiếu ô bắt buộc). Cần điều phối seed HĐ Nháp mới «bản 3» (có đối tác, ≤ 100 triệu, Phòng Kinh doanh) để chạy F01, F02, P01–P06, A01–A02, D02–D04.
- Không lấy được link mời ký: lệnh `grep` log `hub-api` (`/ky/`, `sign-link`, `partner-sign-mail-off`, 4000 dòng cuối) không ra dòng nào. HĐ «bản 2» đang đúng ở «Bên A đã ký đủ. Chờ Công ty Evolu (UAT đối tác) (Bên B) ký qua link riêng.»; không soát được trang `/ky/<mã>`.

## Kết quả ca đã chạy
| Mã | Kết quả |
|---|---|
| R01 Quy trình duyệt: sơ đồ, ô chọn quy trình, bấm bước giao vai (`demo-owner`) | ĐẠT: ô «Quy trình» liệt kê 6 quy trình kèm «Bắt đầu khi: …»; bấm «Trưởng phòng duyệt» mở khung «VAI · TRƯỞNG PHÒNG DUYỆT» (Nhóm / Một người, Trần Thị Bình, «Bỏ thay đổi», «Lưu giao việc»). Chưa thử đổi người rồi Lưu (R04). 390px: khung thành ngăn kéo «Giao việc cho vai», dùng được. `306-l4-r01-giao-viec-1440.png`, `328-…-390.png` |
| R02 quy trình phụ viền vàng «Chưa giao người» | KHÔNG KIỂM ĐƯỢC: ô chọn không có «Duyệt hợp đồng bổ sung (UAT · có vai chưa giao)» (chỉ 6 quy trình, không có). Báo seed. |
| R03 thành viên thường chỉ xem | ĐẠT: `cuong.le` và `binh.tran` thấy dòng «Chỉ quản trị công ty đổi được», không có nút giao. `307-l4-r03-sale-1440.png` |
| Kết nối chỉ còn «Gửi và nhận…» | ĐẠT: một thẻ «Gửi và nhận hợp đồng với đối tác», không DocuSign. `308-l4-ket-noi-1440.png` |
| Chữ ký có «Ký số qua nhà cung cấp», không còn DocuSign | MỘT PHẦN: có thẻ nhưng tiêu đề «Ký số qua nhà cung cấp (DocuSign / Ký thử)» vẫn còn chữ DocuSign; và «Ký thử · Không có giá trị pháp lý» lộ từ kỹ thuật. `309-l4-chu-ky-settings-1440.png` |
| Trang HĐ: avatar Phụ trách, dải người ký avatar | ĐẠT một phần: «Phụ trách» là avatar «LC» có mũi tên (tên chỉ hiện khi rê chuột); dải người ký là các avatar (HE/NA có dấu tích đã ký, «CT» = đối tác). Trên 390px không có chuột nên không đọc được tên ai (xem lỗi 3). Dòng «Bên A đã ký đủ. Chờ … (Bên B) ký qua link riêng.» rõ ràng. `317-l4-hd-header-1440.png`, `327-…-390.png` |
| Phụ lục: khối «Phụ lục và giá» có «Thêm phụ lục cần ký» | Có, câu hướng dẫn rõ; CHƯA bấm thử (A01). |
| V01–V03 Kiểm tra tệp | KHÔNG ĐẠT, chặn (lỗi 1) |
| D01 Uỷ quyền khi vắng (`binh.tran`) | ĐẠT: «Tôi vắng từ [ngày] đến hết [ngày] giao việc [Duyệt / Bổ sung thông tin / Xác nhận mốc / Ký hợp đồng] cho [Chọn người…]» + «Lưu uỷ quyền». Lưu xong dòng «Đang uỷ quyền: Trần Thị Bình → Hoàng Văn Em · 18/11/2026 – 25/11/2026 · Duyệt · Thu hồi», nhưng KHÔNG có thông báo «Đã lưu». Chọn người: phải gõ tên mới ra danh sách (bấm «Chọn người…» chưa thấy danh sách sẵn). |
| D05 Lịch sử uỷ quyền | ĐẠT: «Còn hiệu lực · 0 việc đã làm thay»; bấm «Thu hồi» ⇒ «Đã thu hồi · thu hồi bởi Trần Thị Bình · 14:19 18/11/26». Đã thu hồi để không ảnh hưởng ca khác. |
| D02–D04 ký thay | Chưa chạy (cần HĐ Nháp, và D04 chưa thử). |
| P01–P06, F01–F03, A01–A02, V01–V03 | Chưa chạy (xem Chặn và lỗi 1). |

## Lỗi lượt 4
| # | Màn | Mức | Mô tả | Ảnh | Đề xuất |
|---|---|---|---|---|---|
| 1 | Kiểm tra tệp | Cao | Mục «Kiểm tra tệp» ở thanh bên (liên kết `/contracts/verify`) mở ra «Không tìm thấy hợp đồng — quay lại danh sách…» và địa chỉ trở thành `/contracts/c/verify` (bị hiểu như mã hợp đồng "verify"). Mở thẳng `/contracts/verify` cũng vậy ⇒ tính năng không dùng được với mọi người. | `318-l4-v-trang-1440.png`, `l4k` log | Sửa đường đi (route `/contracts/verify` đang bị `/contracts/c/$id` nuốt hoặc chuyển hướng). |
| 2 | Chuẩn bị chỗ ký | Cao | Bấm «Lưu chỗ ký» trên HĐ chỉ có 1 người ký (không đối tác, bản `hd-lan4.pdf`) làm sập màn hình thành «Something went wrong! [Show Error]» (tiếng Anh), lỗi `TypeError: i is not a function`. Lưu thật có được (tải lại thấy «1 chỗ ký») nhưng người dùng thấy trang trắng. Tái hiện được 2/2. | `314-FAIL-prep-1440.png` | Sửa lỗi sau khi lưu (có thể màn hộp «Đã đủ chỗ ký» khi không có Bên B); thay màn lỗi tiếng Anh bằng câu nghiệp vụ. |
| 3 | Trang HĐ | Trung | Phụ trách và người ký chỉ là avatar chữ cái (LC, HE, NA, CT); tên chỉ hiện khi rê chuột ⇒ trên điện thoại không biết ai. Trên HĐ Nháp mới, mỗi avatar lại ghi cả hai tên: «HE Hoàng Văn Em, Nguyễn Văn An · Bên A · Chưa có chỗ ký» và «NA Hoàng Văn Em, Nguyễn Văn An …» (lặp danh sách cho từng người). | `327-l4-hd-bản2-owner-390.png`, `310-l4-hd-moi-upload-1440.png` | Hiện tên ngắn bên cạnh avatar ở 390px; sửa chuỗi lặp. |
| 4 | Cài đặt › Quy trình duyệt | Trung | Sơ đồ ở khung xem (1440) và nút «Vừa khung» làm chữ trong thẻ bước chỉ khoảng 6–7px, không đọc được; phải phóng to bằng tay. | `301-l4-qt-duyet-owner-1440.png` | Chữ tối thiểu 11–12px hoặc mở rộng khung. |
| 5 | Quy trình phụ «có vai chưa giao» | Trung | Không có trong danh sách quy trình ⇒ không kiểm được viền vàng «Chưa giao người». Báo seed. | `302-l4-qt-o-chon-1440.png` | Seed lại quy trình phụ. |
| 6 | Cài đặt › Chữ ký | Thấp | «Ký số qua nhà cung cấp (DocuSign / Ký thử)» còn chữ DocuSign; «Ký thử – không có giá trị pháp lý» (từ kỹ thuật). | `309-…-1440.png` | Đổi nhãn nghiệp vụ. |
| 7 | Cài đặt (mọi mục) | Thấp | Đầu hộp luôn ghi «Mục này chỉ để xem nên không có gì cần lưu» kể cả khi quản trị đang giao việc/uỷ quyền có nút Lưu ngay bên dưới. | `306-…-1440.png` | Bỏ hoặc đổi câu theo mục. |
| 8 | Uỷ quyền khi vắng | Thấp | Lưu xong không có thông báo; danh sách người nhận phải gõ mới hiện. | `l4-d01-luu` | Thêm toast «Đã lưu uỷ quyền». |
| 9 | Trang HĐ Nháp mới (CR-184) | Thấp | Thanh tiêu đề dính (sticky) che mép trên khối «Tài liệu kèm»/form khi cuộn; ô «Gửi duyệt» mờ không nói thiếu gì. | `311-l4-chon-doi-tac-1440.png` | Chừa khoảng đệm; hiện lý do thiếu. |

Còn các lỗi Thấp của lượt 3 (nút < 44px ở 390px: công tắc «Cần ký» 24px, «Đóng» 16px, nút «Sơ đồ/Danh sách» 28px; nhãn ô đè «(Ký, ghi rõ họ tên)»; «Phụ trách (người đã nghỉ…)» với người duyệt chưa kiểm lại).

Tổng lỗi mới lượt 4: Cao 2 · Trung 3 · Thấp 4.

## Chưa soát (lượt 4)
Trang ký đối tác `/ky/<mã>` (P01–P06), «Gửi lại link», «Từ chối», Xoè quạt / Liền mép (F01–F03), phụ lục cần ký và quy trình riêng (A01–A02), «Kiểm tra tệp» (V01–V03), ký thay (D02–D04), R02 và R04, ký đối tác ở 390px. Cần HĐ Nháp có đối tác + link mời ký.

---

# Lượt 5 (bản `ae145268f`, HĐ «… · 18/11 14:39 · bản 2», 2026-11-18)

Ảnh: `D:\AI\ai-system\.data\uat-cr181\` (số 401–428, tên `r5-*`). Script `scripts\r5a..r5i.mjs`.

## Lỗi lượt 4 đã hết chưa
| Lỗi lượt 4 | Trạng thái |
|---|---|
| 1. Kiểm tra tệp mở ra «Không tìm thấy hợp đồng» | HẾT. Mở được trang «Kiểm tra tệp». Bản đã ký ⇒ «Khớp: Sau khi Nguyễn Văn An ký của hợp đồng … · mã kiểm tra … · ký lúc …» (kèm nút «Xem bản đã ký»); PDF lạ (`hd-lan4.pdf`) ⇒ «Không khớp bản nào đã lưu — tệp có thể đã bị sửa hoặc không phải bản do Evolu lập.». `421/422/423-r5-v-*` |
| 2. «Lưu chỗ ký» sập «Something went wrong» | HẾT (HĐ có Bên A và Bên B: lưu xong hiện «Đã đủ chỗ ký cho mọi tệp»; 0 lỗi trang). Chưa thử lại trường hợp HĐ chỉ có 1 người ký. |
| 3. Avatar không có tên | MỘT PHẦN: dải người ký nay ghi tên đầy đủ cạnh avatar («Nguyễn Văn An · Bên A · 1 chỗ ký», «Công ty Evolu (UAT đối tác) · Bên B · 1 chỗ ký») và không còn lặp hai tên; dòng bước ký nói «Chờ Nguyễn Văn An ký». CÒN: ở 390px, ô «Phụ trách» chỉ có avatar «LC», chạm avatar không hiện tên (`r5-avatar-cham-390.png`). |
| 4. Chữ trên sơ đồ nhỏ | HẾT: chữ trong thẻ bước 12–14px, đọc được (`425-r5-qt-phu-1440.png`). |
| 5. Quy trình phụ «Chưa giao người» | HẾT: ô chọn có «Duyệt hợp đồng bổ sung (UAT · có vai chưa giao) · 1 bước»; bước «Giám đốc duyệt» ghi «⚠ Chưa giao người» (viền cam/vàng nhạt, khá mờ). Mới (Thấp): thẻ «Bắt đầu» ghi «Bắt đầu khi: Giá trị < 0 triệu». |
| Cũ: «Phụ trách: (người đã nghỉ…)» với người duyệt | HẾT (`Phụ trách` hiện avatar cho cả trưởng phòng và giám đốc). |
| Cũ: đầu hộp Cài đặt «Mục này chỉ để xem…» | HẾT, nay «Mục này không có nút Lưu chung; giao việc và uỷ quyền có nút Lưu riêng». |

## Hành trình trên HĐ 14:39
| Bước | Kết quả |
|---|---|
| Sale: «Tự đặt» A/B, Lưu chỗ ký, Gửi duyệt | ĐẠT: «Đã đặt 2 chỗ ký»; sau Gửi duyệt dải ghi «Bên A · 1 chỗ ký», «Bên B · 1 chỗ ký». |
| Trưởng phòng: màn ký có «Từng trang / Xoè quạt», «Mép phải / Mép dưới», nút ‹ › «Trang 1–5», công tắc «Liền mép» | ĐẠT phần nhìn: Xoè quạt mép phải hiện các trang xếp lớp, đánh số 1–5 (`408-r5-head-xoe-mep-phai-1440.png`); «Liền mép» bật được; ký giáp lai ở chế độ Từng trang + Liền mép ra «Giáp lai 2 trang: 3, 4». |
| Trưởng phòng: ký ngay trong Xoè quạt (mép phải, rồi mép dưới) | KHÔNG KẾT LUẬN ĐƯỢC: kéo chữ ký vào trang trong chế độ Xoè quạt, màn trở lại «Từng trang» và chữ ký nằm ở trang 1; không chuyển được sang «Mép dưới» để thử (`409-…`, `410-FAIL-xoe-duoi`). Cần người thử tay (tôi nghi kéo thả trong Xoè quạt tự thoát chế độ, Trung). Đã lưu «2 chữ ký, 1 giáp lai, trên 3 trang» và Đạt. |
| Giám đốc: «Mở và ký», hết khối ký số cũ | ĐẠT; ký ô, Lưu; dải «Nguyễn Văn An · Bên A · Đã ký». |
| Sau khi giám đốc ký: đối tác nhận link, khối «Chờ đối tác ký», HĐ chờ Bên B | KHÔNG ĐẠT (Cao): bước «Ký hợp đồng» vẫn ghi «Chờ Nguyễn Văn An ký» (và giám đốc còn thẻ «đã ký 1/1 tệp · Mở và ký») hơn 15 phút dù Bên A «Đã ký»; HĐ vẫn «Đang duyệt», không có khối «Chờ đối tác ký», không có «Gửi lại link»/«Sao chép link», log `hub-api` không có dòng `partner-sign-mail-off`. `417-r5-gd-sau-luu-1440.png`, `426-r5-sale-sau-cho-1440.png`. So với lượt 3 (HĐ không có hoạt động đối tác): bước Ký hoàn tất ngay. |
| Mở link đối tác, tạo chữ ký nhanh, ký, HĐ «Đã ký», Xem bản đã ký có chữ ký Bên B; PDF cuối | KHÔNG CHẠY được (không có link). |
| Từ chối, Gửi lại link, trang ký đối tác 390px | KHÔNG CHẠY được (cùng nguyên nhân). Ghi «chưa soát». |

## Ca sau cùng
| Mã | Kết quả |
|---|---|
| V01–V02 Kiểm tra tệp | ĐẠT (xem trên). Chưa thử V03 (`demo-viewer`) và giới hạn > 10 lần/phút. «Bản cuối» đầy đủ chữ ký đối tác chưa có (chặn). |
| A01 Thêm phụ lục cần ký | ĐẠT: khối «Phụ lục và giá» có «Thêm phụ lục cần ký», tải PDF ⇒ tạo HĐ Nháp «hd-lan4» ghi «Phụ lục của hợp đồng HĐ mẫu · … · bản 2», cùng đối tác Evolu, tệp chính «Cần ký · Chưa đặt». Nhỏ (Thấp): thanh người ký của phụ lục liệt kê 3 người (Hoàng Văn Em, Nguyễn Văn An, Công ty Evolu) trong khi câu cảnh báo vẫn ghi «Đại diện Người ký HĐ»; HĐ gốc hiện «Phụ lục cũ — chỉ đọc». `428-r5-phu-luc-sau-1440.png` |
| A02 Phụ lục đi quy trình riêng | Chưa chạy (phụ lục chưa gửi duyệt). |
| D02–D04 ký thay | Chưa chạy: không có HĐ đang chờ `binh.tran`. |

## Lỗi/tình trạng còn sau lượt 5
| Mức | Mô tả |
|---|---|
| Cao | Bước Ký không hoàn tất sau khi giám đốc ký (HĐ có Bên B có email): không có link đối tác, không có «Chờ đối tác ký» ⇒ toàn bộ luồng đối tác chặn (P01–P06, bản cuối, Từ chối, Gửi lại link). |
| Trung | Kéo chữ ký trong Xoè quạt thoát về «Từng trang» (cần xác nhận bằng tay); ở 390px chạm avatar không hiện tên (Phụ trách). |
| Thấp | «Giá trị < 0 triệu» ở thẻ Bắt đầu; câu cảnh báo phụ lục còn «Đại diện Người ký HĐ»; nút < 44px ở 390px (công tắc «Cần ký» 24px, «Đóng» 16px, «Sơ đồ/Danh sách» 28px) vẫn còn. |

Tổng còn: Cao 1 · Trung 2 · Thấp 3.

## Chưa soát (lượt 5)
Mọi thứ phía đối tác (link, tạo chữ ký nhanh, ký, «Đã ký», bản đã ký có chữ ký Bên B, PDF cuối + giáp lai mọi trang, 390px), «Từ chối», «Gửi lại link», Xoè quạt mép dưới, D02–D04, V03, A02.

---

# Lượt 6 (bản `218f86197`: CR-185, CR-186, đợt 2 nhanh; 2026-11-18)

Ảnh: `D:\AI\ai-system\.data\uat-cr181\` (số 500–551, tên `r6-*`; PDF `ban-cuoi-lan6.pdf`, ảnh trang `l6-trang-1..6.png`). Script `scripts\r6a..r6k.mjs`. HĐ dùng: «… 18/11 18:45 · bản 2».

## Đợt 2: hành trình trên HĐ 18:45
| Bước | Kết quả |
|---|---|
| Sale: tự đặt A/B (2 chỗ), Lưu chỗ ký không sập, Gửi duyệt | ĐẠT |
| Trưởng phòng: Xoè quạt mép phải, mép dưới, Liền mép (giáp lai trang 3–4), Lưu, Đạt | ĐẠT. Xoè mép dưới nay chuyển được (lượt 5 bị chặn). Chưa kiểm lại việc kéo thả trong Xoè quạt. |
| Giám đốc: «Mở và ký», ký, Lưu | ĐẠT |
| Thẻ «Chờ đối tác ký» | ĐẠT (Cao lượt 5 ĐÃ HẾT): «Bên A đã ký đủ. Chờ Công ty Evolu (Bên B) ký qua link riêng.», «Đã mở lúc: Chưa mở», «Hạn ký 25/11/2026», «Chưa gửi được thư mời — sao chép link để gửi đối tác.», nút «Sao chép link» và «Gửi lại link» (bấm «Gửi lại link» chạy, không thấy toast riêng). |
| Trang mời `/ky/<mã>` (không đăng nhập) | ĐẠT: «Demo Sổ Hợp Tác mời bạn ký HĐ mẫu … · Chào Công ty Evolu · Số tệp 1 · Chỗ ký của bạn 1 · Hạn ký», nút «Xem và ký» / «Từ chối ký», không có khung ứng dụng. 390px gọn. `527-…-390.png` |
| Đối tác: tạo chữ ký nhanh (gõ họ tên), ký ô «Bấm để ký», «Lưu và ký», xác nhận «Lưu chữ ký?» | ĐẠT; trang kết quả «Bạn đã ký xong · Bản đã ký của hai bên có thể xem lại … · Ký lúc 18/11/2026 18:50 · Xem bản đã ký · Tải về». |
| HĐ sau khi đối tác ký | ĐẠT: dải «Bên A · Đã ký», «Bên B · Đã ký», tệp «Đã ký đủ». Trạng thái chung hiện «Đã duyệt xong · Còn hiệu lực» (không có chữ «Đã ký» ở tiêu đề). |
| Xem bản đã ký | ĐẠT: 4 bản (Bản gốc, sau Trần Thị Bình, sau Nguyễn Văn An, sau Đối tác Công ty Evolu), nhãn «Đã ký đủ». Lỗi nhỏ: dòng chữ ký trong bản ghi tên người đối tác là «một người» thay vì họ tên. |
| PDF cuối (`ban-cuoi-lan6.pdf`, 6 trang, 198 KB) | ĐẠT: trang 6 có chữ ký Bên A dưới «ĐẠI DIỆN BÊN A» và chữ ký «Phạm Đối Tác» đúng dưới «ĐẠI DIỆN BÊN B»; trang 3–4 giáp lai khớp (nửa trên ở mép dưới trang 3, nửa dưới ở mép trên trang 4); đã soi trang 2, 3, 4, 6, trang 1, 5 chỉ render. Lưu ý: hình chữ ký Bên A đọc «Bùi Nguyễn Bảo Chieu» trong khi chú thích «Nguyễn Văn An» (dữ liệu chữ ký của `demo-owner` đã đổi so với lượt trước; cần xác nhận không phải lỗi). |
| Từ chối ký, Kiểm tra tệp, phụ lục, uỷ quyền | Không chạy lại ở lượt này (đã soát lượt 4–5). Chưa soát: «Từ chối ký», D02–D04. |

## CR-185
| Điểm | Kết quả |
|---|---|
| Avatar: rê chỉ hiện họ tên | ĐẠT ở trang HĐ: Phụ trách «Lê Minh Cường», người ký «Nguyễn Văn An», đối tác «Công ty Evolu (UAT đối tác)». |
| Avatar: chạm ở 390px | LỖI (Trung): chạm avatar Phụ trách hiện thêm chữ «Đổi người phụ trách» ngoài họ tên; chạm avatar người ký ở 390px bị chặn (không bấm được: phần tử bị che/không nhận chạm), nên không biết tên. Dải người ký không còn ghi tên cạnh avatar («Bên A · Đã ký»), vì vậy trên điện thoại không biết ai ký. |
| Avatar ở ô chọn người, uỷ quyền, khung giao việc | Chưa kiểm lại từng chỗ (chỉ thấy ở khung giao việc «T Trần Thị Bình»: avatar chỉ một chữ «T»). |
| Sơ đồ Quy trình duyệt so với trang quản trị | KHÔNG SO ĐƯỢC (không có tài khoản trang quản trị). Sơ đồ Sổ Hợp Tác nay có thẻ «Bắt đầu / Trưởng phòng duyệt / Ký hợp đồng…» chữ lớn, đọc được; chưa đối chiếu «Ký số» gộp một ô và cạnh Từ chối (cần xem phần cuối sơ đồ, tôi chưa cuộn tới). |
| Không còn mục «Kết nối» | ĐẠT. |
| Cảnh báo điều kiện gửi/nhận | ĐẠT: «⚠ Chưa có quy trình «Nhận HĐ» — hợp đồng đối tác gửi tới chưa có nơi xử lý. Quản trị công ty tạo quy trình Nhận HĐ ở trang Quy trình.» Màu chữ cam đỏ, không phải vàng (Thấp). `543-r6-qt-mac-dinh-1440.png` |

## CR-186 (Bảng tin), 1440 và 390
| Điểm | Kết quả |
|---|---|
| Chọn loại bài ở 390px | ĐẠT: ba chip «Cần bán / Cần mua / Thông báo» cao 44px, hàng cuộn ngang (chip thứ ba bị cắt mép khi chưa cuộn). `r6-cm-390-mo.png` |
| Ô đăng bài dính khi cuộn | ĐẠT ở 1440 (dính dưới thanh trên, nền đặc, không lộ nội dung phía trên) và 390 (thu thành «Viết bài…»). Còn khe nhỏ (~10px) giữa thanh trên và ô đăng bài. `547-r6-cm-cuon-1440.png`, `r6-cm-390-cuon.png` |
| Hộp «Nhắc tên»: lọc Tất cả / Nội bộ / Đối tác / Khách hàng, ô tìm, dòng đều | KHÔNG THẤY (Trung): gõ «@» ở ô bình luận chỉ hiện một dòng «Cơ sở Tân Phát» (không có thẻ lọc, không có ô tìm, không avatar/công ty-chức vụ). Có thể do tài khoản chỉ có 1 đối tác để nhắc; cần dữ liệu nhiều người hơn để xác nhận. Gõ «@» ở ô đăng bài không ra gì. `551-r6-cm-nhac-ten-cmt-1440.png` |
| Bài ≥ 3 bình luận hiện sẵn 3 bình luận mới nhất | KHÔNG ĐẠT (Trung): ở danh sách bài chỉ có «Bình luận (3)»; phải bấm mới thấy 3 bình luận. |

## Tổng kết lượt 6
Còn: Cao 0 · Trung 4 (chạm avatar ở 390px, nhắc tên thiếu lọc/tìm, bình luận không hiện sẵn, dải người ký không còn tên) · Thấp: «một người» thay tên đối tác ở bản đã ký, màu cảnh báo, avatar «T» một chữ, khe nhỏ trên ô đăng bài, nút < 44px (công tắc «Cần ký» 24px, «Đóng» 16px). Thêm: màn ký của đối tác ở 390px, chữ «Chữ ký của tôi» xuống dòng và tràn khỏi ô chữ ký, nút «Lưu (còn 1 chỗ chưa ký)» chiếm gần hết thanh trên (Trung nhẹ). `530-r6-dt-man-ky-390.png`.

Chưa soát: so sánh sơ đồ với trang quản trị, «Từ chối ký», D02–D04, avatar ở ô chọn người/uỷ quyền, lọc «Nhắc tên» với nhiều người, cảm ứng thật.

---

# Lượt 7 (lượt cuối, bản `a78d37f58`, 2026-11-18)

Ảnh: `D:\AI\ai-system\.data\uat-cr181\` (số 600–712, tên `r7-*`). Script `scripts\r7*.mjs`. HĐ «18:45» (đã ký, lượt 6) và «20:07 · bản 2» (đi trọn hành trình lượt này).

| Điểm lỗi Trung lượt 6 | Kết quả |
|---|---|
| Đầu trang HĐ đã ký đủ ghi «Đã ký» | HẾT: cả «18:45» và «20:07» ghi «Đã ký · Còn hiệu lực». |
| 390px chạm avatar người ký hiện họ tên (`hasTouch`) | HẾT cho người ký («Nguyễn Văn An») và đối tác («Công ty Evolu (UAT đối tác)»). CÒN nhỏ (Thấp): chạm avatar Phụ trách vẫn hiện thêm «Đổi người phụ trách» ngoài họ tên. |
| 390px khay chữ ký không tràn, nút «Lưu · còn n» gọn | HẾT: màn ký đối tác và công ty đều thấy khay «[chữ ký] Của tôi» gọn một dòng và nút «Lưu · còn 1» vừa thanh trên (`672-r7-dt-man-ky-390.png`, `652-r7-gd-man-ky-390.png`). |
| Gõ «@» mở hộp «Nhắc tên» có lọc nhóm và ô tìm | HẾT: hộp «Nhắc tên» có «Tất cả», ô tìm, ghi «Chỉ hiện người xem được bài này · tối đa 10 người», danh sách có avatar, họ tên, nhóm «Nội bộ»/công ty, nút «Huỷ» và «Xong (n người)». Chưa nhìn kỹ tab lọc từng nhóm (Nội bộ/Đối tác/Khách hàng) và độ đều dòng ở 390px. `r7-cm-nhac-ten-1440.png` |
| Nhắc một người ⇒ người đó có chuông | KHÔNG THẤY (Trung, cần xác nhận): `cuong.le` nhắc «Trần Thị Bình» trong bình luận; chuông của `binh.tran` chỉ liệt kê việc duyệt, không có thông báo nhắc tên (mới nhất là «Cần duyệt … 20:07»). Có thể thông báo nhắc tên nằm ở nơi khác (Bảng tin) hoặc chậm. `r7-binh-chuong-1440.png` |
| Bài ≥ 3 bình luận hiện sẵn 3 bình luận mới nhất | HẾT: bài «Thùng phi 200L» hiện sẵn cả 3 bình luận mà không cần bấm. `r7-cm-truoc-bam.png` |
| Nút gửi bình luận ≥ 44px | HẾT: 48×48px. Nút «Xong (n người)» trong hộp nhắc cao 40px (Thấp). |

## Hành trình HĐ «20:07»
Sale (tự đặt A/B, Lưu chỗ ký không sập, Gửi duyệt) ⇒ trưởng phòng (Xoè quạt mép phải, mép dưới, Liền mép + giáp lai, Lưu, Đạt) ⇒ giám đốc (Mở và ký, ký, Lưu) ⇒ thẻ «Chờ đối tác ký» + «Sao chép link» ⇒ đối tác mở link, tạo chữ ký nhanh, ký, «Bạn đã ký xong» ⇒ HĐ «Đã ký», Xem bản đã ký có 4 bản (có «Sau khi Đối tác: Công ty Evolu ký»), Tải về PDF được: ĐẠT toàn bộ. Còn lỗi nhỏ cũ: dòng chữ ký đối tác trong «Xem bản đã ký» ghi «một người» thay vì họ tên (Thấp).

## Tổng kết lượt 7
Còn: Cao 0 · Trung 1 (nhắc tên không thấy chuông, cần xác nhận) · Thấp 3 (avatar Phụ trách còn chữ «Đổi người phụ trách»; «một người» thay tên đối tác; nút «Xong» 40px).
Chưa soát: PDF của «20:07» (chỉ tải, không soi lại), «Từ chối ký», D02–D04, so sánh sơ đồ với trang quản trị, cảm ứng thật cho kéo thả.
