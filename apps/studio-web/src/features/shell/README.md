# features/shell

Khung Studio [HUB-FR-72] (H4a): topbar "✦ Agent Studio" + badge `hub config vN` (`ConfigBadge`), sidebar theo `lib/nav.ts` (mục chưa làm mờ "Sắp có"), menu người dùng + đăng xuất (`use-logout`), banner mất mạng (`use-online`, `OfflineBanner`), trang 403/404.

- `api.ts`: `meQuery` (`GET /studio/api/me`); `use-me` đọc dữ liệu đã nạp ở guard.
- `lib/guard.ts`: guard `_authed` — chưa có phiên ⇒ `/login?next=`; `me` 403 ⇒ `/forbidden`.
- `SessionWatcher`: phiên hết hạn/403 giữa phiên ⇒ điều hướng (TD #85: điều hướng 2 lần khi `me` 403).
- Link "⇄ Admin" chỉ hiện khi có `PUBLIC_ADMIN_WEB_URL`.

Bẫy: sidebar ẩn dưới `lg`, chưa có menu thay (TD #81).
