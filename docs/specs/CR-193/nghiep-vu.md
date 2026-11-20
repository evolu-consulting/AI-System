# CR-193 — Phản hồi UAT 20/11 (Community, Đối tác, luật thẻ)

Nguồn: người dùng 2026-11-20, chốt «làm luôn». Thiết kế bảng tin tham chiếu: bản mẫu CR-191 `docs/specs/CR-191/prototype.html` (https://claude.ai/artifact/TSSK8gHU9pypy4L8o8hPpn).

## Community (bảng tin)
- **BR-193-1** Ô bình luận không còn nút «Nhắc tên»; nhắc người chỉ bằng gõ `@` (giữ hộp gợi ý `@`).
- **BR-193-2** Máy tính: nút «Lọc» là nút nổi (góc phải dưới, như điện thoại), bỏ thanh lọc dính. Số bộ lọc đang bật hiện trên nút.
- **BR-193-3** Màu + khoảng cách khớp thiết kế: nền trang `--background` (sáng `#f4f4f9`), thẻ nền `--card` (trắng), viền `--border`, bo 10px, đệm 16px (điện thoại 12px), giữa các bài 12px; bình luận là bong bóng nền `--muted`, không viền.
- **BR-193-4** Thẻ bài đã đăng KHÔNG có dải màu bên trái; loại bài nhận ra bằng nhãn có biểu tượng.
- **BR-193-5** Ô đăng bài («Viết bài…») KHÔNG dính khi cuộn (cuộn đi theo trang).

## Toàn hệ thống (UI/UX)
- **BR-193-6** Hộp thoại: tiêu đề và nút «x» canh giữa theo chiều dọc (sửa ở khuôn hộp thoại dùng chung).
- **BR-193-7** Mở trang mới ⇒ bắt đầu ở đầu trang. Nút «Quay lại» của trình duyệt ⇒ về đúng chỗ đã đọc.
- **BR-193-8** Chi tiết hợp đồng (`/contracts/c/:id`): khung xem PDF đủ rộng để thấy hết chiều ngang trang ở màn ≥ 1280px, không cuộn ngang; cột thông tin bên cạnh rộng cố định.

## Luật thẻ (ghi vào `packages/web-kit/src/ui/kit/RULES.md`)
- **L1** Mọi thẻ nền `--card` (sáng: trắng) trên nền trang `--background`.
- **L2** Không thẻ trong thẻ: trong một thẻ, tách phần bằng tiêu đề nhỏ hoặc đường kẻ mảnh (`--row-divider`). Không lồng khung có viền + bo góc. Ngoại lệ: ô nhập liệu; khối nền `--muted` không viền (bong bóng bình luận, ghi chú).
- **L3** Mỗi trang một thanh cuộn (của trang). Danh sách/bảng không cuộn riêng. Ngoại lệ: hộp thoại, danh sách thả xuống, khung Tin nhắn toàn màn.
- **L4** Kích thước thẻ: đệm 16px (điện thoại 12px), cách nhau 12px, bo 10px.

## Sổ Hợp Tác › Đối tác (làm sau khi duyệt bản mẫu `docs/specs/CR-193/prototype.html`)
- **BR-193-9** «Yêu cầu kết nối» + «Yêu cầu tham gia» gộp một thẻ «Yêu cầu chờ duyệt»: mỗi yêu cầu một dòng gọn, tối đa 3 dòng + «Xem thêm»; không có yêu cầu ⇒ ẩn thẻ.
- **BR-193-10** «Cho phép tìm thấy» + «Đang kết nối» thành một dòng gọn đầu trang (công tắc + số công ty đang kết nối, bấm mở danh sách).
- **BR-193-11** Bảng đối tác dùng thanh cuộn của trang (L3).

### Quyết định từ bản mẫu (2026-11-20, người dùng «mẫu trang Đối tác ok» ⇒ theo mặc định)
- Q1 Bố cục máy tính: **A** — thẻ «Yêu cầu chờ duyệt» nằm trên bảng (điện thoại cũng vậy).
- Q2 «Lời mời mình đã gửi»: cuối thẻ «Yêu cầu chờ duyệt», dưới tiêu đề nhỏ.
- Q3 Dòng «Mình giao đúng hạn …»: một dòng chữ nhỏ dưới tiêu đề trang, không khung.
- Q4 «Xem thêm»: mở rộng ngay trong thẻ, có «Thu gọn».
