# CR-125 · Đánh giá sản phẩm qua demo (góc người dùng doanh nghiệp nhỏ)

Bản soát: 2026-11-07, chỉ soát (không sửa code). Nguồn: demo stack 36xx (đăng nhập lại 4 vai, xem tổng quan/chuông/danh sách ở desktop và điện thoại 390 px), ảnh `.data/demo/shots/` (worktree `cr122-demo-video`), `CR-123/ux-review-ceo.md` (30 điểm, không nhắc lại từng điểm), spec CR-123/124/125.
Lưu ý: tenant demo hiện tại không còn hợp đồng ⇒ phần thẻ hợp đồng, ký, kế toán đánh giá từ ảnh demo; "Gửi đối tác xác nhận" (CR-124) **chưa có trong sản phẩm**, chỉ có spec.

## 1. Kết luận theo vai (một dòng)
- **Giám đốc:** *Chưa mua* — thích ý tưởng "quy trình theo giá trị + AI đọc + ký số", nhưng mở app thấy doanh thu 0đ, "Cần xử lý: 0 việc" dù có HĐ chờ ký, trên điện thoại không có mục "Chờ tôi duyệt/ký"; thiếu cảm giác "tôi nắm được mọi thứ trong 10 giây".
- **Quản trị công ty:** *Dùng được nếu có người hướng dẫn* — sơ đồ kéo-thả, điều kiện HOẶC, chặn nối sai luật là điểm mạnh; nhưng sơ đồ chồng ô, chọn người duyệt lẫn nhóm kỹ thuật ("Beta testers"), "Nếu từ chối → Bước tiếp theo" dễ cấu hình sai mà không ai báo.
- **Sale:** *Dùng* — tải PDF scan 28 trang, AI tự điền tên, đối tác, giá trị, mốc là lý do đủ để dùng hằng ngày; còn ngại vì tên nút không nói "gửi duyệt", ngày kiểu Mỹ (09/30/2031), không biết đang chờ ai.

## 2. Tính năng theo vai
| Tiêu chí | Giám đốc | Quản trị công ty | Sale |
|---|---|---|---|
| **Giá trị** | + Quy trình tự rẽ theo giá trị (>120 triệu / đối tác mới); ký số gắn với bản đã duyệt, nội dung khoá. − Chưa thấy tổng số HĐ chờ mình, chưa có số tiền đang chờ ký | + Tự sửa quy trình không cần IT; sao từ mẫu Thư viện, quay về bản gốc. − Chưa có thư viện mẫu theo ngành / loại HĐ | + AI đọc PDF scan, gợi ý mốc thanh toán; không phải gõ tay. − Loại HĐ AI chọn sẵn dù "chưa chắc" |
| **Tốc độ** | + Ký từ thẻ HĐ một nút. − Phải mở thẻ dài, cuộn qua form sửa mới thấy việc của mình | + Thêm bước, nối mũi tên, lưu một nút. − Sơ đồ không tự vừa khung, ô chồng nhau, phải kéo | + Tải lên → kiểm ô vàng → gửi. − Không thấy hạn/người duyệt nên phải hỏi miệng |
| **Kiểm soát** | + Thấy từng bước: ai duyệt, lúc nào. − Không có "nhắc / chuyển người khác / vượt cấp" khi trưởng phòng ngồi lâu | + Chặn nối sai ("Ký số cần bước Duyệt ngay trước"). − Không cảnh báo cấu hình rủi ro (từ chối mà vẫn đi tiếp, bước không có người) | − Không thấy rõ ai đang giữ HĐ; "Gửi ký" hiện cả cho người không ký |
| **Tin cậy** | + Khoá nội dung khi ký; tải bản đã ký. − Email người ký và tên "DocuSign" lộ trên thẻ; nút "Huỷ ký" cạnh "Ký ngay" | + "Lưu và áp dụng": HĐ đang chờ giữ bản cũ. − Chân trang không nói rõ đã áp dụng lúc nào | + Lịch sử thay đổi (ai · làm gì · lúc nào) có trong thẻ. − Nằm cuối trang, khó tìm |
| **Điện thoại** | − Có bố cục di động, nhưng thanh dưới không có "Chờ tôi duyệt"; chuông là lối vào duy nhất | − Sửa sơ đồ trên điện thoại không thực tế (chấp nhận được) | ± Tải lên được, danh sách gọn; nút "Xuất / Thêm giao dịch / Upload" chiếm nửa màn hình |
| **Báo cáo** | − Tổng quan là số kinh doanh (doanh thu, hàng đang giữ), không có: thời gian duyệt trung bình, HĐ kẹt, HĐ sắp hết hạn theo người | − Không có báo cáo "bước nào chậm nhất" theo quy trình | − Không có "HĐ của tôi theo trạng thái" |
| **Thiếu hẳn** | Gửi đối tác xác nhận (CR-124 chưa làm); duyệt bằng Zalo/email một chạm | Nhắc tự động, chuyển cấp khi quá hạn, ủy quyền khi vắng | Mẫu HĐ để soạn mới; nối hoá đơn điện tử / kế toán |

