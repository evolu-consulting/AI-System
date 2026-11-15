# onboard-groups — CR-159 (yaml onboarding: user vào nhóm vai của gói)

## Plan
Lỗi bản test: CLI `tenant-onboard` bật gói nhưng 3 nhóm vai (`<gói>-owner|editor|viewer`) của tenant mới 0 thành viên ⇒ quản trị công ty vào Sổ Hợp Tác thấy «chưa có quyền dùng gói Hợp đồng». Sửa: sau bước người dùng, mỗi gói đã bật gọi `enablePack(…, {grantTenantAdmins: true})` (đúng hàm đường wizard ⇒ quản trị công ty vào Chủ gói) rồi `addPackMembers` đưa người thường vào nhóm Nhân viên (`editor`) hoặc nhóm khai ở `pack_role`. Lặp lại không đổi, không xoá ai.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Luật `packRoleRows`, schema `users[].pack_role` (chỉ cho `member`) | `domain/onboard.rules.ts`, `adapters/onboard.schema.ts` | [x] |
| 2 | `addUsersToRoleGroups` (một câu SQL, tham số JSON) + `addPackMembers` (một tx, audit thành viên) | `packs/packs.repo.ts`, `packs/packs.service.ts` | [x] |
| 3 | Cổng `enablePack(tenantId, packKey, members)` + usecase + run | `application/ports.ts`, `application/onboard.usecase.ts`, `tenant-onboard.run.ts` | [x] |
| 4 | Test int (đường yaml) | `tenant-onboard.groups.int.test.ts` | [x] |

## Quyết định trong lúc làm
- Quản trị = Chủ gói qua `enablePack` + `grantTenantAdmins` (G1, không SQL thứ hai cho quản trị); kèm mọi `tenant_admin` đang hoạt động của tenant, kể cả người ngoài yaml (giống wizard).
- Người thường: mặc định `<gói>-editor`; `pack_role: owner|editor|viewer` ghi đè theo người; quản trị khai `pack_role` ⇒ lỗi file (`PACK_ROLE_ADMIN`).
- Chỉ thêm, không gỡ: người đổi vai hay bỏ khỏi yaml vẫn ở nhóm cũ (gỡ qua trang Nhóm).
- Áp dụng cho mọi gói trong `packs:` (khoá nhóm = `packGroupKey(gói, vai)`).

## Chẩn đoán int đỏ có sẵn (log 20261114-204756, ref cũ)
- `NITI/onboard.int.test.ts` (6 ca): `import.source` thiếu vì test đọc `deploy/tenants/nitigroup.yaml` (CR-159 bỏ `import`); đã sửa bằng fixture `9e0b4126f` (20:55, sau log 20:47).
- `flow-end K3 failedBatch`: `42501 permission denied for function rep_cell_of` (CR-152c/0113 cột sinh); đã sửa bằng migration 0115 `c86a6efed` (20:52, sau log).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/onboarding-cong-ty.md

#### Yêu cầu: Quản trị công ty đầu tiên dùng được mọi app đã bật ngay sau onboarding (nguồn: cr125-ux-s1-onboard)
Ngoài đường wizard, onboarding bằng file yaml (`deploy/tenants/*.yaml`, có `users:`) cũng đưa người dùng vào nhóm vai của mọi gói đã bật: quản trị công ty vào nhóm Chủ gói; người thường vào nhóm Nhân viên, hoặc nhóm khai ở `pack_role` (`owner`, `editor`, `viewer`). Chạy lại không nhân đôi và không xoá ai.
- Kịch bản: khi yaml có một quản trị và hai người thường thì quản trị ở nhóm Chủ gói, người thường ở nhóm Nhân viên, người khai `pack_role: viewer` ở nhóm Người xem [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.groups.int.test.ts » tenant mới]
- Kịch bản: khi chạy lại cùng file thì số thành viên các nhóm vai không đổi [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.groups.int.test.ts » chạy lại]
- Kịch bản: khi thêm người mới vào yaml rồi chạy lại thì chỉ người mới được thêm và người đã bỏ khỏi file vẫn ở nhóm [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.groups.int.test.ts » thêm người mới vào yaml]
- Kịch bản: khi quản trị khai `pack_role` thì file bị từ chối [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.groups.int.test.ts » quản trị khai pack_role]
