# rooms — DM / nhóm (HUB-FR-96…101, X2a)
`api.ts`: mọi gọi `/rooms*` (zod của `@ai/contracts/chat`). `hooks/`: `useRoomList` (infinite) · `useUnreadTotal` · `useRoom` · `useRoomMessages` (trang lùi `before_seq`) · mutation trong `use-room-actions` (tạo, đổi tên, thêm/bớt/chuyển, xoá/rời/ẩn, gửi tin, đánh dấu đã đọc).
`lib/`: `room-cache` (query key + vá cache thuần, dùng cho event-router F2) · `room-errors` (`roomErrorKey` mã→`rtErr.*`) · `room-logic` (tên, xem trước, "Đã xem", nhóm theo ngày). UI ở F3+.