## 3. Top 10 điểm vướng (xếp theo mức ảnh hưởng)
| # | Màn hình | Người dùng bối rối vì | Sửa cụ thể | Công |
|---|---|---|---|---|
| 1 | Tổng quan + chuông (giám đốc, mọi vai) | "Cần xử lý: 0 việc" trong khi có HĐ chờ ký; số doanh thu 0đ chiếm cả màn | Thẻ đầu trang "Chờ bạn: 2 HĐ ký · 1 HĐ duyệt" (đếm từ cùng nguồn với "Chờ tôi duyệt"), bấm thẳng vào việc; số kinh doanh xuống dưới | S |
| 2 | Thanh dưới trên điện thoại | Không có "Chờ tôi duyệt"; giám đốc ra ngoài không biết vào đâu để ký | Thêm mục "Chờ tôi" (có số đỏ) vào thanh dưới, thay "Sản phẩm & Giá" với vai không bán hàng | S |
| 3 | Thẻ HĐ của giám đốc khi tới lượt ký | "Ký ngay" mờ + "Làm mới trạng thái" + "Huỷ ký" cùng hàng; "Các bước duyệt" lại ghi "Đang chờ ký" ở dòng khác — không biết bấm gì | Một banner "Chờ bạn ký · hạn 7 ngày" + một nút "Ký ngay" (tự cập nhật, bỏ "Làm mới trạng thái"); "Huỷ ký" vào menu "…" | M |
| 4 | Panel bước Duyệt (sơ đồ) | "Nếu từ chối, đi tới: Bước tiếp theo" là mặc định — từ chối mà HĐ vẫn đi tiếp | Mặc định "Kết thúc · Từ chối", "Trả lại" mặc định về người tạo; cảnh báo khi lưu nếu từ chối trỏ tới bước sau | S |
| 5 | Chọn "Ai duyệt" / "Người ký phía công ty" | Danh sách lẫn "Beta testers", "Sổ Hợp Tác – Chỉ xem"; demo thật đã gán "Kế toán duyệt chi · Beta testers" | Chỉ liệt kê phòng ban/chức danh có quyền duyệt, theo tên người ("Giám đốc Hùng"); ẩn nhóm kỹ thuật | S |
| 6 | Sơ đồ quy trình | Ô "Kế toán duyệt chi" đè lên "Kết thúc · Đã duyệt", ô bị cắt mép trái, nhãn "Đúng/Sai" | Tự "Sắp xếp" + "Vừa khung" sau mỗi lần thêm bước; khung cao hơn; "Có/Không" thay "Đúng/Sai" | M |
| 7 | Kiểm tra HĐ sau khi AI đọc (sale) | Nút "Xác nhận và lưu" không nói là gửi duyệt; sau đó không biết ai duyệt, bao lâu | Nút "Gửi duyệt"; sau khi gửi: "Đã gửi Trưởng phòng Lan · hạn 2 ngày" | S |
| 8 | Ô ngày (mốc AI tìm thấy) | "09/30/2031" kiểu tháng/ngày — dễ nhập sai hạn thanh toán | Ô ngày dd/mm/yyyy theo locale toàn app | S |
| 9 | Thẻ HĐ của trưởng phòng/kế toán | Toàn bộ form sửa ("Lưu thay đổi", "Giao cho", "Sản phẩm", "Hạn chót hành động còn 1728 ngày", "Ghi nhận xử lý") hiện cho người chỉ cần duyệt; nút "Gửi ký" hiện cho trưởng phòng | Thẻ tóm tắt cho người duyệt: đối tác · giá trị · hiệu lực · file gốc + Duyệt / Trả lại / Từ chối; form sửa gập lại; ẩn "Gửi ký" với người không có quyền | M |
| 10 | Panel điều kiện "Nếu" | "120000000" không dấu chấm; câu tóm tắt "đi tới Bước 2"; ô "Mặc định" ở Ký số (thứ tự, hạn, nhắc) không nói mặc định là gì | Ô tiền "120.000.000 đ"; tóm tắt bằng tên bước; ghi rõ "Mặc định: 7 ngày, nhắc mỗi 24 giờ" | S |

