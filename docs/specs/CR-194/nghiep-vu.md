# CR-194 — Đối tác xem ảnh/tệp của bài + xem tệp .txt (yêu cầu 2026-11-20, cần cho demo 21/11)

Nguồn: người dùng 2026-11-20 «tôi phải thấy luôn chứ vì công ty Dung đã đánh dấu tôi có thể thấy … làm trước cho staging, và improve luôn file txt đang không view được».
Đổi so với CR-161 Q2 (`docs/specs/CR-161/spec.md:141`: bài công ty kết nối chỉ hiện chữ + số tệp).

- **BR-194-1** Người xem thuộc công ty đã kết nối, được bài cho thấy («Ai thấy bài» gồm họ), xem được ảnh/video/tệp của bài giống người nội bộ (lưới ảnh, mở lớn, tải tệp). Bỏ dòng «n tệp đính kèm».
- **BR-194-2** Không được bài cho thấy ⇒ không thấy bài, không tải được tệp (404 giống hệt tệp không tồn tại). Đoán id tệp không mở được.
- **BR-194-3** Đối tác chỉ xem/tải; không sửa, không gỡ tệp.
- **BR-194-4** Tệp .txt (và văn bản thuần: .csv, .md, .log) mở được trong hộp «Xem» (hiện chữ, giữ xuống dòng, cuộn), mọi nơi dùng hộp xem tệp chung. Tệp lớn ⇒ hiện phần đầu + nút tải.

## Quyết định trong lúc làm
- Mặc định (điều phối): BR-194-4 giới hạn hiện ≤ 1 MB đầu tệp, giải mã UTF-8.
