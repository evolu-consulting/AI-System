# cr147b-people-profile — CR-147 ý 7–9 (avatar, ảnh bìa cá nhân/công ty, chức vụ)

## Delta (so với docs/current)
- DB: hub 0142 `hub.people_profiles(tenant_id,user_id,avatar,cover,job_title)`; RLS: hub_rw đọc cùng tenant, GHI chỉ hàng của chính mình; admin_rw chỉ cột `job_title`.
- Hub API mới: `GET /people/me`, `PUT /people/me/avatar` (PNG/JPG/WebP ≤ 2 MB, null = xoá), `PUT /people/me/cover` (≤ 3 MB, cùng luật `coverBytes` của CR-138), `GET /people?ids=a,b` (≤ 50; MỘT câu SQL: tên + chức vụ + avatar + phòng ban) — dùng cho CR-148. Proxy `/people` thêm ở `rsbuild.config.ts` (workspace-web) và nginx prod dòng `processes|attachments|review-tasks|people`.
- Community: `PUT /pack/community/brand/cover` (chỉ chủ sở hữu = nhóm `admin` của gói contracts; cùng cột `company_settings.cover` CR-138, không lưu chỗ thứ hai); viewer `caps.companyAdmin`; `GET /brand/cover` đổi sang `private, no-cache` (ETag).
- Admin API: `PUT /admin/org/members/:id/title` (chức vụ ≤ 80, rỗng = xoá); `GET /admin/org` thêm `members[].job_title` (đọc `hub.people_profiles` ⇒ DB test của admin cần chạy thêm migration hub).
- Web: `PersonAvatar` (web-kit); hồ sơ cá nhân `/community/me`: đổi/xoá avatar (cắt vuông giữa ảnh, ≤ 256 px, WebP), đổi/xoá ảnh bìa cá nhân, hiện «Chức vụ» + «Phòng ban»; trang công ty: nút «Đổi ảnh bìa» chỉ khi `caps.companyAdmin`; admin-web «Cơ cấu»: khối «Chức vụ nhân viên».

## Tasks
| # | Việc | Rủi ro | Trạng thái | Test |
|---|---|---|---|---|
| 1 | Migration hub 0142 + RLS + CHECK ảnh | cao | xong | [test: apps/hub-api/src/modules/people/people.int.test.ts] |
| 2 | Hub `/people*` (theo lô một câu) | cao | xong | [test: apps/hub-api/src/modules/people/people.int.test.ts] (người khác cùng công ty, chéo tenant, hub_rw không ghi chức vụ, CHECK ảnh) |
| 3 | Ảnh bìa công ty `PUT /brand/cover`, `caps.companyAdmin` | cao | xong | [test: apps/hub-api/src/modules/packs/contracts/company-cover.int.test.ts] (editor 403, đối tác 403, thân sai, đổi/xoá, chéo tenant) ; [test: apps/hub-api/src/modules/packs/community/domain/brand.rules.test.ts] |
| 4 | Admin chức vụ `/admin/org/members/:id/title` | thường | xong | [test: apps/admin-api/src/modules/org/org.service.int.test.ts] (đặt/sửa/xoá, không đụng ảnh, chéo tenant) ; [test: apps/admin-api/src/modules/external-orgs/external-deny.int.test.ts] (403 cấp router) |
| 5 | `PersonAvatar` dùng chung | thường | xong | [test: packages/web-kit/src/ui/PersonAvatar.test.ts] |
| 6 | UI hồ sơ + Cơ cấu (ImagePick, port/adapter, MemberTitles) | thường | xong | [test: apps/workspace-web/src/modules/community/domain/image.test.ts] |
| 7 | e2e hành trình đổi avatar + ảnh bìa | thường | viết, CHƯA chạy | [test: e2e/community-web/cr147b-people.cs.ts] |

## Việc còn lại
- Chưa gắn `PersonAvatar` vào thanh trên/menu tài khoản của shell (ngoài module community) và không gắn ở PostCard/CommentItem/Composer/Thread/tin nhắn (lát sau).
- e2e P1–P3 chưa chạy; `data-testid` đoán theo khuôn có sẵn, cần chạy một lần cuối đợt.
- Chưa có test component cho `ImagePick`/`MyProfile` (chỉ logic thuần `domain/image.ts` + e2e).

## Quyết định trong lúc làm
- Một bảng hub cho cả ba trường (G1); ảnh lưu data URL (như logo/ảnh bìa công ty); client luôn cắt vuông ~256 px nên lô 50 người vẫn nhẹ.
- Chức vụ ghi từ admin-api bằng GRANT cột cho `admin_rw` (không thêm cột vào `admin.users`).
- Phòng ban hiển thị = phòng ban đầu tiên theo `key` nếu người ở nhiều phòng.
- Ảnh bìa cá nhân không nén phía client (chỉ kiểm loại + ≤ 3 MB); avatar nén WebP.
- `/people` cần proxy: thêm vào rsbuild workspace-web + nginx prod (chưa deploy).
