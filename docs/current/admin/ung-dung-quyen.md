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
- Kịch bản: platform gán thêm quy trình; bỏ gán quy trình đang được luật dùng ⇒ 409 nêu luật số bị ảnh hưởng [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: số thứ tự luật bị ảnh hưởng lấy từ `details.rules` (priority + 1, bỏ trùng) [test: packages/web-kit/src/routing-rules.test.ts » IN_USE: số thứ tự luật = priority + 1, bỏ trùng, bỏ phần tử sai]


## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: cr112-rbac-ui).

#### Yêu cầu: Tab Phân quyền theo vai (tạo vai, gán người, Lưu một lượt) (nguồn: cr112-rbac-ui)
Màn Phân quyền có tab đầu "Vai theo ứng dụng": mỗi app một khối với các vai (mức Quản trị/Sửa/Xem, số người), tạo/sửa/xoá vai tuỳ biến, gán và gỡ người dùng nội bộ; mọi thay đổi là nháp (badge "N thay đổi chưa lưu") và chỉ ghi khi bấm Lưu. platform_admin chọn công ty; tenant_admin chỉ công ty mình.
- Kịch bản: khi tạo vai "Kế toán HĐ" mức Sửa và gán lan rồi Lưu thì Group + grant read/write + thành viên được ghi một lượt [test: e2e/app-roles.spec.ts » ADM-FR-80 · ADM-FR-82 · platform_admin: 3 vai mặc định không sửa/xoá]
- Kịch bản: khi người ở hai vai cùng app thì quyền thực tế là mức cao nhất, bỏ nháp đưa về cũ [test: e2e/app-roles.spec.ts » ADM-FR-82 AC2 · an ở 2 vai cùng app (Chỉ xem + Nhân viên)]
- Kịch bản: khi vai có mức cao hơn trần công ty thì hiện "không hiệu lực" [test: e2e/app-roles.spec.ts » ADM-BR-12 · công ty chỉ có entitlement tới Sửa]
- Kịch bản: khi tenant_admin vào Phân quyền thì thấy vai công ty mình, gán/gỡ người và xoá vai trống (gỡ người trước rồi xoá) [test: e2e/app-roles.spec.ts » ADM-FR-77 · ADM-FR-80 · ADM-FR-82 · tenant_admin (binh, acme)]
- Kịch bản: khi lưu gặp 409 VERSION_CONFLICT thì báo vai đã đổi ở nơi khác, tải lại và bỏ nháp [test: e2e/app-roles.spec.ts » ADM-FR-80 · 409 VERSION_CONFLICT: vai đổi ở nơi khác]
- Kịch bản: khi chỉnh nháp thì chỉ lưu chênh lệch, thứ tự thao tác là tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá, lỗi dừng lô [test: apps/admin-web/src/features/app-roles/lib/staging.test.ts » thứ tự tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá]

#### Yêu cầu: Kiểm tra quyền theo app của một người (nguồn: cr112-rbac-ui)
Từ bảng gán người, "Kiểm tra quyền" cho mức thực tế theo từng app và nguồn: qua vai, "quyền ngoài vai" (Group phòng ban) hoặc cấp lẻ; nguồn vượt trần ghi "không hiệu lực".
- Kịch bản: khi kiểm tra lan (nhóm phòng ban có contracts-read) thì hiện Xem qua nhóm kèm nhãn "quyền ngoài vai", không có dòng "Qua vai" [test: e2e/app-roles.spec.ts » ADM-FR-82 AC5 · Kiểm tra quyền của lan]
- Kịch bản: khi dựng giải thích từ effective-access thì tách vai khỏi quyền ngoài vai và lấy mức cao nhất hiệu lực [test: apps/admin-web/src/features/app-roles/lib/effective.test.ts » quyền qua vai + 'quyền ngoài vai' từ Group phòng ban]
