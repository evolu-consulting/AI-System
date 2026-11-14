# cr147b-people-profile — CR-147 ý 7–9 (avatar, ảnh bìa cá nhân/công ty, chức vụ)

## Delta (so với docs/current)
- DB: hub 0142 `hub.people_profiles(tenant_id,user_id,avatar,cover,job_title)`; RLS: hub_rw đọc cùng tenant, GHI chỉ hàng của chính mình; admin_rw chỉ cột `job_title`.
- Hub API mới: `GET /people/me`, `PUT /people/me/avatar` (PNG/JPG/WebP ≤ 2 MB, null = xoá), `PUT /people/me/cover` (≤ 3 MB, cùng luật `coverBytes` của CR-138), `GET /people?ids=a,b` (≤ 50; MỘT câu SQL: tên + chức vụ + avatar + phòng ban) — dùng cho CR-148.
- Community: `PUT /pack/community/brand/cover` (chỉ chủ sở hữu = nhóm `admin` của gói contracts; cùng cột `company_settings.cover` CR-138, không lưu chỗ thứ hai); viewer `caps.companyAdmin`; `GET /brand/cover` đổi sang `private, no-cache` (ETag) để đổi ảnh thấy ngay.
- Admin API: `PUT /admin/org/members/:id/title` (chức vụ ≤ 80, rỗng = xoá); `GET /admin/org` thêm `members[].job_title`.
- Web-kit: `PersonAvatar` (ảnh tròn hoặc chữ cái đầu) + `avatarInitials`.

## Tasks
| # | Việc | Rủi ro | Trạng thái | Test |
|---|---|---|---|---|
| 1 | Migration hub 0142 + RLS + CHECK ảnh | cao | xong | [test: apps/hub-api/src/modules/people/people.int.test.ts] |
| 2 | Hub `/people*` (service/repo/routes, theo lô một câu) | cao | xong | [test: apps/hub-api/src/modules/people/people.int.test.ts] (cả ca người khác cùng công ty, chéo tenant, hub_rw không ghi chức vụ, CHECK ảnh) |
| 3 | Ảnh bìa công ty: `PUT /brand/cover`, `caps.companyAdmin` | cao | xong (route) | [test: apps/hub-api/src/modules/packs/community/domain/brand.rules.test.ts] ; int «không phải chủ sở hữu không đổi / đối tác / chéo tenant» CÒN THIẾU |
| 4 | Admin: chức vụ ở `/admin/org` | thường | xong (route) | int `setJobTitle` (admin_rw chỉ cột job_title, 404 chéo tenant) CÒN THIẾU |
| 5 | `PersonAvatar` dùng chung | thường | xong | [test: packages/web-kit/src/ui/PersonAvatar.test.ts] |
| 6 | UI hồ sơ cá nhân/công ty: đổi/xoá avatar (cắt vuông client), «Đổi ảnh bìa», chức vụ hiển thị; admin Cơ cấu ô «Chức vụ» | thường | CHƯA | e2e `e2e/` hành trình đổi avatar + ảnh bìa — CHƯA viết |

## Việc còn lại
Task 3–4 int (xem bảng), task 6 (port/adapter `http.ts`/`mock.ts` của community-web, `MyProfile.tsx`, `Profile.tsx`, `ProfileCover.tsx`, màn Cơ cấu admin-web `OrgEditorPage`/`DeptCard`, e2e).

## Quyết định trong lúc làm
- Một bảng hub cho cả ba trường (G1); ảnh lưu data URL (như logo/ảnh bìa công ty); client luôn cắt vuông ~256 px nên lô 50 người vẫn nhẹ.
- Chức vụ ghi từ admin-api bằng GRANT cột cho `admin_rw` (không thêm cột vào `admin.users`).
- Phòng ban hiển thị = phòng ban đầu tiên theo `key` nếu người ở nhiều phòng.
