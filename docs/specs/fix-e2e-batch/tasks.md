# fix-e2e-batch — phân loại e2e đỏ lượt toàn bộ 20261115-063944-6236 [CR-161]

## Delta (so với docs/current)

Không đổi spec. Việc làm:
- Mock contracts-web trả `/pack/contracts/connect/links` rỗng (CR-161 thêm khối «Công ty đã kết nối») ⇒ trang Đối tác hết băng lỗi; chụp lại baseline Linux p02-partners (4 ảnh) theo UI mới có «Tìm công ty».
- Chập chờn khi tải cao, sửa chờ theo điều kiện: cr127/j06 (bấm gợi ý đối tác khi danh sách dựng lại), m3-flow AC-A07 (chờ alias vào danh sách rồi mới Lưu), m4-audit E19 (poll 20 s cho «Tải thêm»).
- Chạy lại riêng, xanh không sửa: CR130-J1, CHAT-AC-06 (chập chờn theo tải). Mục known-red m3/m4 hết hạn không gia hạn (đã sửa).
- Ngoài phạm vi e2e, báo: 24 ca int đỏ (migration hub 0142 không idempotent, v.v.) — xem báo cáo.

Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa test, mock và baseline ảnh).
