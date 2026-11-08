---
id: cr121-c20-company-name
lát: cr121-c20-company-name
cr: CR-121
làn: đầy đủ (migration dữ liệu khách + RLS; Sonnet high viết, Opus low soát phần dữ liệu/RLS)
migration: pack-contracts 0076 (journal idx 72, when 1803400000000)
phụ thuộc: c19 (cùng registry.ts); spec docs/specs/cr121-c/spec.md D3
---
## Plan (ngắn)
Tên công ty MỘT nguồn = `admin.tenants.name`. Migration `0076_company_name_one_source.sql`: (1) hàm `contracts.tenant_name()` SECURITY DEFINER, lọc cứng theo `app.tenant_id` của phiên (role `contracts_rw` không có quyền trên `admin`); (2) backfill set-based (admin trống tên ⇒ chép từ gói; lệch ⇒ giữ admin, NOTICE số lượng + 10 mẫu); (3) trigger `brand_config_bump` chỉ theo `app_name, logo, accent`; (4) gỡ cột `company_name` + thay ràng buộc độ dài bằng `company_settings_app_name_ck`. Mọi chỗ đọc chuyển sang `contracts.tenant_name()` trong cùng câu SQL (`/pack/me` brand vẫn MỘT câu cố định). Đổi tên ở Admin đã `configWrite` ⇒ bump `config_version` + NOTIFY kèm `tenant_id` ⇒ ETag `/pack/me` đổi (không cần trigger thêm bên Admin).

## Làm
- Migration + journal `packages/db/migrations-pack-contracts/{0076_company_name_one_source.sql,meta/_journal.json}`.
- Chỗ đọc/ghi `company_name` đã chuyển: `hub-api/modules/packs/contracts/brand.mount.ts`, `adapters/company.repo.ts` (đọc + `PUT /company` bỏ qua `name`), `seed/seed.tenant-fixtures.ts`, `tools/scripts/src/{seed-demo-v2,demo-ai-fix}.ts` (đặt/sửa `admin.tenants.name`). `extraction.repo.ts` đọc `own_names/own_tax_ids` (KHÔNG phải `company_name`) — giữ nguyên theo spec ("giữ `own_names`"), chỉ sửa chú thích ở `extraction.ports.ts`.
- DTO `packages/contracts/src/pack-contracts/company.ts`: `name` còn trong thân PUT (client cũ không 422) nhưng server bỏ qua; phản hồi luôn là tên tenant.
- UI `workspace-web/features/settings/components/CompanyPane.tsx`: ô "Tên công ty" chỉ đọc + gợi ý "đổi ở Admin" (i18n `contracts.settings.co.nameHint` vi/en) — không giữ control cũ song song (Luật GỐC 2).
- Ops check mới `tenant_profile` (`ops/adapters/checks/tenant-profile.check.ts` + `registry.ts` + `OPS_CHECK_KEYS/META` + i18n): (1) cột `company_settings.company_name` không tồn tại, (2) mọi công ty có tên không rỗng. Một câu SQL tập hợp trên catalog + `admin.tenants`.
- Test cũ đổi: V2-L `company.int.test.ts`, V2-O `demo-ai-fix.int.test.ts`, CR118 `config-consistency.int.test.ts` (đổi tên qua admin-api PATCH), `profile-bump.int.test.ts`, `community-ports.int.test.ts`, `seed.tenant-fixtures.int.test.ts`. HD9 (`company_name` trong thân hợp đồng/đối tác) và CKS là khái niệm khác, KHÔNG liên quan `company_settings` — không đổi.

## Không làm / Chạm
Không đụng DLC. Không đổi `own_names/own_tax_ids`. Không chạy e2e (e2e `v2l-settings.cw.ts`, `delivery-opts.cw.ts`, `rep3-engine.cw.ts` vẫn gửi `name` — server bỏ qua, không lỗi). Không chụp artboard (đổi UI chỉ là ô chỉ đọc + dòng gợi ý).

## Test tối thiểu
- int `apps/hub-api/src/modules/packs/contracts/company-name.int.test.ts` (backfill idempotent, gỡ cột, chặn đọc chéo tenant, brand một câu).
- int `tests/acceptance/CR118/config-consistency.int.test.ts` (đổi tên ở Admin ⇒ `/pack/me` đổi ETag, beta không chạm, nóng 0 SQL).
- unit `tenant-profile.check.test.ts` + int `ops.tenant-profile.int.test.ts`.

