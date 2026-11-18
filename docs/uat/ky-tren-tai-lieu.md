# UAT «Ký trên tài liệu» (CR-181)

Bản test (staging), công ty **Demo**. Mật khẩu KHÔNG ghi ở đây: người Demo dùng file `DEMO_OWNER.pw` trên máy chủ bản test (như `docs/uat/hop-dong-2-cong-ty.md`).
Mỗi ca: làm đúng vai, đúng tài khoản, đánh dấu Đạt hoặc Không đạt.

## 0. Chuẩn bị (điều phối làm một lần)
| Việc | Cách làm |
|---|---|
| Nạp dữ liệu | Chạy sau `--org-only` và `--partner-only`: `bash seed-demo.sh --sign-only` (trên máy chủ bản test). Chạy lại được, chỉ thêm. Từ chối chạy ngoài bản test. |
| Seed làm gì | (1) Bật «Ký trên tài liệu» cho Demo, các định dạng khác để mặc định. (2) Thêm quy trình **Duyệt và ký hợp đồng (ký trên tài liệu)**: Trưởng phòng duyệt (ý kiến + chữ ký) → Ký trên tài liệu; người làm lấy theo VAI (CR-182): «Trưởng phòng duyệt» → `binh.tran`, «Người ký hợp đồng» → `demo-owner` (seed giao qua API giao việc). Thêm quy trình phụ «Duyệt hợp đồng bổ sung (UAT · có vai chưa giao)» (vai «Giám đốc duyệt» chưa giao; đứng cuối, không khớp HĐ nào). (3) Thêm hợp đồng Nháp **HĐ mẫu · Ký trên tài liệu (CR-181)** của `cuong.le`, đối tác Evolu (có email), kèm 2 PDF: hợp đồng 6 trang (trang cuối có «ĐẠI DIỆN BÊN A / BÊN B», «(Ký, ghi rõ họ tên)») và phụ lục 2 trang. |
| Không có sẵn | KHÔNG ai có chữ ký sẵn: lần đầu vào, mỗi người sẽ thấy màn «Tạo chữ ký của bạn». |
| Chọn quy trình | Quy trình mới đứng ĐẦU thứ tự, chỉ khớp khi người tạo thuộc phòng Kinh doanh **và** giá trị hợp đồng ≤ 100 triệu (HĐ mẫu: 80 triệu). Hợp đồng ≥ 150 triệu của UAT hai công ty vẫn đi quy trình «UAT · …» cũ, không đổi. Muốn thử ký trên tài liệu với hợp đồng khác: tạo hợp đồng Kinh doanh dưới 100 triệu. |

## 1. Tài khoản (Demo)
| Tên đăng nhập | Vai |
|---|---|
| `cuong.le` | Sale: người tạo, tải tệp, chuẩn bị chỗ ký |
| `binh.tran` | Trưởng phòng Kinh doanh: duyệt, ký + chọn Đạt |
| `demo-owner` | Giám đốc (Toàn quyền): người ký công ty, quản trị Cài đặt › Chữ ký |

