---
id: cr121-c19-app-roles-check
lát: cr121-c19-app-roles-check
cr: CR-121
làn: đầy đủ (ops check đọc quyền/vai; Sonnet viết, Opus low soát nếu điều phối cần)
migration: không
phụ thuộc: c18 (cột admin.features.app); spec docs/specs/cr121-c/spec.md D2
---
## Plan (ngắn)
Thêm ops check mới `app_roles` (ops-watch) bắt lệch giữa vai hub (`admin.users.role`) và vai theo app (`admin.app_roles` → Group → feature grant). Một câu SQL tập hợp (CTE `lv/ceil/onapp/gr/viol`), không lặp theo tenant; mỗi quy tắc là một nhánh `viol`, gom `count` + 5 mẫu. App của feature đọc CỘT `admin.features.app` (c18); mức = hậu tố `-read|-write|-admin`.

## Làm
- `apps/hub-api/src/modules/ops/adapters/checks/app-roles.check.ts` (mới) + `registry.ts`; khoá `app_roles` thêm vào `OPS_CHECK_KEYS`/`OPS_CHECK_META` (`packages/contracts/src/hub-admin/ops.ts`) và nhãn i18n vi/en (`ops.check.app_roles`).
- Quy tắc: (1) lỗi — `tenant_admin` hoạt động phải có grant `-admin` (trực tiếp hoặc qua Group) ở mọi app công ty đang bật ở trần Quản trị; (2) cảnh báo — `member` có grant vượt trần mức của app ở công ty; (3) lỗi — `app_roles.key` (so khớp `-`≡`_`) trùng `platform_admin|tenant_admin|member`; (4) lỗi — thành viên Group của vai app khác công ty của Group; (5) lỗi — `app_roles` của app công ty không bật (không entitlement còn hiệu lực).
- Test: unit `app-roles.check.test.ts` (mức crit/warn/ok), int `ops.app-roles.int.test.ts` (một file, 5 quy tắc đỏ/xanh so với nền).

## Không làm / Chạm
Không sửa dữ liệu, không migration, không đổi `app-roles.compile.ts`. Không chạy e2e.

## Quyết định trong lúc làm
- Quy tắc 1 chỉ xét app mà công ty có trần Quản trị (entitlement `-admin` còn hiệu lực): trần thấp hơn thì tenant_admin không thể có mức Quản trị nên không tính lỗi.
- "App đang bật" (quy tắc 5) = còn entitlement của bất kỳ feature nào có `app` = `app_roles.pack` (cột, không tiền tố); feature `off` không tính. Chỉ công ty `active` cho quy tắc 1, 2, 5; quy tắc 3, 4 xét mọi công ty.
- Quy tắc 2 giữ cảnh báo (spec D2) tới khi xác minh bằng dữ liệu thật.
- Perf: một câu, không lặp theo tenant; chạy trong `systemRead` (hạn `statement_timeout` của kit).

## Test tối thiểu
unit `app-roles.check.test.ts`; int `ops.app-roles.int.test.ts` (evotest, tối đa 3 lượt).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/kiem-tra-vai-app.md
#### Yêu cầu: Ops phát hiện lệch giữa vai hub và vai theo ứng dụng
Check `app_roles` của ops-watch so vai hub (platform_admin, tenant_admin, member) với vai theo ứng dụng: báo đỏ khi quản trị công ty chưa có mức Quản trị ở app đang bật, mã vai app trùng tên vai hub, thành viên vai app thuộc công ty khác, hoặc có vai app của app công ty không bật; báo vàng khi thành viên có quyền vượt trần mức của app. App của tính năng lấy từ cột ứng dụng của tính năng.
- Kịch bản: khi quản trị công ty (tenant_admin) chưa có mức Quản trị ở app đang bật thì check báo đỏ nêu công ty, vào nhóm có quyền quản trị thì hết [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R1 · tenant_admin chưa có mức Quản trị ở app đang bật (trần Quản trị) ⇒ crit nêu công ty, vào nhóm có grant -admin ⇒ hết]
- Kịch bản: khi thành viên có quyền vượt trần mức của app ở công ty thì check đếm ở quy tắc cảnh báo [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R2 · member có grant vượt trần mức của app ⇒ đếm (cảnh báo), nâng trần ⇒ hết]
- Kịch bản: khi mã vai app trùng tên vai hub thì check báo đỏ [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R3 · app_roles.key trùng tên vai hub (tenant-admin ≡ tenant_admin) ⇒ crit, đổi mã ⇒ hết]
- Kịch bản: khi thành viên nhóm vai app thuộc công ty khác thì check báo đỏ [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R4 · thành viên Group vai app thuộc công ty khác ⇒ crit, gỡ ⇒ hết]
- Kịch bản: khi có vai app của app công ty không bật thì check báo đỏ, bật app thì hết [test: apps/hub-api/src/modules/ops/ops.app-roles.int.test.ts » R5 · app_roles của app công ty không bật ⇒ crit, bật app ⇒ hết]
- Kịch bản: khi chỉ có cảnh báo thì kết quả vàng, có lỗi thì đỏ [test: apps/hub-api/src/modules/ops/adapters/checks/app-roles.check.test.ts » chỉ quy tắc 2 (member vượt trần) ⇒ warn]

## Việc còn lại
- Chạy `check` trên dữ liệu thật (prod) để xác minh quy tắc 2 rồi mới nâng lỗi (spec D2).