## Quyết định trong lúc làm
- Đổi tên ở Admin KHÔNG cần trigger mới: `tenants.service` đã `configWrite` + `ch.changed({entity:"tenant", tenantId})` ⇒ `config_changed` kèm tenant_id ⇒ `CapabilitiesService.onChange` bỏ brand nhớ của tenant, tem ETag đổi. Trigger `brand_config_bump` chỉ còn bump `profile_version` khi đổi `app_name/logo/accent`.
- `contracts.tenant_name()` thay vì GRANT SELECT cross-schema: `contracts_rw` giữ nguyên không quyền trên `admin`; hàm không nhận tham số tenant ⇒ không thể đọc chéo tenant.
- Backfill dùng `NO FORCE ROW LEVEL SECURITY` tạm trong cùng transaction rồi `FORCE` lại (chủ migration không phải superuser vẫn đọc được).
- `own-side.rules.ts` (đoán Mua/Bán) dùng `own_names` + MST — giữ, không thay bằng `admin.tenants.name`.
- Perf: migration = 1 UPDATE + 1 SELECT tổng hợp (không theo hàng). `/pack/me` brand: 1 câu SQL TRƯỚC → 1 câu SAU (tên là hàm trong cùng câu); nóng 0 SQL (đã có assert).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED sht/ten-cong-ty-mot-nguon.md
#### Yêu cầu: Tên công ty chỉ có một nguồn là hồ sơ công ty ở Admin
Tên công ty hiển thị trong ứng dụng (thanh trên, logo chữ cái đầu, brand của Sổ Hợp Tác và Community) luôn lấy từ tên công ty ở Admin (Công ty › Hồ sơ). Cài đặt công ty của Sổ Hợp Tác không còn lưu tên riêng; chỉ giữ tên ứng dụng, logo, màu, giao diện, tên pháp nhân và mã số thuế. Khi nâng cấp, công ty nào ở Admin chưa có tên mà Sổ Hợp Tác có thì tên được chép sang Admin; nếu hai bên lệch nhau thì lấy tên ở Admin.
- Kịch bản: khi nâng cấp dữ liệu cũ thì tên trống ở Admin được chép từ Sổ Hợp Tác, tên đã có ở Admin được giữ, cột tên cũ bị gỡ và chạy lại không đổi gì [test: apps/hub-api/src/modules/packs/contracts/company-name.int.test.ts » dựng lại trạng thái cũ (cột + dữ liệu) ⇒ chạy lại 0076: chép tên trống, giữ tên admin khi lệch, gỡ cột]
- Kịch bản: khi đổi tên công ty ở Admin thì thông tin nhận diện của phiên đổi theo (mã phiên bản đổi), công ty khác không bị ảnh hưởng [test: tests/acceptance/CR118/config-consistency.int.test.ts » đổi brand acme ⇒ config.changed tới phiên acme, ETag + brand mới, beta không nhận, brand beta giữ nguyên, nóng 0 SQL]
- Kịch bản: khi đọc tên công ty trong phiên của một công ty thì chỉ thấy tên công ty đó, không đọc được tên công ty khác [test: apps/hub-api/src/modules/packs/contracts/company-name.int.test.ts » tenant_name() chỉ trả tên tenant phiên]
- Kịch bản: khi lưu cài đặt công ty có kèm tên thì tên đó bị bỏ qua và phản hồi vẫn là tên ở Admin [test: tests/acceptance/V2-L/company.int.test.ts » GET mặc định → quản lý PUT → đọc lại (mọi người)]
- Kịch bản: khi có công ty tên rỗng hoặc cột tên cũ quay lại thì kiểm tra vận hành báo đỏ, sửa xong thì hết [test: apps/hub-api/src/modules/ops/ops.tenant-profile.int.test.ts » tên công ty rỗng ⇒ crit nêu key]

## Việc còn lại
- Chạy 0076 trên bản sao dữ liệu prod, đọc NOTICE (số tenant lệch tên + mẫu) trước khi deploy.
- e2e trình duyệt (cùng đợt gộp): ô "Tên công ty" chỉ đọc ở Cài đặt Sổ Hợp Tác — chưa sửa spec e2e nào dùng ô này (không có).
