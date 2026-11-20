# UAT trình duyệt — bản test (CR-187..192), 2026-11-20

Người chạy: agent qc-uat (Chromium headless), tenant demo. Ảnh: thư mục này. Điều phối chép lại từ báo cáo agent (agent không ghi được file).

**Tổng: Cao 3 · Trung 6 · Thấp 7.**

## Cao
1. Bài «Chỉ nội bộ» hiện nhãn «Bạn bè» ở đầu bài (`66-pc-sang-bai-thu-da-dang.png`) — sai BR-191-7.
2. Gõ «@» trong «Viết bài…» mở hộp «Nhắc tên» (ô tích, «Xong (0 người)») chồng lên hộp đăng (`64-pc-sang-at-nhac-ten.png`) — BR-191-8 là danh sách thả tại chỗ.
3. Hộp cắt ảnh đại diện/bìa trống, không thấy ảnh (`91b-pc-sang-hop-cat-anh-dai-dien.png`; JPG 1600×1000, PNG 800×800) — cần xác nhận trên Chrome thường.

## Trung
4. «Gửi lời mời kết nối» ở kết quả tìm gửi ngay, không xác nhận/không lời nhắn; «Thu hồi» không hỏi lại.
5. Chữ ký ở chế độ Tối: mực đen trên nền tối.
6. Sơ đồ tổ chức trên điện thoại thu nhỏ quá (chữ ~4px).
7. Bảng tin «Lọc» chỉ có «Tất cả» / «Công ty mình», thiếu «Đối tác» và từng công ty.
8. Đối tác (điện thoại): cột «Tóm tắt» bị cắt; nút trợ lý che công tắc «Cho công ty khác tìm thấy» (bố cục cũ — CR-193 đã thay).
9. Tin nhắn: chỉ 3/14 dòng có nút «⋯» (cần xác nhận).

## Đạt
Chữ ký (dòng dưới chữ ký, 6 phông, lịch sử, giấy tờ đã ký) · Kiểm tra tệp (khớp / không khớp / bản HĐ khác) · Đổi mật khẩu tại chỗ · Thành viên & phòng ban (Sơ đồ trước, Cấp quản lý chỉ trưởng phòng) · Admin › Cơ cấu (thêm, trùng tên, xoá) · Tin nhắn (nhóm, ghim, màn chào) · Bảng tin «Ai thấy bài», đăng/xoá · Đối tác tìm + trang công ty · không tràn ngang (máy tính/390px, sáng/tối).

## Chưa kiểm
- «Ký ngày …»: demo không có việc ký đang chờ ⇒ cần `seed-demo.sh --sign-new`.
- Bình luận chéo công ty, bài «Đối tác»: tài khoản công ty evolu đăng nhập lỗi trên bản test.
- «Xem thêm (n)» (nhóm lớn nhất 14), ghim bằng giữ lâu, «Hoàn tác» xoá phòng, tương phản màu avatar.

## Dọn
Đã xoá phòng thử, bài thử, bỏ ghim; một lời mời kết nối lỡ gửi tới «Công ty EvoluConsultants» đã thu hồi. Không đổi mật khẩu, không lưu chữ ký/ảnh, không ký.
Máy chủ bản test tự khởi động lại ~00:19 (giờ máy chủ) giữa phiên.
