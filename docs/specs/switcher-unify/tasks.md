# switcher-unify — đổi tên app chat + switcher thống nhất 4 web (Luật 0b, làn nhanh)

## Quyết định
- Tên: chat = "Chat AI" / "AI Chat" (AI System là cả nền tảng); Quản trị/Admin; Studio giữ "Studio" (Admin có thể đổi thành "Studio agent"). Seed + `fallbackApps` + guide + nhãn my-activity đổi theo.
- Migration 0017 (journal when 1793577600000): đổi tên `chat` CHỈ khi name còn đúng mặc định cũ (vi+en = "AI System") ⇒ tên admin đã sửa được giữ.
- Switcher liệt kê MỌI app mở được, gồm app hiện tại (aria-current, aria-disabled, không bấm được, nhãn "Đang dùng/Current"). Nguyên nhân "thiếu Quản trị" ở admin-web: switcher trước đây ẩn app hiện tại; `/me/apps` lọc đúng (audience admin ⇒ tenant_admin/platform_admin, cần url trong catalog). App hiện tại chưa có url trong catalog vẫn hiện (`withCurrent`, bản dựng sẵn).
- Quyền hiển thị (`canOpen`): enabled + có url + audience (all / admin = tenant_admin|platform_admin / platform = platform_admin) + required_feature (contracts-read; platform_admin bỏ qua). Studio: audience=platform ⇒ chỉ platform_admin (người thiết kế agent là platform_admin); muốn mở cho vai khác ⇒ đổi audience ở Admin → Ứng dụng.
- Vị trí: chuẩn = thanh trên Sổ Hợp Tác (52px; lưới ở góc phải, nút 40px). `TopShell` đổi theo (52px, --rule/--panel); chat-web có thanh trên mới (TopShell) thay nút ở sidebar và header mobile. Slot chuông/góp ý giữ nguyên (lát khác).
- Bàn phím/ARIA chung: ↓ mở, focus mục đầu, ↑↓/Home/End, Esc đóng + trả focus, Tab đóng. SSO handoff không đổi.

## Việc còn lại
- Server: deploy → migration 0017 tự chạy; kiểm Admin → Ứng dụng có đủ 4 URL (APP_URL_ADMIN...).
- e2e + chụp baseline chat-web/admin/studio (thanh trên đổi 60→52px, chat-web có thanh mới) chạy một lần cuối đợt; deployed 01/02/04 đã sửa selector, chưa chạy.
