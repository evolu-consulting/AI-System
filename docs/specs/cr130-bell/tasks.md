---
id: cr130-bell
lát: cr130-bell
cr: CR-130
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
CR-130 pha 2 «một chuông». Phần «một nguồn đối tác» ĐÃ xong (contracts 0103–0105, community 0011). Còn: workspace-web bỏ chuông riêng, dùng `NotificationBell` web-kit.
So hai bản — workspace có mà web-kit chưa: (1) hàng là link thật (`<a href>`, hỗ trợ link có query `/community?post=<id>`), (2) in thời điểm tạo, (3) ẩn chân «Xem tất cả/Cài đặt» khi không có gói Sổ Hợp Tác. Nhóm theo app/đánh dấu đã đọc/«Xem tất cả» đã có ở web-kit (nguồn thông báo chung `hub.notifications`, kind community + contracts; không có kind tin nhắn — CR-132 để ngoài chuông).

## Làm
- web-kit `NotificationBell`: props `showFooter`, `linkRows`, `formatTime`; tách `NotificationRow` (export). Mặc định giữ nguyên hành vi cho chat/admin/studio.
- workspace `features/notifications/components/ConnectedBell.tsx`: chỉ cấu hình (nhãn i18n, router.navigate, packs). Wrapper `data-testid="topbar-bell"` ở `Header.tsx` giữ nguyên.
- Gỡ: `notifications/api.ts`, `hooks/use-notifications.ts`, `shell/components/NotificationBell.tsx`, `NotificationItems.tsx` (+ test cũ).

## Không làm / Chạm
Không đổi API/bảng hub, không SSE, poll 60s như cũ. e2e có thể vỡ (không sửa): `e2e/contracts-web/bell.cw.ts` (chấm «Chưa đọc», link hàng, chân — giữ role/nhãn; hàng giờ là `<a>`, hiện thêm dòng ngày; bell nay là `header button[aria-label^="Thông báo"]` vẫn khớp), `e2e/community-web/{cr129-mention,feed,sidebar-one,cr130-journey}` (testid `topbar-bell` giữ), baseline `s16-bell-*.json` có thể lệch (danh sách lấy 10 thay vì 20).

## Test tối thiểu
`apps/workspace-web/src/features/notifications/notification-row.test.tsx`; `bun test packages/web-kit`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp



#### Yêu cầu: Một chuông thông báo dùng chung (nguồn: cr130-bell)
Workspace-web dùng đúng component chuông của web-kit như chat/admin/studio; thông báo Community và Sổ Hợp Tác chung một chuông, bấm hàng mở đúng trang (kể cả `/community?post=<id>`); chân «Xem tất cả/Cài đặt thông báo» chỉ khi người dùng có gói Sổ Hợp Tác; tin nhắn không vào chuông.
- Kịch bản: hàng thông báo có link là liên kết thật, chưa đọc có chấm và đậm, hiện ngày tạo [test: apps/workspace-web/src/features/notifications/notification-row.test.tsx » linkRows: <a href> thật, chưa đọc có chấm + đậm, có giờ]
- Kịch bản: mặc định (chat/admin/studio) hàng vẫn là nút, đã đọc không chấm [test: apps/workspace-web/src/features/notifications/notification-row.test.tsx » mặc định: nút; đã đọc không chấm; không link vẫn là nút]

## Quyết định trong lúc làm
Thêm props vào chuông web-kit thay vì slot render: ít bề mặt, 3 app kia không đổi.

## Việc còn lại
Chạy e2e bell/community ở lượt e2e cuối đợt; cập nhật baseline s16-bell nếu lệch.
