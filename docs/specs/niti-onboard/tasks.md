---
id: niti-onboard
title: Tenant thật đầu tiên NitiGroup — onboarding lặp lại được + nhập sohoptac (I1) vào tenant
cr: CR-095
lane: đầy đủ cho phần tenant/RLS/migration dữ liệu khách (test int viết cùng lát, chạy trên bản sao seed — không đụng dữ liệu thật); UI hồ sơ: nhanh
depends: M1 (phòng ban), N1 (gói, pk-enable trợ lý), N5 + I1 (importer), admin 0014
---
# niti-onboard (plan ngắn)

Người dùng (2026-10-20): khách đầu tiên của app mới (AI System + gói contracts, thay sohoptac) là **CÔNG TY TNHH THƯƠNG MẠI DỊCH
VỤ NITIGROUP** (MST 0318938091). Dữ liệu sohoptac cũ chép vào tenant này.

- **Dữ liệu khai báo:** `deploy/tenants/nitigroup.yaml` (hồ sơ, 1 gốc + 22 phòng, gói, gắn org importer).
- **CLI** `apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts` — một tx `configWrite` (tenant + hồ sơ + marker + Group
  phòng ban vi/en + cây + thành viên/trưởng phòng theo email) rồi `enablePack` mỗi gói (entitlement + 3 Group vai + grant + trợ lý
  `mgmt-assistant` qua `packs.grant_agents`). Không đổi ⇒ không ghi, không audit, không tăng version.
- **Migration admin 0015** `0015_niti_tenant_profile`: `tenants.profile jsonb` (`{}` mặc định, ≤ 8 KB) + `departments.parent_group_id`
  (FK cùng tenant, xoá cha ⇒ null) + `sort_order`. Chỉ cộng thêm. admin-web: thẻ "Hồ sơ công ty" ở tab Thông tin (chỉ đọc).
- **Importer** `mgmt-import --into-tenant <key>`: chỉ nhập org đã gắn với tenant (marker `settings.mgmt_source/mgmt_org_id` do
  onboarding đặt); org khác bị loại (không tạo tenant/user), báo `excluded` + `source_orgs`.

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration 0015 + schema Drizzle + contract `TenantProfileSchema` (chi tiết tenant trả `profile`) | đầy đủ | xong |
| 2 | Module `tenant-onboard` (rules + repo SQL theo tập + use case + CLI) + `deploy/tenants/nitigroup.yaml` | đầy đủ | xong |
| 3 | Importer `--into-tenant` (scopeToOrg, `source_orgs`, `excluded`, `into.TENANT_NOT_BOUND`) | đầy đủ | xong |
| 4 | Unit (rules onboarding + file NitiGroup thật, scopeToOrg, dòng hồ sơ admin-web) + int `tests/acceptance/NITI/onboard.int.test.ts` | đầy đủ | xong (xem Kết quả) |
| 5 | evotest-mgmt: `run.ps1 -Tenant nitigroup` (onboarding ×2 + dry-run/apply/chạy lại `--into-tenant`) | đầy đủ | xong (xem Kết quả) |
| 6 | admin-web thẻ hồ sơ | nhanh | xong (chưa có e2e — xem Còn lại) |

## Thứ tự chạy production (KHÔNG chạy trong lát này)
Mọi lệnh chạy trên máy chủ app mới, thư mục repo đã deploy, `--env-file=.env.local` (role `admin_api`/`hub_api` NOBYPASSRLS).
`ACTOR` = uuid platform admin của người vận hành. sohoptac chỉ **ĐỌC** (OpenSearch REST + Neo4j HTTP; không ghi, không đổi index).
1. **Deploy** `platform/gd0` (gồm admin 0015) — `bun run db:migrate` (main + hub + packs); kiểm `select count(*) from
   admin.features where key like 'contracts-%'` = 3 và `packs.pack_agents` có `mgmt-assistant`; `hub:seed` đã có agent `mgmt-assistant`.
2. **Đóng băng ghi sohoptac** (thông báo người dùng; importer đọc ảnh chụp, không đồng bộ tăng dần). Chép chỉ-đọc `apidata/contract_files`.
3. **Onboarding** (chưa gắn org): `bun --env-file=.env.local apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts
   --file deploy/tenants/nitigroup.yaml --actor $ACTOR` ⇒ `tenant.created=true`, 23 phòng, `packs=[{contracts,3}]`. Chạy lại ⇒ mọi
   số đổi = 0.
4. **Tìm org sohoptac:** `MGMT_OPENSEARCH_URL=… MGMT_NEO4J_URL=… bun --env-file=.env.local
   apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts --source mgmt-prod --actor $ACTOR --into-tenant nitigroup --report
   dry0.json` (dry-run, tenant chưa gắn ⇒ exit 2 `into.TENANT_NOT_BOUND`, không lập kế hoạch) ⇒ đọc `source_orgs` (id, tên, số
   thành viên), chọn org của NitiGroup. **Nhiều org ⇒ dừng, hỏi người dùng** (lát này chỉ nhập MỘT org vào tenant; gộp nhiều org
   cần quyết định riêng — xem Còn lại).
