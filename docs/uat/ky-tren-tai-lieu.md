# UAT «Ký trên tài liệu» (CR-181)

Bản test (staging), công ty **Demo**. Mật khẩu KHÔNG ghi ở đây: người Demo dùng file `DEMO_OWNER.pw` trên máy chủ bản test (như `docs/uat/hop-dong-2-cong-ty.md`).
Mỗi ca: làm đúng vai, đúng tài khoản, đánh dấu Đạt hoặc Không đạt.

## 0. Chuẩn bị (điều phối làm một lần)
| Việc | Cách làm |
|---|---|
| Nạp dữ liệu | Chạy sau `--org-only` và `--partner-only`: `bash seed-demo.sh --sign-only` (trên máy chủ bản test). Chạy lại được, chỉ thêm. Từ chối chạy ngoài bản test. |
| Seed làm gì | (1) Bật «Ký trên tài liệu» cho Demo, các định dạng khác để mặc định. (2) Thêm quy trình **Duyệt và ký hợp đồng (ký trên tài liệu)**: Trưởng phòng duyệt (ý kiến + chữ ký) → Ký trên tài liệu, người ký công ty = Giám đốc. (3) Thêm hợp đồng Nháp **HĐ mẫu · Ký trên tài liệu (CR-181)** của `cuong.le`, đối tác Evolu (có email), kèm 2 PDF: hợp đồng 6 trang (trang cuối có «ĐẠI DIỆN BÊN A / BÊN B», «(Ký, ghi rõ họ tên)») và phụ lục 2 trang. |
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

## 5. Dọn
Hợp đồng mẫu là hợp đồng thật của Demo, chạy xong để nguyên. Muốn làm lại từ đầu: nhờ điều phối tạo hợp đồng Kinh doanh mới dưới 100 triệu (seed không tạo lại HĐ mẫu đã rời Nháp).
