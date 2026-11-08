---
id: cr121-c9-runs-clone-api
lát: cr121-c9-runs-clone-api
cr: CR-121
làn: nhanh (phần ghi dữ liệu/vai: Opus low soát)
migration: hub 0103 (journal when 1805200000000) — cột `process_defs.source_rel_version` + 2 index
phụ thuộc: docs/specs/cr121-c/spec.md (R9, Q8, Q9) · tasks.md mục c9
---
## Plan (ngắn)
API hub-api cho Công ty › Quy trình (UI ở c11/c17 — lát này KHÔNG có UI, không có artboard):
1. `GET /process-runs?slot=&def_id=` — lọc cùng câu SQL liệt kê.
2. `POST /tenants/:tid/process-defs/:id/clone-for-company` — sao def thư viện (bản xuất bản) thành bản riêng + tự gán thay bản cũ (Q9).
3. `GET /tenants/:tid/process-library/:id` — đọc chỉ-xem def thư viện + lượt chạy của công ty (Q8).

## Làm
- Contracts: `ProcessRunListQuerySchema` + `slot?`, `def_id?`; file mới `hub-admin/process-company.ts` (req `{}`, res `{def_id, source_template_id, rel_version, created}`, view chỉ-xem); mã lỗi `NOT_LIBRARY_DEF`, `SLOT_GONE` (422).
- Migration 0103: spec nói cột `rel_version` đã có — SAI (chỉ có `source_template_id`, hub 0019); thêm `source_rel_version` (nullable, CHECK chỉ khi có nguồn + có tenant) để lưu "Sao từ … · vN" và trả `rel_version` ở lần gọi thứ hai. Index `process_defs_company_copy_idx` (tra bản đã sao), `process_runs_snap_def_idx` (tenant_id, `snapshot.process_def_id`, started_at).
- Lọc lượt: `runs/run-def-filter.ts` đổi `slot` → tập def (thư viện của khe ∪ bản riêng của CHÍNH công ty đó) bằng MỘT câu scope system, rồi `listRuns({defIds})` lọc `snapshot->>'process_def_id'` / `process_def_id` cùng câu SQL (một tham số JSON). Số câu cố định (2), không theo hàng.
- Sao chép: `library/library-company.service.ts` (`CompanyLibraryService`) + `library-company.repo.ts`; tách file riêng (không nhét vào `library.service.ts` 357 dòng, trần 400). Một transaction `withConfigWrite` (khoá `config_meta`): kiểm vai → công ty → nguồn → (đã có bản ⇒ trả 200 `created:false`, không ghi) → chèn bản riêng từ RELEASE xuất bản (tắt `enabled=false`, không khe, `sources=[]`) → khoá đầu luật `FOR UPDATE` → đổi MỌI luật trỏ đúng nguồn sang bản riêng (+ vào `process_tenant_defs`, nguồn ra khỏi tập nếu hết luật) → `version`+1 → audit `copy`.
- Công ty đang chạy đúng mẫu khe (chưa có luật mặc định, nguồn = mặc định khe) ⇒ tạo luật mặc định = bản riêng (`upsertAssignment`).
- Vai (kiểm ở service `companyAccess`, route chỉ chặn member sớm): platform_admin mọi công ty · tenant_admin chỉ công ty mình (khác ⇒ 404) · member 403. Def của công ty khác / không có ⇒ 404 (không lộ); mẫu không khe ⇒ 422 `NOT_LIBRARY_DEF`; khe hết đăng ký ⇒ 422 `SLOT_GONE`; chưa xuất bản ⇒ 422 `PROCESS_NOT_PUBLISHED`.

## Không làm / Chạm
UI (c11/c17), admin-web i18n lỗi mới, engine D, DLC, `ROUTE_SLOT_SQL`/`RESOLVE_SLOT_SQL` (xem Việc còn lại).

## Test tối thiểu
- unit `packages/contracts/src/hub-admin/process-company.test.ts`
- int `apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts` (vai/cách ly, sao + gán + idempotent, đọc chỉ-xem)
- int `apps/hub-api/src/modules/processes/runs/runs-slot-filter.int.test.ts` (lọc slot/def, cách ly công ty, phân trang)