## 4. Video demo cho người quản lý sản phẩm (PM)
**Nên cho xem**
- AI đọc bản scan 28 trang ⇒ điền tên, đối tác, giá trị, mốc trong vài giây (điểm "wow" thật).
- Sửa quy trình bằng kéo-thả: thêm bước Kế toán, nối "Ký xong" → Kế toán, điều kiện "> 120 triệu HOẶC đối tác mới".
- Chặn nối sai có lý do rõ ("Ký số cần một bước Duyệt ngay trước") — cho thấy sản phẩm chống cấu hình hỏng.
- Một HĐ đi hết: Trưởng phòng duyệt → nội dung khoá → Giám đốc ký → Kế toán duyệt chi, mỗi bước có tên người + giờ.

**Tránh trong video**
- Tổng quan 0đ / "0 việc", danh sách trống của kế toán.
- Sơ đồ có ô chồng nhau (bấm "Sắp xếp" trước khi quay), nhãn "Đúng/Sai", danh sách nhóm "Beta testers".
- Nút "Làm mới trạng thái", email + "DocuSign" trên thẻ, "còn 1728 ngày".
- Không nói tới "Gửi đối tác xác nhận" như tính năng có sẵn — chỉ nêu là lộ trình.

**Kịch bản 3 phút**
| Thời gian | Cảnh | Câu dẫn |
|---|---|---|
| 0:00–0:20 | Vấn đề | "HĐ trên 100 triệu phải qua 3 người, hôm nay chạy bằng Zalo và giấy." |
| 0:20–1:00 | Quản trị sửa quy trình | Thêm bước Kế toán, nối mũi tên, thêm điều kiện HOẶC, thử nối sai bị chặn, "Lưu và áp dụng". |
| 1:00–1:40 | Sale tải PDF | AI đọc ô vàng cần kiểm, sửa một ô, gửi duyệt. |
| 1:40–2:10 | Trưởng phòng duyệt | Một nút Duyệt; nội dung khoá. |
| 2:10–2:40 | Giám đốc ký | Chuông ⇒ thẻ HĐ ⇒ "Ký ngay" (chọn cách ký nếu công ty bật nhiều cách). |
| 2:40–3:00 | Kết | Kế toán duyệt chi; danh sách HĐ + lịch sử ai làm gì lúc nào; slide lộ trình: gửi đối tác, nhắc tự động, di động. |

## 5. Khoảng cách so với đối thủ thường gặp (eContract/VNPT, MISA AMIS, FPT eContract, Base Workflow, DocuSign CLM)
- **Duyệt trên điện thoại:** đối thủ có app/Zalo OA duyệt một chạm; ta có web di động nhưng không có lối "Chờ tôi" và không có thông báo đẩy.
- **Nhắc và chuyển cấp:** đối thủ nhắc tự động, chuyển cấp/ủy quyền khi vắng; ta chỉ có hạn trả lời và nhắc ở bước Ký số, không có ủy quyền.
- **Bảng điều khiển quy trình:** đối thủ có thời gian duyệt trung bình, HĐ kẹt, bước chậm nhất; ta chưa có.
- **Thư viện mẫu HĐ / soạn từ mẫu:** đối thủ có mẫu theo ngành và điền biến; ta chỉ nhận file tải lên (bù lại AI đọc file tốt hơn).
- **Liên kết hoá đơn điện tử / kế toán:** MISA, FPT nối sẵn hoá đơn, sổ kế toán; ta chưa có (Kế toán duyệt chi chỉ là bước duyệt).
- **Ký số trong nước:** đối thủ có chữ ký số nhà cung cấp VN (VNPT-CA, Viettel-CA, MISA eSign) là mặc định; ta mới DocuSign sandbox + "Ký thử", nhiều nhà cung cấp mới ở mức spec/khung.
- **Gửi đối tác xác nhận / ký hai bên:** đối thủ gửi link ký cho bên kia là tính năng gốc; ta mới có spec CR-124.
- **Điểm hơn đối thủ:** AI đọc bản scan và tự rẽ quy trình theo giá trị/đối tác mới — nên đặt làm thông điệp chính.
