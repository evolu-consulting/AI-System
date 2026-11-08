# Admin · Tab Ứng dụng gọn và nhất quán

Cập nhật: 2026-11-09 · Gộp từ: cr121-f11-apps-simple (đợt cr125-wave).

## Yêu cầu: Tab Ứng dụng gọn và nhất quán (nguồn: cr121-f11-apps-simple)
Bảng ứng dụng chỉ nêu lý do khi khác hiển nhiên, số ứng dụng đang bật đếm một cách (không tính Cơ bản), thanh lưu chỉ hiện khi có thay đổi; thanh bên nhớ mở/thu gọn theo lần bấm gần nhất.
- Kịch bản: Cơ bản không tính vào "ứng dụng đang bật x / y" [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » CR-121 f11 · appsOnCount (một cách đếm)]
- Kịch bản: thanh bên nhớ lần bấm gần nhất, kho lỗi thì mở [test: apps/admin-web/src/features/shell/lib/sidebar-pref.test.ts » CR-121 f11 · sidebar-pref]
