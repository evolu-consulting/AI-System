# gap-c · thông báo: chuông, web push, tùy chọn (làn nhanh; #11 #12 #13 #14 #35)

## Quyết định
- Hub 0053 (`when` 1796200000000): `hub.notify_prefs` + `remind_days int[]` (NULL = mặc định tenant `admin.tenants.settings.remind_days`, vắng = 60,30,7,1,0), `price_alerts`, `include_managed`. `notify.enqueue` nhận thêm `lead`/`managed` mỗi mục: lọc mốc theo tùy chọn người nhận; `managed` nhân bản tới quản lý (`admin.user_reports` + trưởng phòng) đã bật `include_managed`; kind `contract.price*` bỏ qua khi tắt `price_alerts`. Một câu cho cả lô; vòng nhắc HD4 chỉ thêm `lead`/`managed` vào JSON (số câu không đổi).
- Mốc cho phép = lưới HD4 {60,30,7,1,0} (đổi lưới = đổi lịch vòng nhắc, ngoài lát).
- Web push: SW `public/push-sw.js` (4 web, test giữ giống nhau) + `web-kit/notify/push.ts` (chỉ khi người dùng tick; HTTPS/localhost). `POST /notifications/push/test` đi đường fanout thật (khoá idempotency 30 s).
- Chuông + trang "Tất cả thông báo" + form tùy chọn = web-kit (`ui/NotificationBell`, `ui/NotificationsPage`, `ui/NotifyPrefsPanel`); admin/studio truyền `transport` (client riêng). Chuông đặt ở `children` của `TopShell` (không sửa TopShell). Contracts-web giữ chuông S16 riêng, bỏ form inline, chân luôn có "Xem tất cả"/"Cài đặt thông báo" → `/notifications`.
- #14: `confirmDelivery` trả `notice` ("kho X: a → b", giá vốn trước → sau) → `notify.enqueue` cùng tx `settle`, dedup theo mốc.

## Việc còn lại
- Cảnh báo giá: tùy chọn + lọc đã có; chưa có nơi phát `contract.price*` (price-scout chỉ ghi bảng `price_scout_alerts`).
- Màn quản trị mặc định mốc nhắc của tenant (hiện đọc `settings.remind_days`, chưa có UI ghi).
- Icon góp ý trên top bar 3 web khác: thuộc lát feedback-original (FeedbackFab); chuông đã vào cùng slot phải.
- e2e đã sửa/viết (`e2e/contracts-web/bell.cw.ts`), chưa chạy; baseline `s16-bell-*` cần chụp lại (chân chuông mới).