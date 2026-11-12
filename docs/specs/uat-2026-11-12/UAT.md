# UAT đợt 2026-11-12 (CR-128e, CR-129, CR-130, CR-131, CR-132, CR-133, sửa bảo mật)

Môi trường: tenant **demo** (mã công ty `demo`). Không dùng tenant evolu.
Tài khoản: nội bộ `demo-owner` (quản trị Sổ Hợp Tác), `demo-editor`, `demo-viewer`; đối tác `doitac-*`; admin nền tảng `admin`.
Mật khẩu: xem `.env.local` (`DEMO_OWNER_PW`, `SEED_ADMIN_PASSWORD`) và `.data/dev-up/demo-partners.txt`. KHÔNG ghi mật khẩu vào tài liệu.
Dữ liệu có sẵn: quy trình «Duyệt hợp đồng», «Đề nghị mua hàng»; HĐ «Hợp đồng mua văn phòng phẩm» (UAT-1) đang duyệt; Bảng tin đã bật, có bài mẫu.

Ghi kết quả: ✅ đạt · ❌ lỗi (ghi mã UC + mô tả + ảnh).

## A. Đầu trang hợp đồng (CR-128e)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| A1 | demo-owner | Tạo HĐ mới (tải file), mở trang chi tiết khi còn nháp | Thanh trên: Huỷ · Lưu nháp · 1 nút chính · «Thao tác ▾». Menu có «Xoá hợp đồng» màu đỏ ở cuối. Không có nút nào tràn hàng |
| A2 | demo-owner | Cuộn xuống trang HĐ nháp | Thanh nút dính trên cùng, vẫn đủ nút |
| A3 | người được giao duyệt UAT-1 | Mở UAT-1 khi đến lượt mình | Chỉ «Duyệt» nằm ngoài. «Trả lại sửa», «Từ chối» nằm trong «Thao tác ▾» |
| A4 | demo-owner | Mở một HĐ đã duyệt xong | Nút chính «Tải phiên bản mới»; menu có «Tạm khoá», vạch ngăn, «Xoá hợp đồng» đỏ |
| A5 | demo-owner | Tạm khoá HĐ ở A4 | Nút chính đổi thành «Mở khoá» |
| A6 | demo-owner | Xem dòng thông tin dưới tên HĐ | Có link «Xem file gốc»; trạng thái hiện tiếng Việt (vd «Nháp»), không có chữ kiểu DRAFT |
| A7 | bất kỳ | Mở chi tiết một Đối tác | 1 nút chính + «Thao tác ▾» (có «Sửa liên hệ») |
| A8 | điện thoại (màn hẹp) | Mở chi tiết HĐ | Không tràn ngang; ô «Phụ trách» có lề |

## B. Tài liệu kèm trên hợp đồng (CR-133)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| B1 | demo-owner | Ở danh sách HĐ, tải lên file .docx làm HĐ (công ty bật ký số) | Bị từ chối, câu nói rõ chỉ nhận PDF |
| B2 | demo-owner | Mở UAT-1, khối «Tài liệu kèm» ⇒ Thêm tệp .docx | Tệp hiện trong khối, tải về được |
| B3 | demo-owner | Bấm «Gỡ» tệp ở B2 | Có hộp hỏi xác nhận; xác nhận thì tệp biến mất |
| B4 | demo-owner | Thêm file .doc (Word cũ) hoặc .exe | Báo lỗi, nói rõ định dạng được nhận |
| B5 | demo-viewer | Mở UAT-1 | Xem và tải tệp kèm được; không có nút Thêm/Gỡ (nếu không có quyền sửa) |
| B6 | bất kỳ | HĐ có tệp kèm ở bước duyệt | Cùng khối hiện nhóm «tệp kèm theo bước duyệt», chỉ xem/tải |

## C. Tin nhắn (CR-132)

Mở 2 trình duyệt (hoặc 1 thường + 1 ẩn danh): A = demo-owner, B = demo-editor.

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| C1 | A | Menu trái «Tin nhắn» ⇒ «Nhắn tin mới» ⇒ chọn demo-editor ⇒ gửi «Chào» | Tin hiện ngay ở A |
| C2 | B | Không tải lại trang | Mục menu «Tin nhắn» và nút khoang trợ lý có chấm đỏ số 1; hội thoại in đậm, lên đầu |
| C3 | B | Mở hội thoại | Chấm đỏ mất; A thấy «đã xem» (nếu có) |
| C4 | A | Gửi một ảnh .png | B thấy ảnh thu nhỏ; bấm mở lớn |
| C5 | A | Gửi một file .pdf | B thấy thẻ tệp, tải về được |
| C6 | A | Thu hồi một tin của mình | Cả hai bên thấy «Tin nhắn đã được thu hồi»; không thu hồi được tin của người khác |
| C7 | A | Tạo nhóm «Nhóm UAT» với editor + viewer | Cả 3 thấy nhóm, nhắn được |
| C8 | thành viên thường | Thử bớt người khác / đổi tên nhóm | Không có nút (chỉ chủ nhóm làm được) |
| C9 | A (chủ nhóm) | Rời nhóm | Người vào sớm nhất thành chủ nhóm |
| C10 | B | Mở khoang trợ lý bên phải ⇒ tab «Tin nhắn» | Danh sách hội thoại; mở một cuộc chat, có nút ‹ quay lại; tab «Trợ lý AI» vẫn dùng bình thường |
| C11 | B | Ở màn Tin nhắn toàn màn | Không có nút trợ lý nổi che nút Gửi |
| C12 | điện thoại | Xem thanh dưới | Có mục «Tin nhắn» kèm số chưa đọc; nhãn không bị cắt |
| C13 | bất kỳ | Có tin mới | KHÔNG có thông báo trong chuông, không email (chỉ chấm đỏ) |
| C14 | demo-viewer | Thử mở link tệp của hội thoại mình không tham gia (copy link từ A) | Không xem được |
| C15 | đối tác doitac-* | Tìm mục Tin nhắn | Không có (bản đầu chỉ nội bộ) |