## Quyết định trong lúc làm
- Route đọc giữ tên spec `GET /tenants/:tid/process-library/:id`.
- Bản riêng sao từ release (bản xuất bản), KHÔNG từ nháp; tắt sẵn để không lọt danh mục `!key` của chat.
- Lượt "theo khe" nhận diện qua `snapshot.process_def_id` (đã ghi lúc launch bởi `stampSlotRun`); lượt cũ trước CR-118 không có ⇒ không lọt bộ lọc slot (chấp nhận, không backfill).
- Perf: không thêm perf test (không chạm đường nóng có ngưỡng); chỉ index + số câu cố định.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED engine/cong-ty-quy-trinh.md
#### Yêu cầu: Sao chép quy trình thư viện cho công ty
Quản trị công ty (hoặc quản trị nền tảng) sao một quy trình thư viện đã xuất bản thành bản riêng của công ty và tự đặt bản riêng thay bản cũ trong các luật chọn quy trình đang trỏ đúng quy trình nguồn; làm lại lần hai trả bản đã có, không tạo bản thứ hai.
- Kịch bản: sao lần đầu ⇒ 201 `created:true`, luật mặc định và luật điều kiện trỏ nguồn đổi sang bản riêng, luật trỏ quy trình khác giữ nguyên, có audit [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » tạo bản riêng + chỉ luật trỏ đúng nguồn đổi + idempotent 200 + công ty khác tách biệt]
- Kịch bản: hai POST cùng lúc ⇒ đúng một bản, 201 + 200 [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » hai POST cùng lúc ⇒ đúng một bản riêng, mã 201 + 200]
- Kịch bản: sao lần hai ⇒ 200 `created:false`, cùng `def_id`, không ghi thêm [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » tạo bản riêng + chỉ luật trỏ đúng nguồn đổi + idempotent 200 + công ty khác tách biệt]
- Kịch bản: công ty chưa có luật và nguồn là mặc định của việc ⇒ bản riêng thành luật mặc định [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » công ty đang chạy đúng mẫu khe (chưa có luật) ⇒ bản riêng thành luật mặc định]
- Kịch bản: member 403, quản trị công ty khác 404, mẫu không khe 422 `NOT_LIBRARY_DEF`, khe mất 422 `SLOT_GONE`, chưa xuất bản 422 [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » member 403, tenant_admin công ty lạ 404, công ty/def không có 404, không phải thư viện 422, không ghi gì]

#### Yêu cầu: Đọc chỉ xem quy trình thư viện theo công ty
Quản trị công ty đọc quy trình thư viện ở bản xuất bản hiện hành cùng lượt chạy của chính công ty mình, không có quyền sửa; công ty lạ 404, member 403.
- Kịch bản: tenant_admin đọc quy trình thư viện của công ty mình ⇒ `read_only:true`, bản riêng đã sao hiện ở `company_copy` [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » tenant_admin công ty mình đọc được bản xuất bản + bản riêng đã có, chỉ đọc]

#### Yêu cầu: Lượt chạy lọc theo việc và quy trình
Danh sách lượt chạy lọc được theo việc (khe) hoặc theo quy trình đã chọn, chỉ trong công ty của người gọi.
- Kịch bản: lọc theo việc gồm quy trình thư viện và bản riêng của công ty, công ty khác không lọt [test: apps/hub-api/src/modules/processes/runs/runs-slot-filter.int.test.ts » lọc slot gồm def thư viện + bản riêng của chính công ty, công ty khác không lọt]
- Kịch bản: lọc theo `def_id` giao với `slot`, `slot` sai định dạng ⇒ 400 [test: apps/hub-api/src/modules/processes/runs/runs-slot-filter.int.test.ts » lọc def_id (thư viện hoặc bản riêng), giao với slot, không lọc ⇒ đủ]

## Việc còn lại
- Deploy: index process_runs_snap_def_idx (0103) cần cửa sổ yên lặng — migrator hub bọc MỘT tx, repo chưa có tiền lệ CREATE INDEX CONCURRENTLY (0066/0098); dùng cửa sổ dừng hub-api khi migrate.
- Index: process_defs_company_copy_idx là UNIQUE (tenant_id, source_template_id) WHERE source_rel_version IS NOT NULL AND deleted_at IS NULL; cloneForCompany bắt 23505 ⇒ 200 created:false. Lọc lượt snapshot.process_def_id = any OR process_def_id = any: nhánh sau dùng process_runs_def_started_idx (0019), nhánh đầu process_runs_snap_def_idx ⇒ BitmapOr. EXPLAIN chưa chạy (không có DB lớn); số câu SQL cố định.
- BẪY chặn c11/c17: `ROUTE_SLOT_SQL`/`RESOLVE_SLOT_SQL` (launch) và `routing.repo.assignedOf` chỉ nhận def có `slot` + release; bản riêng (`slot NULL`, CHECK `process_defs_slot_ck`) sau khi luật trỏ vào sẽ bị coi "chưa xuất bản/route_unavailable". Cần quyết định + lát riêng cho đường launch bản riêng (đọc `slot_body` của bản riêng, `rel` = `source_rel_version`) TRƯỚC khi UI gọi `clone-for-company` trên prod.
- admin-web: thêm 2 mã lỗi vào `features/processes/lib/errors.ts` + i18n (c17).
