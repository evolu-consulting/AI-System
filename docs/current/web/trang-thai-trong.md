# Trạng thái trống và «Không tìm thấy» dùng chung (CR-131)

Nguồn: lát cr131-empty (workspace-web, chat-web, web-kit), cr131b-empty (admin-web, studio-web); gộp 2026-11-12. Code: `packages/web-kit/src/ui/EmptyState.tsx` (`EmptyState`, `NotFoundPage`).

#### Yêu cầu: Một khối trống chung ở mọi app
Màn không dữ liệu, lọc không ra, đường lạ/không quyền, tính năng chưa bật (`kind="off"`) hoặc mất kết nối dùng cùng khối: hình theo loại + một câu nói rõ lý do + nút bước kế. Admin và Studio dùng cùng khối; danh sách lọc không ra dùng hình «không có kết quả» kèm «Xoá bộ lọc».
- Kịch bản: mỗi loại có hình riêng, tiêu đề, gợi ý, nút hành động nếu có [test: packages/web-kit/src/ui/EmptyState.test.tsx » EmptyState]

#### Yêu cầu: Đường lạ không chuyển hướng âm thầm
Đường không tồn tại ⇒ «Không tìm thấy trang này» + nút về trang chính (Tổng quan / trang chào).
- Kịch bản: NotFoundPage có tiêu đề và nút về trang chính [test: packages/web-kit/src/ui/EmptyState.test.tsx » NotFoundPage]