5. **Gắn org:** điền `import.org_id` trong `deploy/tenants/nitigroup.yaml` (commit) hoặc thêm `--mgmt-org <id>`; chạy lại
   onboarding ⇒ `binding.state = "set"` (lần sau `kept`; đổi org ⇒ `ORG_REBIND`).
6. **Import dry-run:** như bước 4 + `--files-dir <bản chép contract_files> --knowledge-org <id> --report dry.json` ⇒ exit 0/2;
   xem `identity` (user reuse/tạo), `tables.*.planned`, `excluded`, `issues_by_code`. Vấn đề lạ ⇒ dừng.
7. **Import apply:** thêm `--apply --state checkpoint.json --report apply.json` (đứt giữa chừng ⇒ chạy lại cùng `--state`).
8. **Đối soát:** `apply.json` `reconcile.money_ok = true` (tiền nguồn = kế hoạch = đích, tuyệt đối), `files.checksum_ok = found`,
   `signed_sha.ok`, `diffs = []`, `visibility.mismatches = []`; số hàng `tables.*.inserted` = `planned`; chạy lại `--apply` ⇒ tổng
   `inserted = 0`. So tay vài HĐ/sổ trên contracts-web với sohoptac.
9. **Gán phòng ban:** sohoptac KHÔNG có phòng ban (mgmt-app `orgs.py` chỉ có role + `manager_email`, đã nhập qua N5/M1b) ⇒ điền
   `head`/`members` (email) trong yaml rồi chạy lại onboarding (`pending_emails` = email chưa có user), hoặc gán ở contracts-web
   Cài đặt › Phòng ban.
10. Điều kiện cứng trước khi mở đăng nhập: TECH-DEBT #224 (giới hạn đăng nhập) — như I1.

## Quyết định trong lúc làm
- D-NO-01: Hồ sơ = cột `admin.tenants.profile jsonb` (không thêm nhiều cột): trường hồ sơ còn đổi; kiểm dạng ở zod
  (`TenantProfileSchema`), DB chỉ chặn kiểu object + 8 KB. Danh sách tenant không trả `profile` (chỉ chi tiết).
- D-NO-02: Cây phòng ban: `departments.parent_group_id` + `sort_order` (M1 phẳng). Chỉ thông tin — luật thấy M1D-FR-03 không đổi
  (trưởng phòng chỉ thấy thành viên trực tiếp). Không vòng: file khai báo bắt cha khai TRƯỚC con; DB chặn tự trỏ. Chưa hiện cây trên
  contracts-web (contract `OrgResponse` giữ nguyên).
- D-NO-03: Tên tenant = tên pháp lý đầy đủ (≤ 128); nhãn tiếng Anh vào `groups.name.en`. "Bộ phận / Phòng ban trong công ty" bỏ.
  Khoá Group `pb-*` (tránh trùng `contracts-*`, `beta-testers`).
- D-NO-04: Gói bật bằng `enablePack` (cùng đường admin-web PK-FR-05) — trợ lý `mgmt-assistant` được grant cùng tx.
- D-NO-05: `--into-tenant` nhập đúng MỘT org (org đã gắn); không gộp nhiều org vào một tenant (danh mục/khách/công ty theo org sẽ
  đụng khoá tự nhiên). User không thuộc org nào vẫn đi N5 như I1 (NO_ORG). Tenant chưa gắn: dry-run chạy rỗng + báo `source_orgs`;
  apply lỗi `TENANT_NOT_BOUND`.
- D-NO-06: Marker không đổi lặng lẽ: đã gắn org khác ⇒ `ORG_REBIND`; org đã thuộc tenant khác ⇒ `ORG_TAKEN`.
- D-NO-07: Gán thành viên/trưởng phòng chỉ cộng (không xoá thành viên ngoài file — không đè chỉnh tay trên UI).
- D-NO-08: Không có e2e cho thẻ hồ sơ trong lát (chỉ đọc, dữ liệu do CLI ghi): unit `profileLines` + int API — e2e ghi ở Còn lại.

## Kết quả
(điền sau khi chạy evotest)

## Còn lại
- e2e Playwright thẻ "Hồ sơ công ty" (Luật 4b) — cần seed `profile` cho tenant e2e.
- Hiện cây phòng ban (cha/thứ tự) ở contracts-web Cài đặt › Phòng ban (cần thêm trường vào `OrgResponse`).
- sohoptac thật có > 1 org ⇒ cần quyết định gộp (D-NO-05).
- FileBox sink cho CLI importer (I1 "Còn lại") vẫn mở — production phải có trước bước 7.
