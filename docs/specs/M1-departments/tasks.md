---
id: M1-departments
title: Phòng ban + luật thấy dữ liệu (RLS) cho app mgmt (contracts-web)
cr: CR-095
lane: đầy đủ (RLS/tenant) — một agent, review + security gộp cuối đợt (CR-095)
requirements: [M1D-FR-01, M1D-FR-02, M1D-FR-03, M1D-FR-04, M1D-FR-05, M1D-NFR-01]
---

# M1 · Phòng ban + luật thấy (plan ngắn)

Nguồn luật: mgmt-app `api/app/orgs.py` (`Ctx.sees`, `reports`, `_check_manager`) + `access.py` (CKS/lô theo HĐ).

## Luật (M1D-FR-01)
- **owner** (thành viên Group được cấp `contracts-admin`) thấy mọi hàng của tenant.
- **editor/viewer** thấy: HĐ mình phụ trách (`owner_user_id`) · HĐ của cấp dưới mọi tầng (chuỗi quản lý, cấm vòng) ·
  HĐ chưa giao (`owner_user_id is null`) do mình tải lên (`created_by`) · **mới**: trưởng phòng thấy HĐ của thành viên phòng.
- Việc nền (`app.user_id` rỗng — `PackSystemUow`) thấy cả tenant (như trước).
- Hàng con theo HĐ: `contract_items`, `contract_events`, `obligations` (theo `contract_id`), `cks_lots` (HĐ mua),
  `cks_certificates`/`cks_renewals` (HĐ bán; hoặc do mình tạo).

## Dữ liệu
- admin 0014 `m1_org` (tay, không đổi bảng cũ): `admin.user_managers` (một quản lý/user), `admin.user_reports` (closure, trigger
  duy trì theo tập, khoá advisory theo tenant, vòng ⇒ 23514 `user_managers_cycle_ck`), `admin.departments` (Group ⇒ phòng ban,
  `head_user_id`; thành viên = `group_members`).
- contracts 0009 `m1_visibility`: `visibility_settings(mode tenant|org)`; hàm `org_owner_ids()` / `org_is_owner()` (SECURITY
  DEFINER, chỉ đọc admin theo `app.tenant_id`/`app.user_id`), `sees_all()` (INVOKER); policy RESTRICTIVE FOR SELECT.

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration admin 0014 + contracts 0009 | đầy đủ | xong 24b689a3 |
| 2 | Test RLS (`tests/acceptance/M1D/visibility.int.test.ts`): cấp dưới thấy, ngang hàng không, trưởng phòng, tenant khác, vòng bị chặn, chế độ tenant giữ hành vi cũ | đầy đủ | xong |
| 3 | Perf: list p95 ≤ 50 ms, 2 câu, EXPLAIN không Seq Scan (chế độ org, viewer) | đầy đủ | xong |
| 4 | admin-api: `GET /admin/org`, `PUT /admin/org/managers/:id`, `PUT|DELETE /admin/org/departments/:id` | đầy đủ | xong |
| 5 | hub-api: `GET/PUT /pack/contracts/visibility` (owner) | thường | xong |
| 6 | contracts-web: Cài đặt › Phòng ban & thành viên | nhanh | xong |

## Test đếm/kiểm kê sửa theo migration admin 0014 (điều phối duyệt 2026-10-20, relock chỉ 7 tệp này)
Không đổi hành vi: thêm 3 bảng `departments`, `user_managers`, `user_reports` (đều bật RLS, không FORCE) vào danh sách bảng/RLS;
20 → 23 bảng admin, 14 → 17 bảng RLS, `runMigrations` main 14 → 15.
- Khoá (relock): `tests/acceptance/{M1/db-schema, M1/db-rls, ADM-NFR-06/migrate, M2/db-rls, M2/db-schema, M3/db-rls, M3/db-schema}.int.test.ts`.
- Không khoá: `packages/db/src/{migrate, migrate-hub, catalog-rls}.int.test.ts`.

## Số đo (evotest, perf, chế độ org, 10.000 HĐ + 60.000 nền, n=200)
V 60 cấp dưới p95 10,52 ms · trưởng phòng 30 TV p95 8,80 · editor lẻ p95 8,23 · owner p95 11,98 · chế độ tenant p95 12,07; 2 câu SQL; EXPLAIN không Seq Scan.

## Còn mở
e2e màn /settings/members; phụ lục chưa giao theo HĐ cha (D-M1-03); cks_customers/partner_events chưa lọc theo người; N5 chưa nhập manager_email; link vào màn từ Cài đặt; proxy /admin khi deploy.

## Quyết định trong lúc làm
- D-M1-01: **Chế độ theo tenant, mặc định `tenant`** (mọi người thấy cả tenant như HD1–HD9 đang khoá test). Tenant nhập từ mgmt-app
  bật `org`. Lý do: luật mgmt-app làm mặc định sẽ đỏ test khoá HD1 (viewer `tam` đọc HĐ của `lan`) ⇒ Tranh chấp test, chờ người dùng.
- D-M1-02: Quản lý ở bảng riêng `admin.user_managers` (không thêm cột vào `admin.users` — tránh đụng contract/test khoá của users).
- D-M1-03: Phụ lục chưa giao **không** "theo HĐ cha" như mgmt-app (cần đọc HĐ cha trong policy của chính bảng ⇒ đệ quy policy);
  upload luôn gán người phụ trách = người tải ⇒ chỉ gặp ở dữ liệu nhập; HD10 nhập gán owner phụ lục = owner HĐ cha.
- D-M1-04: Trưởng phòng thấy HĐ của thành viên trực tiếp của phòng (không lan tiếp cấp dưới của họ); phòng ban phẳng.
- D-M1-05: `cks_certificates`/`cks_lots`/`cks_renewals`: người tạo luôn thấy hàng mình tạo (câu chèn CKS chèn HĐ mới + CKS cùng
  câu ⇒ RETURNING không thấy HĐ mới qua EXISTS).