## 2. Kịch bản 3 vai
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| K01 | `cuong.le` | Đăng nhập lần đầu | Màn «Tạo chữ ký của bạn» (vẽ / tải ảnh / gõ tên); chưa tạo thì chưa vào tiếp được. Tạo xong vào được. | |
| K02 | `cuong.le` | Hợp đồng › «HĐ mẫu · Ký trên tài liệu (CR-181)» (Nháp) | Bảng Tài liệu kèm có 2 tệp: hợp đồng mặc định «Cần ký», phụ lục không. Đối tác Evolu, có email. | |
| K03 | `cuong.le` | Bật «Cần ký» cho phụ lục (tuỳ chọn), bấm «Chuẩn bị chỗ ký» ở hợp đồng | Mở được 6 trang. Dùng «Tự đặt theo ĐẠI DIỆN BÊN A/B»: ô ký xuất hiện ở trang cuối đúng chỗ chữ «ĐẠI DIỆN BÊN A» và «BÊN B». Kéo, đổi cỡ, xoá được; Lưu xong có thông báo. | |
| K04 | `cuong.le` | Hợp đồng › Gửi duyệt | Dải người ký hiện đủ (ai ký, thứ tự). Thiếu chỗ ký ở tệp «Cần ký» ⇒ bị chặn và nói rõ lý do. Đủ ⇒ gửi được, trạng thái «Đang duyệt», nói rõ ai làm bước kế (Trưởng phòng). | |
| K05 | `binh.tran` | Tạo chữ ký (nếu màn hiện) › mở việc duyệt › thẻ «Mở và ký» | Xem được tài liệu, các ô ký của mình nổi bật, ô người khác khoá. | |
| K06 | `binh.tran` | Bấm ô ký của mình, ký, rồi chọn **Đạt** kèm ý kiến | Chữ ký hiện đúng ô với tên + ngày; không Đạt khi chưa ký thì báo thiếu. Sau Đạt, việc chuyển sang bước Ký. | |
| K07 | `demo-owner` | Mở việc ký › «Mở và ký» › ký các ô của giám đốc | Thấy chữ ký của Trưởng phòng đã in ở bản mới; ký xong hợp đồng chuyển «Đã ký». | |
| K08 | `cuong.le` | Mở hợp đồng › «Xem bản đã ký» | Chọn bản, tab theo tệp, cột trang, khung chữ ký đúng chỗ; «Tải về» được; tệp gốc còn nguyên. Chế độ chỉ đọc (không kéo, không sửa). | |
| K09 | `demo-owner` | Mở Hồ sơ duyệt của hợp đồng | Có hình chữ ký của từng người ở đúng bước, kèm ý kiến + thời điểm. | |
| K10 | `demo-owner` | Cài đặt › Chữ ký | Công tắc «Ký trên tài liệu» đang bật; xem trước chữ ký; ô chữ ký số bị khoá (chưa mở đợt này). | |

## 3. Trả lại và từ chối (ngắn)
| Mã | Vai | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| K11 | `binh.tran` | Ở bước duyệt chọn «Trả lại» | Bản đã ký trước đó không bị xoá (chỉ đánh dấu không còn hiệu lực); sale chuẩn bị lại và gửi lại được. | |

## 4. Điện thoại 390px
Mở bằng điện thoại hoặc thu cửa sổ trình duyệt về rộng 390px (DevTools › thiết bị).
| Mã | Vai | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| M01 | `binh.tran` | Thẻ «Mở và ký» | Tài liệu vừa khung, không tràn ngang; chạm ô ký mở ngăn kéo lên (sheet) để chọn chữ ký; nút đủ lớn (≥ 44px), không bị che bởi thanh dưới. | |
| M02 | `demo-owner` | Ký các ô, bấm Hoàn tất | Cuộn trang mượt, không phải thu phóng để bấm; thông báo kết quả đọc được. | |
| M03 | `cuong.le` | Xem bản đã ký | Cột trang chuyển thành ngăn kéo; chọn bản, tab tệp, Tải về dùng được bằng một tay. | |
| M04 | `cuong.le` | Chuẩn bị chỗ ký | Chạm giữ một ô mở menu; kéo bằng ngón tay không làm cuộn trang ngoài ý muốn. | |

## 5. Đợt 2 (CR-182, CR-184)
Làm SAU mục 2 (cần HĐ mẫu đã tới bước Ký, hoặc hợp đồng mới Kinh doanh dưới 100 triệu). Tài khoản như mục 1; người ngoài (đối tác) không cần tài khoản.

