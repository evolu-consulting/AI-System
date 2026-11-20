# CR-195 · cr130-journey J2 chập chờn

Trạng thái gộp: chưa gộp

## Delta (so với docs/current)
- Không thay đổi hành vi (lý do: chỉ sửa test e2e, waitForResponse khớp đúng GET /pack/contracts/partners/search thay vì mọi URL bắt đầu bằng /pack/contracts/partners, vốn bắt nhầm /partners/page trả object).
- [x] Ca J2 bắt đúng phản hồi «Chọn đối tác» [test: CR130-J2 · duyệt đơn tham gia «Gắn với đối tác có sẵn» ⇒ hồ sơ SHT hiện tài khoản]

## Quyết định trong lúc làm
- Nguyên nhân suy từ code (route listParties = /partners/search; trang Đối tác gọi /partners/page), chưa đọc trace.
