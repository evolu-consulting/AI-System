# cr147b-people-profile — CR-147 ý 7–9 (avatar, ảnh bìa cá nhân/công ty, chức vụ)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED community/ho-so-nguoi.md

#### Yêu cầu: Người dùng tự đổi ảnh đại diện
Ảnh JPG/PNG/WebP ≤ 2 MB, client cắt vuông giữa ảnh (≤ 256 px); chưa có ảnh ⇒ chữ cái đầu; có nút xoá. Chỉ đổi được ảnh của chính mình.
- Kịch bản: khi người dùng chọn ảnh hợp lệ thì lưu, đọc lại thấy ảnh, xoá bằng null thì về chữ cái đầu [test: apps/hub-api/src/modules/people/people.int.test.ts » tự đổi avatar + ảnh bìa, đọc lại, xoá bằng null]
- Kịch bản: khi người khác cùng công ty hoặc công ty khác ghi vào hàng của tôi thì bị chặn (RLS) [test: apps/hub-api/src/modules/people/people.int.test.ts » N2 · người khác cùng công ty không ghi được hàng của tôi]
- Kịch bản: khi ảnh sai định dạng hoặc quá lớn thì bị từ chối [test: apps/hub-api/src/modules/people/people.int.test.ts » luật ảnh (cùng CR-138)]
- Kịch bản: khi chọn tệp thì kiểm định dạng/dung lượng theo loại ảnh và cắt vuông giữa ảnh [test: apps/workspace-web/src/modules/community/domain/image.test.ts » định dạng + dung lượng theo loại ảnh; apps/workspace-web/src/modules/community/domain/image.test.ts » cắt vuông giữa ảnh]
- Kịch bản: khi chưa có ảnh thì avatar là chữ cái đầu của tên (một từ ⇒ 1 chữ, nhiều từ ⇒ từ đầu + từ cuối) [test: packages/web-kit/src/ui/PersonAvatar.test.ts » một từ ⇒ 1 chữ]
- Kịch bản: khi người dùng đổi rồi xoá ảnh ở hồ sơ cá nhân thì thấy ảnh, tải lại vẫn còn, xoá về chữ cái đầu [test: e2e/community-web/cr147b-people.cs.ts » P1 · đổi + xoá ảnh đại diện ở hồ sơ cá nhân]

#### Yêu cầu: Ảnh bìa hồ sơ cá nhân
Chỉ chính người đó đổi; cùng luật PNG/JPG/WebP ≤ 3 MB với ảnh bìa công ty.
- Kịch bản: khi tệp sai định dạng thì báo «Chỉ nhận ảnh JPG, PNG hoặc WebP» và không lưu; ảnh hợp lệ thì còn sau khi tải lại [test: e2e/community-web/cr147b-people.cs.ts » P2 · ảnh bìa cá nhân: đổi, tải lại còn, tệp sai định dạng bị từ chối]

#### Yêu cầu: Chủ sở hữu đổi ảnh bìa công ty ngay ở hồ sơ công ty
Dùng chung nguồn `company_settings.cover` (CR-138), không lưu chỗ thứ hai; nút «Đổi ảnh bìa» chỉ hiện khi `caps.companyAdmin`.
- Kịch bản: khi người không phải chủ sở hữu hoặc đối tác đổi ảnh bìa công ty thì 403 và ảnh không đổi [test: apps/hub-api/src/modules/packs/contracts/company-cover.int.test.ts » không phải chủ sở hữu (editor) ⇒ 403, đối tác ⇒ 403]
- Kịch bản: khi chủ sở hữu đổi hoặc xoá thì người khác thấy ngay và cùng nguồn với /company/cover [test: apps/hub-api/src/modules/packs/contracts/company-cover.int.test.ts » chủ sở hữu đổi + xoá: người khác (editor, đối tác) thấy ngay]
- Kịch bản: khi chủ sở hữu tenant B đổi thì chỉ đổi bìa của B, người tenant A mang tenant B bị 403 [test: apps/hub-api/src/modules/packs/contracts/company-cover.int.test.ts » chéo tenant: chủ sở hữu B chỉ đổi bìa của B]
- Kịch bản: khi chủ sở hữu bấm «Đổi ảnh bìa» ở trang công ty thì ảnh hiện, tải lại còn, xoá về nền màu chủ đạo [test: e2e/community-web/cr147b-people.cs.ts » P3 · chủ sở hữu đổi ảnh bìa công ty ngay ở trang công ty]

#### Yêu cầu: Thẻ người theo lô (chức vụ, phòng ban, avatar)
`GET /people?ids=` (≤ 50 id, một câu SQL) trả tên, chức vụ, avatar, phòng ban đầu tiên theo khoá; hồ sơ cá nhân hiện chức vụ + phòng ban.
- Kịch bản: khi xin nhiều id thì trả thẻ đủ trường, id lạ/chéo tenant bị bỏ [test: apps/hub-api/src/modules/people/people.int.test.ts » đọc thẻ người theo lô]

### ADDED admin/chuc-vu-nhan-vien.md

#### Yêu cầu: Quản trị công ty nhập chức vụ ở «Cơ cấu»
`PUT /admin/org/members/:id/title` (≤ 80 ký tự, rỗng = xoá); `GET /admin/org` trả `members[].job_title`; admin chỉ ghi được cột chức vụ, không đụng ảnh của người dùng.
- Kịch bản: khi quản trị đặt, sửa, xoá chức vụ thì đọc lại ở cơ cấu đúng và ảnh không đổi [test: apps/admin-api/src/modules/org/org.service.int.test.ts » đặt, đọc lại ở getOrg, sửa, rỗng/null ⇒ xoá]
- Kịch bản: khi quản trị công ty khác ghi chức vụ cho người không thuộc công ty mình thì NOT_FOUND và không ghi [test: apps/admin-api/src/modules/org/org.service.int.test.ts » chéo tenant: quản trị công ty khác ⇒ NOT_FOUND và không ghi]
- Kịch bản: khi người dùng ngoài (đối tác) gọi route chức vụ thì 403 [test: apps/admin-api/src/modules/external-orgs/external-deny.int.test.ts]

## Ghi chú thay đổi kỹ thuật
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