### 5.1 Giao việc theo vai trên sơ đồ
Seed đã giao sẵn: «Trưởng phòng duyệt» → `binh.tran`, «Người ký hợp đồng» → `demo-owner`. Quy trình phụ **Duyệt hợp đồng bổ sung (UAT · có vai chưa giao)** có vai «Giám đốc duyệt» CHƯA giao; quy trình này đứng cuối thứ tự và không khớp hợp đồng nào nên không chặn HĐ mẫu.
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| R01 | `demo-owner` | Cài đặt › Quy trình duyệt › mở «Duyệt và ký hợp đồng (ký trên tài liệu)» › bấm bước «Trưởng phòng duyệt» trên sơ đồ | Khung giao việc hiện vai «Trưởng phòng duyệt» đang giao cho Trần Thị Bình; đổi được sang nhóm hoặc người khác, Lưu có thông báo. Bước Ký hiện vai «Người ký hợp đồng» giao cho giám đốc; không còn ô «Ký qua» / «Người ký phía công ty». | |
| R02 | `demo-owner` | Mở quy trình phụ «Duyệt hợp đồng bổ sung…» | Bước «Giám đốc duyệt» có viền vàng «Chưa giao người». Giao cho một người ⇒ viền mất; bỏ giao ⇒ viền vàng trở lại. | |
| R03 | `cuong.le` | Mở Cài đặt › Quy trình duyệt | Xem được sơ đồ nhưng KHÔNG giao việc được (người thường bị chặn). | |
| R04 | `demo-owner` | Đổi «Trưởng phòng duyệt» sang `huy.dang` khi HĐ mẫu đang chờ `binh.tran` | Việc đang chờ giữ `binh.tran`; chỉ HĐ gửi sau mới tới người mới. Trả lại giao về `binh.tran` sau khi xem. | |

### 5.2 Kiểu xem khi ký: Xoè quạt / Liền mép
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| F01 | `binh.tran` | Màn ký › «Kiểu xem»: Từng trang, bật «Liền mép» | Ô ký giáp lai chạy qua mép hai trang liền nhau; lát bị cắt đúng theo khe. | |
| F02 | `binh.tran` | Chọn «Xoè quạt» (Mép phải, rồi Mép dưới) | Các trang xoè theo nhóm 5 trang; ô chỗ ký ẩn; chữ ký đã đặt ở kiểu khác vẽ lại đúng phần đang lộ. Đổi kiểu không mất chữ ký. | |
| F03 | `binh.tran` | Mở bằng điện thoại 390px | Chỉ còn «Từng trang» (không có Xoè quạt). | |

### 5.3 Đối tác ký qua link
Bản test đặt `HUB_NOTIFY_MODE=off` nên KHÔNG gửi email thật: link mời ký nằm trong log hub-api. Lấy link (trên máy chủ bản test, điều phối làm):
`cd ~/workspace/sohoptac2-staging && docker compose -p sohoptac2-staging logs --no-log-prefix hub-api | grep -E "partner-sign-mail-off|sign-link" | tail -3`
Dòng log có trường `link` dạng `…/ky/<mã>` và `to` = email liên hệ đối tác (`thomas.tran@example.invalid`). Không dán link vào chỗ công khai.
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| P01 | `demo-owner` | Hoàn tất ký của bên A (sau `binh.tran`), mở trang HĐ | Khối «Chờ đối tác ký»: đã gửi lúc, «Chưa mở», hạn 7 ngày. Có dòng log mời ký (lệnh trên). | |
| P02 | (không đăng nhập) | Mở link `/ky/<mã>` ở cửa sổ ẩn danh | Trang nói công ty nào mời ký hợp đồng nào, số tệp, số chỗ ký của bạn, hạn; không có khung ứng dụng, không cần tài khoản. | |
| P03 | (không đăng nhập) | «Xem và ký» › tạo chữ ký nhanh (gõ tên hoặc vẽ) › ký ô «ĐẠI DIỆN BÊN B» › Lưu | Chỉ thấy tệp được gửi và chỗ ký của mình; ký thêm chỗ tự đặt được. Xong ⇒ HĐ «Đã ký». | |
| P04 | `cuong.le` | Mở HĐ sau P03 | «Đã ký», chuông báo, «Xem bản đã ký» có chữ ký Bên B. Mở lại link cũ ⇒ chỉ xem, không ký lại được. | |
| P05 | `cuong.le` | Với HĐ khác (hoặc trước P03): «Gửi lại link» | Có toast; log có dòng mới với link mới; link cũ không dùng được nữa. Người thường (`demo-viewer`) không thấy nút. | |
| P06 | (không đăng nhập) | Ở trang mời ký bấm «Từ chối ký», nhập lý do | HĐ không «Đã ký»; trang HĐ hiện lý do từ chối; người tải lên nhận chuông. | |

