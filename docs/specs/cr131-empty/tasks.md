---
id: cr131-empty
lát: cr131-empty
cr: CR-131
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Phần (a) CR-131: hình minh hoạ trạng thái trống / không tìm thấy dùng chung. Phần (b) admin-web + studio-web gửi sau.
- `@ai/web-kit/ui/EmptyState`: `EmptyState({kind, title, hint?, action?, testId?, titleTestId?, full?})`, `kind` ∈ empty/search/notFound/off/error; `NotFoundPage` (kind notFound + nút về trang chính, nhận `Link` của router app).
- Hình SVG nét mảnh inline (`illustrations/index.tsx`, 120×90, currentColor + `--primary`), không thư viện/ảnh ngoài.
- workspace-web: `Empty` thành lớp mỏng (thêm `kind`, bỏ `icon`); lọc không ra ⇒ `search`. Đường lạ ⇒ `NotFoundPage`; chi tiết HĐ + trang yêu cầu ⇒ `notFound` + nút «Về danh sách».
- chat-web: đường lạ ⇒ `NotFoundPage`; `NotFoundState`, `RoomNotFound`, `ProcessNotFound` ⇒ `EmptyState`.

## Quyết định trong lúc làm
- Web-kit không có router ⇒ `NotFoundPage` nhận prop `Link` (mặc định `<a href>`); style bằng inline + token CSS (Tailwind app không quét web-kit).
- `full` ⇒ tiêu đề là `h1` (e2e chat khoá `heading "Không tìm thấy cuộc trò chuyện"`); không `full` ⇒ `p`.
- `titleTestId` để `contract-not-visible` vẫn khớp nguyên văn một câu (e2e cr120) dù có nút bên cạnh.
- Đường lạ không còn chuyển hướng âm thầm: hiện «Không tìm thấy trang này» + nút về Tổng quan / trang chào.
- `ProcessNotFound` (tính năng chưa bật) dùng kind `off`.

## Test tối thiểu
`packages/web-kit/src/ui/EmptyState.test.tsx` (kind→hình, hint/action, NotFoundPage); `shared.test.tsx` (Empty kind).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
### ADDED web/trang-thai-trong.md
#### Yêu cầu: Trạng thái trống và không tìm thấy dùng một hình chung ở mọi app (nguồn: CR-131)
Mọi màn không có dữ liệu, lọc không ra, đường lạ/không có quyền, tính năng chưa bật hoặc mất kết nối dùng cùng một khối: hình minh hoạ theo loại + một câu nói rõ lý do + nút bước kế.
- Kịch bản: mỗi loại trạng thái hiển thị hình riêng, kèm tiêu đề, gợi ý và nút hành động nếu có [test: packages/web-kit/src/ui/EmptyState.test.tsx » EmptyState]
#### Yêu cầu: Đường lạ không chuyển hướng âm thầm (nguồn: CR-131)
Vào đường dẫn không tồn tại thì hiện một câu chung «Không tìm thấy trang này» kèm nút về trang chính (Tổng quan / trang chào).
- Kịch bản: NotFoundPage hiển thị tiêu đề và nút về trang chính [test: packages/web-kit/src/ui/EmptyState.test.tsx » NotFoundPage]

## Việc còn lại
Phần (b): admin-web, studio-web.
