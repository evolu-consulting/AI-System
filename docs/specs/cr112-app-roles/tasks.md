---
id: cr112-app-roles
lát: cr112-app-roles
cr: CR-112
fr: ADM-FR-77, ADM-FR-78, ADM-FR-80, ADM-FR-81, ADM-FR-82, ADM-FR-83
làn: đầy đủ
migration: admin 0030_app_roles.sql (when 1801200000000)
phụ thuộc: CR-111
---
## API cho lát UI (S4/S5)
Contract: `packages/contracts/src/app-roles.ts` (zod strict). Quyền: platform_admin mọi tenant (`?tenant_id=`); tenant_admin chỉ
tenant mình — `?tenant_id` khác hoặc vai của công ty khác ⇒ **404**; member ⇒ 403. Mọi ghi = 1 tx, bump `config_version` +
NOTIFY `config_changed` (vô hiệu cache quyền) + audit.

| Method · path | Body / query | Trả |
|---|---|---|
| `GET /admin/app-roles` | `?tenant_id=&pack=` (platform thiếu tenant ⇒ mọi tenant) | `{ items: AppRole[] }` (≤ 500) |
| `POST /admin/app-roles` | `?tenant_id=` · `{ pack, name:{vi,en?}, level: read\|write\|admin, key? }` | 201 `AppRole` |
| `PATCH /admin/app-roles/:id` | `{ version, name?, level? }` (≥ 1 trong 2) | `AppRole` (version +1) |
| `DELETE /admin/app-roles/:id` | — | 204 |
| `POST /admin/app-roles/:id/members` | `{ user_ids: uuid[1..500] }` | `{ added, already, not_found }` (uuid[]) |
| `DELETE /admin/app-roles/:id/members/:user_id` | — | 204 (idempotent) |
| `GET /admin/tenants/:id/packs` (có sẵn) | — | mỗi gói thêm `role_count`, `member_count` (người khác nhau trong các vai) |

`AppRole = { id, tenant_id, pack, key, name, level, group_id, is_default, member_count, ceiling: level|null, effective, version, created_at, updated_at }`
— `ceiling` = mức entitlement cao nhất của app cho công ty (CR-111; null = app tắt); `effective = level ≤ ceiling` (vai vượt trần
⇒ "không hiệu lực", BR-12). Danh sách thành viên của vai: dùng `GET /admin/groups/:group_id/members` sẵn có.

Lỗi: 400 VALIDATION_ERROR (key làm Group key > 32) · 404 NOT_FOUND · 409 VERSION_CONFLICT (`details.current`) · 409 KEY_TAKEN ·
409 `DEFAULT_ROLE_PROTECTED` (xoá/đổi mức vai mặc định; đổi tên được) · 409 `ROLE_HAS_MEMBERS` (`details.member_count`) ·
422 `PACK_NOT_ROLEABLE` (app không phải gói nghiệp vụ đã cài) · 422 `EXTERNAL_USER_NOT_ALLOWED` (`details.usernames`, cả lô).

## Plan (ngắn)
Bảng mỏng `admin.app_roles` (1 vai ↔ 1 Group cùng tenant, FK kép, unique group_id + (tenant, pack, key), RLS như bảng tenant
admin). Vai là nguồn: biên dịch một chiều mức ⇒ 3 mã gói trên Group của vai. `enablePack` ghi 3 vai mặc định. API CRUD + gán người.

## Làm
- [x] Migration 0030: bảng + RLS (admin_rw platform/tenant, hub_ro đọc) + `admin.app_roles_backfill()` (chỉ tạo hàng vai từ Group `<k'>-viewer|editor|owner` của gói đã cài, idempotent, không đổi grant) gọi trong migration.
- [x] Luật thuần `app-roles.rules.ts` (mức ⇒ mã, `compilePlan` scope/want/drop, trần, effective, khoá Group).
- [x] Biên dịch `app-roles.compile.ts`: 3 câu cố định (khoá vai · xoá thừa · chèn thiếu), chỉ trên Group của vai; audit `grant` mỗi thay đổi + sự kiện `grant`.
- [x] Service/routes `/admin/app-roles*`, members (đối tác ⇒ 422), `enablePack` ghi vai mặc định, GET packs đếm vai/người.
- [x] Contract `app-roles.ts` + `PackState.role_count/member_count` (optional).
- [x] Cập nhật test khoá liệt kê bảng/RLS admin (thêm `app_roles`): ADM-NFR-06/migrate, M1/M2/M3 db-schema + db-rls, packages/db catalog-rls.

## Không làm / Chạm
Không UI (S4/S5). Không chuẩn hoá grant Group vai cũ (S6, dry-run). Không đổi hub pack-guard / `caps.contracts`. Không cấp agent
gói (`packs.grant_agents`) cho Group vai tuỳ biến.

## Test tối thiểu
- unit `apps/admin-api/src/modules/app-roles/app-roles.rules.test.ts`
- int `apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts` (DB mẫu full, gói `pkdemo`) + `tests/acceptance/N1/admin-packs.int.test.ts` (hồi quy bật gói).

