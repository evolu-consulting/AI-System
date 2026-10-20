# sso-switch — SSO AI System → Sổ Hợp Tác/Admin + app switcher + 2 lỗi contracts-web

## Quyết định
- Phiên vẫn riêng từng app (cookie `ai_rt_<app>`, CR-053). SSO = **mã một lần qua admin-api**, không chia cookie (chạy được cả khi các web khác cổng/khác tên miền).
- `POST /auth/sso/code` (Bearer, `{app}`) ⇒ mã 32 byte, 60 giây, lưu SHA-256 trong Redis (`SET PX` + `GETDEL`; không Redis ⇒ Map bộ nhớ). Gắn `tid/sub/sid/app`.
- `POST /auth/sso/redeem` (chỉ client web, `X-App` phải = app của mã, `tenant_key` tuỳ chọn) ⇒ phiên mới + cookie app đích. Mã cháy ngay khi trình ra; hết hạn / dùng lại / sai app / sai công ty / phiên nguồn đã đăng xuất / tài khoản khoá ⇒ 401 `UNAUTHORIZED` như nhau.
- Luồng trình duyệt: chat-web `/sso?app=…&next=…` ⇒ `<đích>/sso#code=…` (mã ở fragment). URL đích chỉ từ cấu hình build (`PUBLIC_CONTRACTS_WEB_URL`, `PUBLIC_ADMIN_WEB_URL`) ⇒ không open redirect. Không phiên ⇒ `<đích>/login?sso=none`.
- contracts-web chưa có phiên ⇒ dội về `PUBLIC_SSO_URL` (AI System) một lần/phút/tab (sessionStorage) rồi mới hiện form. `PUBLIC_TENANT_KEY` (nếu có) gửi kèm ⇒ mã công ty khác bị từ chối.
- App switcher (chat-web, thanh bên): Sổ Hợp Tác khi `/pack/contracts/me` `enabled`; Quản trị khi vai tenant_admin/platform_admin. Link thật tới `/sso?app=…`.
- sohoptac2: build arg `PUBLIC_CONTRACTS_WEB_URL` (mặc định :18431), `PUBLIC_SSO_URL` (= chat :18433); nginx chat thêm `/pack` → hub.

## Đã làm
- admin-api `modules/auth/sso/*` + int (đường chính, dùng lại/sai app, hết hạn, chéo tenant) — evotest 4/4.
- web-kit `auth/sso.ts` (+unit), `session.ssoCode/ssoRedeem`; chat-web `/sso`, `AppSwitcher`; contracts-web `/sso` + guard dội; admin-web `/sso`.
- Lỗi: `/settings` dùng `contracts.scoring.title`; `pattern="[a-z0-9\-]{2,32}"` (cờ /v).
- e2e/deployed: bỏ fixme SSO + app switcher (chưa chạy — chạy sau deploy).

## Còn lại
- contracts-web/admin-web chưa có switcher ngược về AI System (chưa có thiết kế nav-v2 cho mục này).
- combine:dev chưa đặt `PUBLIC_CONTRACTS_WEB_URL`/`PUBLIC_SSO_URL` (dev: switcher/SSO tắt — hành vi cũ).