### 5.4 Phụ lục ký sau
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| A01 | `cuong.le` | Trên HĐ mẫu đã ký: «Thêm phụ lục cần ký» › tải PDF | Tạo phụ lục dưới HĐ gốc, cùng đối tác và hướng; tệp chính «Cần ký»; HĐ gốc giữ nguyên, liệt kê phụ lục. | |
| A02 | `cuong.le` → `binh.tran` → `demo-owner` | Chuẩn bị chỗ ký, Gửi duyệt phụ lục, duyệt + ký như K03-K07 | Phụ lục đi quy trình riêng theo bộ chọn (Kinh doanh dưới 100 triệu ⇒ quy trình ký trên tài liệu); chưa có quy trình khớp thì nút Gửi duyệt nói rõ. | |

### 5.5 Kiểm tra tệp
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| V01 | `cuong.le` | Menu «Kiểm tra tệp» › tải bản đã ký (đã tải về ở K08) | «Khớp bản <Sau khi … ký> của HĐ <tên>». | |
| V02 | `cuong.le` | Tải tệp gốc chưa ký, rồi một PDF lạ | Tệp gốc: khớp tệp gốc cần ký; PDF lạ: «Không khớp bản nào đã lưu». Tệp không được lưu lại. | |
| V03 | `demo-viewer` | Tải bản đã ký của HĐ của `cuong.le` | Không khớp (chỉ so trong HĐ người đó thấy). Tải liên tục > 10 lần/phút ⇒ bị giới hạn. | |

### 5.6 Uỷ quyền khi vắng + lịch sử (CR-184)
| Mã | Vai + tài khoản | Bước bấm | Điểm cần nhìn | Đạt/Không |
|---|---|---|---|---|
| D01 | `binh.tran` | Cài đặt › Quy trình duyệt › «Uỷ quyền khi vắng»: «Tôi vắng từ… đến hết… giao việc [Duyệt] cho `em.hoang`» › Lưu | Một câu duy nhất; dòng hiện ở «Đang uỷ quyền». | |
| D02 | `em.hoang` | Gửi một HĐ mới của `cuong.le` (Kinh doanh dưới 100 triệu), mở việc duyệt | `em.hoang` có lượt; màn ký ghi «Bạn đang ký thay Trần Thị Bình»; ký bằng chữ ký của CHÍNH `em.hoang`. | |
| D03 | `demo-owner` | Hồ sơ duyệt của HĐ đó | Người ký thật = Hoàng Văn Em, kèm «thay» Trần Thị Bình. | |
| D04 | `binh.tran` | Uỷ quyền «Ký hợp đồng» cho người KHÔNG thuộc nhóm người ký | Bị từ chối (chỉ người thuộc nhóm người ký hợp đồng nhận được loại này). | |
| D05 | `binh.tran` / `demo-owner` | Mở «Lịch sử uỷ quyền» | Trạng thái (còn hiệu lực / hết hạn / thu hồi), số việc đã làm thay, mở được hợp đồng. Người thường chỉ thấy uỷ quyền có mình, quản trị thấy cả công ty. Thu hồi ⇒ trạng thái đổi. | |

## 6. Dọn
Hợp đồng mẫu là hợp đồng thật của Demo, chạy xong để nguyên. Muốn làm lại từ đầu: nhờ điều phối tạo hợp đồng Kinh doanh mới dưới 100 triệu (seed không tạo lại HĐ mẫu đã rời Nháp).
