# prefs-sync — giao diện + ngôn ngữ theo người dùng, đồng bộ 4 web (Luật 0b, làn nhanh)

Yêu cầu: đổi theme (sáng/tối) hoặc ngôn ngữ ở một app thì mọi app khác dùng cùng thiết lập sau khi chuyển app; mặc định sáng + vi.

## Plan / quyết định
- DB: migration `0021_user_theme` (`admin.users.theme` light|dark|system, mặc định light; journal `when` 1793936800000). `locale` giữ nguyên.
- API: `/auth/me` (GET + trong TokenGrant) trả `theme`; `PATCH /auth/me` nhận `{locale?, theme?}` (ít nhất một, strict) — chỉ của chính mình. `MeSchema.theme` có `.default("light")` để mock/test khoá cũ vẫn parse.
- web-kit `prefs/prefs.ts`: thứ tự /me → localStorage (`ai.locale`, `ai.theme`) → mặc định (vi + light); áp `<html class=dark data-theme color-scheme>`; `set()` = áp + nhớ + PATCH (lỗi mạng giữ cục bộ); `reconcile(me)` khi phiên có `/me` (bỏ qua khi PATCH đang chạy). SSO không mang gì thêm — mỗi app đọc `/me`.
- Chống nháy: script inline đầu `index.html` của 4 app đọc `ai.theme` (mặc định light) trước lần vẽ đầu; `startPrefs()` trong `main.tsx` mỗi app.
- UI: `PrefsPanel` (web-kit/ui) thay công tắc riêng: admin AccountMenu, studio UserMenu, contracts UserMenu, chat SettingsDialog. Studio đổi khoá `studio.locale` → `ai.locale`; chat bỏ `ai-chat-theme`, contracts bỏ `theme`.
- Mặc định i18n mọi app = vi (thay en của CR-052); `fallbackLng` giữ en.

## Còn lại
- Trang đăng nhập vẫn có công tắc ngôn ngữ cục bộ (chưa có phiên để PATCH); sau đăng nhập `/me` thắng.
- e2e: file e2e cũ chạm công tắc ngôn ngữ/theme (nếu có) cần cập nhật ở lượt e2e cuối đợt; chưa chạy.
- Cài đặt công ty (contracts) "giao diện mặc định công ty" chỉ còn tác dụng xem thử; người dùng luôn có theme riêng (mặc định light).