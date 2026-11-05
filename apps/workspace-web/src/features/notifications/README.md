# features/notifications (N3-FR-09)
Chuông thông báo in-app S16: `api.ts` gọi `/notifications*` (hub-api), `hooks/use-notifications.ts` giữ danh sách + chưa đọc + tùy chọn kênh,
`components/ConnectedBell.tsx` nối vào `NotificationBell` (shell, trình bày thuần). Đăng ký push (service worker) chưa làm ở lát N3.
