# com-fix-community-login — community-web tự đăng nhập (CR-102)

| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| fix | **Đầy đủ** (auth) | Opus | — | C2, C3, C12 |

## Lỗi (e2e stack `roles.cs.ts`)
1. Đối tác không đăng nhập được: community-web dội sang `/login` của chat-web (không dành cho đối tác).
2. Chủ quản: `/sso` của chat-web chưa có phiên ⇒ đăng nhập xong rơi vào `/c/new`, không quay về Community.

## Quyết định trong lúc làm
- community-web có màn Đăng nhập riêng (`ui/Login.tsx`, `lib/login.ts`, `api/auth.ts`) như contracts-web: Mã công ty / Tên đăng nhập /
  Mật khẩu ⇒ `/auth/login` với `X-App: community` ⇒ cookie `ai_rt_community` (cơ chế cookie theo app có sẵn, không đổi backend);
  bước Đặt mật khẩu mới (`change_token`) và Xác thực hai bước (`/auth/totp/verify`); nút Đăng xuất. Bỏ tự dội sang SSO lúc khởi động.
- SSO nội bộ giữ: link "Đăng nhập bằng tài khoản AI System" ⇒ `<SSO>/sso?app=community&next=/&login=1`. chat-web `/sso` chưa có
  phiên và (`login=1` hoặc app không có form dự phòng) ⇒ `/login?next=/sso?…` (web-kit `ssoResumeLoginUrl`, chỉ đường dẫn cùng
  origin) ⇒ đăng nhập xong xin mã ⇒ đích = `target_url` catalog (admin-api). Không nhận URL quay về từ query ⇒ không open redirect.
- external-guard / externalFirewall không đổi: community-web lúc khởi động chỉ gọi `/auth/refresh|login|change-password|totp/verify`
  (không cần Bearer) và `/pack/community/*` (cho phép); dock `/conversations` chỉ chủ quản.
- `seed-community-demo --dev-fixture` (chỉ DB localhost/test, không cờ vượt): tạo tenant `demo` + `demo-owner` (mật khẩu env
  `DEMO_OWNER_PW`) và đưa demo-owner vào Group `community-owner` (thiếu ⇒ 403 PACK_FORBIDDEN cho chủ quản).
- e2e helper `_stack.ts`: chờ form đổi mật khẩu HOẶC bảng tin (SPA); đối tác đã đổi mật khẩu ⇒ thử lại bằng `CS_NEW_PW`. qc relock.

## Viec con lai
- e2e `roles.cs.ts` còn đỏ ở assertion ngoài đăng nhập (qc sửa): `partner-note` không có trên thẻ bài (chỉ ở Composer);
  "Lưu báo giá" trên bài đối tác giờ bật (C7 đã có), test còn chờ bị khoá.
- Deploy: chat-web + community-web build lại.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community). Gộp vào current/community/nghiep-vu.md §6–§9, §13 (chuông sau commit, SSO đăng nhập, cổng stockHolders).
