# Admin · ứng dụng, gói nghiệp vụ, mô hình quyền

Cập nhật: 2026-11-03 · Nguồn: PDF Phần A (ADR-0031, PK-FR-05). Hướng vai-là-nguồn (CR-112, ADR-0033): chưa code.

## Ứng dụng và gói
Hai lớp: (a) app web trong `app_catalog` (switcher "Ứng dụng" + đích SSO); (b) gói nghiệp vụ nối với app qua `required_feature`.
`admin.app_catalog` (toàn hệ thống, không RLS): key, name jsonb, icon, url, audience (all/admin/platform), required_feature, sso, sort_order, enabled, version. Seed: chat, contracts, community, studio, admin. Đọc qua `GET /me/apps` (lọc theo quyền); ghi `/admin/apps` chỉ platform_admin.
Gói: contracts (Sổ Hợp Tác), community, knowledge; mỗi gói có 3 feature `<pack>-read/-write/-admin`. `enablePack` bật gói cho tenant: tạo entitlement + 3 Group vai `<pack>-owner/-editor/-viewer` (nhãn "Toàn quyền/Nhân viên/Chỉ xem") + 6 grant + agent + NOTIFY Hub (PK-FR-05). API `GET/PUT/DELETE /admin/tenants/:id/packs`.
Nguyên tắc: vai theo app chỉ cho gói nghiệp vụ; Chat = feature `chat-app` bật/tắt theo tenant; Studio/Admin theo vai hệ thống (`required_feature=null`). Mức: Xem = read; Sửa = read+write; Quản trị = read+write+admin (cộng dồn, `PACK_ROLE_ACTIONS`). Thiếu quyền đọc ⇒ app ẩn khỏi launcher. Gói cấp qua group; backend bỏ quyền gán lẻ cho user với gói (D-11); command (BR-11) vẫn tính grant user.
Quyền: catalog/entitlement/bật gói do platform_admin; Hub đọc thẳng bảng admin.

## Feature → entitlement → grant
Bảng: `features` (key, name/description jsonb, status on/off/beta, version), `feature_commands`, `feature_entitlements` (feature × tenant), `feature_grants` (feature × tenant × group|user), `config_meta.config_version`.
- FR-30 CRUD feature (platform_admin) · FR-31 entitlement cho tenant · FR-32 grant cho group/user trong phạm vi entitlement (UI chỉ cấp cho group; cấp cho user chỉ qua API) · FR-33 kill switch: tắt feature ⇒ command biến khỏi menu ≤ 5 giây (run đang chạy vẫn xong) · FR-34 beta chỉ cho beta-testers · FR-35 ma trận feature × group · FR-36 "Kiểm tra quyền" (gồm cả agent).
- BR-11: dùng được `/cmd` khi lệnh thuộc feature F ∧ F bật (hoặc beta + user trong beta-testers) ∧ F entitlement cho tenant ∧ F grant cho user/group của user. BR-12: thu hồi entitlement ⇒ grant mất hiệu lực nhưng vẫn giữ. BR-13: workflow không có quyền riêng (quyền ở command qua feature, hoặc agent qua agent-grant). BR-14: tenant không tự tạo command/workflow/secret.
- FR-53: mỗi lần lưu tăng `config_version` + NOTIFY `config_changed` (Hub nhận ≤ 5 giây).
- Cách ly: entitlement = platform_admin; grant = tenant_admin trong tenant mình; có RLS.
- Chỉ số `caps.contracts` (CR-110) tính từ quyền gói; đối tác luôn "không có quyền".

## CR-118 · Delta gộp 2026-11-04 (đợt cr118-r1)
Mục dưới đây thắng nội dung cũ cùng chủ đề ở trên (lát: cr118-tenant-settings).

#### Yêu cầu: Gán quy trình cho tenant × khe (tập nhiều quy trình) và sửa luật chọn (nguồn: cr118-tenant-settings)
Ở trang công ty và ngăn "Công ty" của trang app, mỗi khe có khối "Quy trình được gán & luật chọn theo phòng ban": platform_admin gán thêm quy trình đã
xuất bản, bỏ gán (bị chặn khi còn luật dùng, nêu số luật bị ảnh hưởng) và sửa luật như tenant admin.
- Kịch bản: platform gán thêm quy trình; bỏ gán quy trình đang được luật dùng ⇒ 409 nêu luật số bị ảnh hưởng [test: e2e/P-a/pf4/tenant-routing.pa.ts » platform gán quy trình vào tập của tenant và bỏ gán quy trình đang được luật dùng bị 409 nêu luật]
- Kịch bản: số thứ tự luật bị ảnh hưởng lấy từ `details.rules` (priority + 1, bỏ trùng) [test: packages/web-kit/src/routing-rules.test.ts » IN_USE: số thứ tự luật = priority + 1, bỏ trùng, bỏ phần tử sai]
