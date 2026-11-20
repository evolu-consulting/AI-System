# CR-195 · cr130-journey J2 chập chờn

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: chỉ sửa test e2e, waitForResponse khớp đúng GET /pack/contracts/partners/search thay vì mọi URL bắt đầu bằng /pack/contracts/partners, vốn bắt nhầm /partners/page trả object).

## Việc
- [x] Ca J2 bắt đúng phản hồi «Chọn đối tác» (e2e/community-web/cr130-journey.cs.ts)

## Quyết định trong lúc làm
- Nguyên nhân suy từ code (route listParties = /partners/search; trang Đối tác gọi /partners/page), chưa đọc trace.
