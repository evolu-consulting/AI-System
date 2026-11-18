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