## Quyết định trong lúc làm
- Prefix riêng `/admin/app-roles` (giống `/admin/groups`): dưới `/admin/tenants` middleware chỉ-platform của các route khác áp cho mọi đường con.
- tenant_admin gửi `?tenant_id` công ty khác ⇒ 404 (không lặng lẽ đổi về tenant mình như groups).
- Khoá vai mặc định = `viewer|editor|owner` (CHECK); vai tuỳ biến: `key` vắng ⇒ `r-<8 hex>`; Group key = `<k'>-<key>` ≤ 32.
- `name` lưu ở cả vai và Group (đổi tên vai đổi tên Group cùng tx) — Group vẫn hiện đúng ở mục Nhóm.
- Audit vai dùng entity `group` (action create/update/delete, `summary.op = role.*`); thay đổi grant dùng `grantAudit` sẵn có — không thêm giá trị enum audit (tránh migration CHECK).
- Trần = mức cao nhất trong các entitlement `<k'>-read|write|admin` còn hiệu lực; không entitlement ⇒ `ceiling=null`, mọi vai `effective=false`.
- Xoá vai: khoá vai FOR NO KEY UPDATE (gán người khoá FOR SHARE) rồi đếm thành viên ⇒ 409 nếu > 0; xoá Group ⇒ cascade vai/grant.
- Gói không cài (thiếu 3 feature) ⇒ 422 `PACK_NOT_ROLEABLE` (README FR-80 AC2), thay vì 404 PACK_NOT_FOUND.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Vai theo app là nguồn quyền gói, biên dịch một chiều xuống Group
Mỗi vai (`admin.app_roles`) gắn đúng một Group, một app, một mức; bật gói tạo 3 vai mặc định (Chỉ xem=read, Nhân viên=write, Toàn quyền=admin). Đổi mức vai ⇒ thêm/gỡ đúng 3 mã gói trên Group của vai, tăng config_version, audit mỗi grant; Group khác và feature ngoài gói không bị đụng. Vai vượt trần công ty (CR-111) hiện không hiệu lực.
- Kịch bản: khi platform_admin bật gói cho công ty thì có 3 vai mặc định trỏ đúng 3 Group vai, bật lại không nhân đôi [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-81 · bật gói tạo 3 vai mặc định]
- Kịch bản: khi đổi mức vai thì chỉ mã gói trên Group của vai đổi; grant ngoài gói và Group phòng ban giữ nguyên; audit đúng số grant đổi [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-BR-15 · đổi mức chỉ thêm/gỡ mã gói]
- Kịch bản: khi công ty chỉ có entitlement tới Sửa thì vai Toàn quyền có effective=false [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-BR-12 · vai vượt trần công ty]
- Kịch bản: khi lập kế hoạch biên dịch thì drop = 3 mã gói trừ mã theo mức [test: apps/admin-api/src/modules/app-roles/app-roles.rules.test.ts » compilePlan: scope]
- Kịch bản: khi biên dịch 50 vai thì số câu SQL bằng khi biên dịch 2 vai (≤ 3) [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » Luật 4c · biên dịch 50 vai]

#### Yêu cầu: Vai tuỳ biến và gán người vào vai
platform_admin và tenant_admin (công ty mình) tạo vai tuỳ biến (Group mới + grant theo mức), đổi tên/mức, xoá (không với vai mặc định, không khi còn người), gán/gỡ user nội bộ. Đối tác không bao giờ vào vai. Công ty khác ⇒ 404.
- Kịch bản: khi xoá hoặc đổi mức vai mặc định thì 409; app chưa cài thì 422; xoá vai còn người thì 409 kèm số người [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-80 · vai mặc định: không xoá]
- Kịch bản: khi tenant_admin công ty B thao tác vai/tenant của A thì mọi lời gọi trả 404 [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-77 · tenant_admin công ty khác]
- Kịch bản: khi gán lô có đối tác thì 422 cả lô; user nội bộ vào vai thì member_count và GET packs (số vai/người) đổi theo [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-BR-16 · đối tác không vào vai]

#### Yêu cầu: Backfill vai mặc định từ Group vai có sẵn
Migration 0030 tạo hàng vai cho Group `<k'>-viewer|editor|owner` của gói đã cài; không đổi grant; chạy lại không tạo thêm; Group phòng ban không thành vai.
- Kịch bản: khi chạy backfill hai lần thì lần 1 tạo 3, lần 2 tạo 0, `pb-ke-toan` không có vai [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-83 · backfill tạo vai mặc định]

## Việc còn lại
- S6: chuẩn hoá grant Group vai cũ (dry-run/apply) — có sẵn `compileRoles(tx, {tenantId, roleIds: null})` + `admin.app_roles_backfill()`.
- `identity-import` (import.store.ts) tạo Group vai mà chưa ghi `app_roles` — S6 gọi backfill sau import, hoặc sửa importer.
- Group vai tuỳ biến chưa được cấp agent trợ lý gói (`packs.grant_agents` chỉ biết 3 Group mặc định).
- Xoá Group vai mặc định qua `/admin/groups/:id` vẫn được (cascade xoá vai) — cân nhắc chặn ở S5.
- Seed fixtures demo: dữ liệu seed tạo Group vai bằng SQL nên dựa vào backfill trong migration; seed chạy sau migrate cần gọi `admin.app_roles_backfill()`.
- H1 `db.int.test.ts` A48 (schema hub, index `review_tasks_decided_by_idx`) đỏ — không liên quan lát (chỉ đổi admin), chưa kiểm trên nhánh gốc.
