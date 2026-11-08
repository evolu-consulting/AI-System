# Admin · Ops phát hiện lệch giữa vai hub và vai theo ứng dụng

Cập nhật: 2026-11-09 · Gộp từ: cr121-c19-app-roles-check (đợt cr125-wave).

## Yêu cầu: Ops phát hiện lệch giữa vai hub và vai theo ứng dụng (nguồn: cr121-c19-app-roles-check)
Check `app_roles` của ops-watch so vai hub (platform_admin, tenant_admin, member) với vai theo ứng dụng: báo đỏ khi quản trị công ty chưa có mức Quản trị ở app đang bật, mã vai app trùng tên vai hub, thành viên vai app thuộc công ty khác, hoặc có vai app của app công ty không bật; báo vàng khi thành viên có quyền vượt trần mức của app. App của tính năng lấy từ cột ứng dụng của tính năng.
- Kịch bản: khi quản trị công ty (tenant_admin) chưa có mức Quản trị ở app đang bật thì check báo đỏ nêu công ty, vào nhóm có quyền quản trị thì hết [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R1 · tenant_admin chưa có mức Quản trị ở app đang bật (trần Quản trị) ⇒ crit nêu công ty, vào nhóm có grant -admin ⇒ hết]
- Kịch bản: khi thành viên có quyền vượt trần mức của app ở công ty thì check đếm ở quy tắc cảnh báo [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R2 · member có grant vượt trần mức của app ⇒ đếm (cảnh báo), nâng trần ⇒ hết]
- Kịch bản: khi mã vai app trùng tên vai hub thì check báo đỏ [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R3 · app_roles.key trùng tên vai hub (tenant-admin ≡ tenant_admin) ⇒ crit, đổi mã ⇒ hết]
- Kịch bản: khi thành viên nhóm vai app thuộc công ty khác thì check báo đỏ [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R4 · thành viên Group vai app thuộc công ty khác ⇒ crit, gỡ ⇒ hết]
- Kịch bản: khi có vai app của app công ty không bật thì check báo đỏ, bật app thì hết [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R5 · app_roles của app công ty không bật ⇒ crit, bật app ⇒ hết]
- Kịch bản: khi chỉ có cảnh báo thì kết quả vàng, có lỗi thì đỏ [test: apps/hub-api/src/modules/ops/adapters/checks/app-roles.check.test.ts » chỉ quy tắc 2 (member vượt trần) ⇒ warn]