## D. Bảng tin (CR-129, CR-130)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| D1 | demo-editor | Đăng bài kèm 4 ảnh | Bài hiện lưới 3 ô, ô cuối «+1» |
| D2 | bất kỳ | Bấm một ảnh | Xem phóng to, ảnh ở giữa, ‹ › hai bên, «1 / 4» và «Tải về» |
| D3 | demo-editor | Đính kèm video .mp4 | Bị từ chối, câu nói rõ định dạng nhận |
| D4 | bất kỳ | Xem số lượng hàng trong bài/gợi ý | Hiện «320 cuộn», không «320.0000» |
| D5 | demo-viewer | Bình luận vào bài của người khác, gõ @ để nhắc đối tác | Bình luận được, danh sách @ hiện |
| D6 | người được @ | Mở chuông, bấm thông báo | Mở đúng bài và cuộn tới bình luận; câu thông báo gọn «A bình luận bài: “…”» |
| D7 | không phải chủ bài | Thử ẩn bình luận | Không làm được; chỉ chủ bài ẩn được |
| D8 | demo-editor (không phải quản trị) | Xem hàng đơn xin tham gia | Không thấy (chỉ quản trị Sổ Hợp Tác duyệt đơn) |
| D9 | demo-owner (quản trị) | Duyệt một đơn tham gia, chọn «gắn với đối tác có sẵn» | Duyệt được; đối tác nhập tay chưa có HĐ cũng có trong danh sách chọn |
| D10 | đối tác doitac-* | Đăng nhập, vào Bảng tin | Xem bài được chia sẻ, bình luận được; KHÔNG có nút «Mở trợ lý AI»; không vào được phần hợp đồng |
| D11 | bất kỳ | Mở chuông | Thông báo hợp đồng + Bảng tin chung một danh sách; có «Đánh dấu tất cả đã đọc» khi có tin chưa đọc |
| D12 | bất kỳ | Mở Cài đặt | Một hộp Cài đặt duy nhất, có nhóm «Bảng tin» |

## E. Bật/tắt Bảng tin (CR-130 pha 3)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| E1 | admin (nền tảng) | Admin ⇒ Công ty `demo` ⇒ thẻ Sổ Hợp Tác | Có công tắc «Bảng tin»; không còn chỗ cấp quyền riêng cho Bảng tin |
| E2 | demo-owner (quản trị công ty) | Vào màn tương tự trong admin | Chỉ xem, không bật/tắt được |
| E3 | admin | Tắt «Bảng tin» cho demo | — |
| E4 | demo-owner | Vào `/community` | Câu «Bảng tin chưa được bật cho công ty — liên hệ quản trị nền tảng»; menu không còn mục Bảng tin |
| E5 | admin | BẬT LẠI «Bảng tin» cho demo | Bảng tin dùng lại bình thường |
| E6 | admin | Tạo quy trình mới cho demo | Ô «Quy trình cho» có lựa chọn «Bảng tin» |

## F. Trang trống / không tìm thấy (CR-131)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| F1 | bất kỳ | Gõ địa chỉ sai `/contracts/abc-khong-co` | Trang «Không tìm thấy» có hình minh hoạ + nút quay về (không tự nhảy trang) |
| F2 | bất kỳ | Danh sách HĐ tìm «zzzz» | Hình minh hoạ + câu «không có hợp đồng khớp» |
| F3 | bất kỳ | Mở một danh sách chưa có dữ liệu (vd Sản phẩm của công ty mới) | Hình minh hoạ trống |
| F4 | bất kỳ | Mở link HĐ không có quyền xem | Câu «không tìm thấy / không có quyền» + nút «Về danh sách» |
| F5 | admin | Gõ địa chỉ sai trong admin | Trang không tìm thấy cùng kiểu |

## G. Sửa bảo mật (kiểm nhanh)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| G1 | người gửi HĐ (thuộc nhóm duyệt) | Bấm «Nhận việc» ở bước duyệt HĐ của chính mình | Báo «Bạn là người gửi hồ sơ này nên không nhận việc duyệt được…» |
| G2 | quản trị công ty | Uỷ quyền duyệt thay cho tài khoản đối tác | Không chọn được / bị từ chối |
| G3 | người duyệt | Ghi bằng chứng duyệt kèm tệp | Chỉ dùng được tệp mình tải lên; trường hợp khác báo «Tệp hoặc chữ ký phải do chính bạn tải lên…» |
