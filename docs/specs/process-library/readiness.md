# Readiness — CR-105 process-library (vòng 1/1, Luật 1b) · 2026-10-31

## Kết luận: NOT READY
Phạm vi đã kiểm: docs/specs/process-library/ (proposal.md, design.md, tasks.md) + đối chiếu code: `processes/runs/pack-runs.ts`, `packs/contracts/application/approval-engine.usecase.ts`, `processes/defs/defs.routes.ts`, `migrations-hub/0019_pa_process_engine.sql` (RLS `process_defs`), `migrations-hub/meta/_journal.json`, `packs/kit/application/pack-runs.ports.ts`, `tools/scripts/src/openspec.rules.ts` · 10 file · mã yêu cầu: CR-105 (B1–B6, Quyết định 1–5).
Trọng tâm: L1 `pl-slot-core`, L2a `pl-library-api`. Mọi lỗ hổng dưới đây đều có mặc định an toàn nhất quán với "Quyết định" đã duyệt ⇒ theo Luật 1b ghi mặc định vào `tasks.md` › "Quyết định trong lúc làm" rồi code, không cần hỏi người dùng.

## Lỗ hổng
| # | Mức | Mục | Vị trí (file:dòng hoặc mã) | Vấn đề | Mặc định đề xuất |
|---|-----|-----|----------------------------|--------|------------------|
| 1 | Chặn | C/I (RLS) | design.md:10-11 ↔ 0019_pa_process_engine.sql:687-690, defs.routes.ts:32-71 | Policy `process_defs_select` cho scope user đọc MỌI hàng `tenant_id IS NULL`; `tenant_admin` gọi được `GET /process-defs` + `/copy` mẫu ⇒ def thư viện (kể cả "Quy trình HĐ – <tên tenant X>" từ backfill, chứa `approver_user_id` của X — design.md:81-82) lộ/sao chép được sang mọi tenant. design §8 không nói. | 0068 thay policy: scope user chỉ đọc `tenant_id = app.tenant_id OR (tenant_id IS NULL AND slot IS NULL)`; `DefsService.list/get/copy` cho role ≠ platform_admin loại `slot IS NOT NULL` (404). Thêm vào test `library-rls.int.test.ts` một ca: tenant_admin không thấy/không copy được def thư viện. |
| 2 | Chặn | B (contract) | design.md:51 ↔ design.md:55-61, tasks.md:52 | Tiêu đề §4 nói route `/process-library/*`, bảng lại dùng `/process-defs…`, `/process-slots`, `/tenants/:tid/process-slots/:slot` ⇒ hai cách hiểu (mount mới hay mở rộng route cũ vốn cho tenant_admin). | Mở rộng route sẵn có, không tiền tố `/process-library`: `GET /process-defs?kind=library\|template` (+ `tenant` như cũ); mọi route MỚI (`/process-slots*`, `/process-defs/:id/{impact,publish,releases,rollback,clone,assignments,preview}`, `/tenants/:tid/process-slots/:slot`) và mọi ghi lên def có `slot` ⇒ chỉ `platform_admin` (403 trước parse). Test "không phải platform_admin ⇒ 403" gọi `POST /process-defs/:id/publish` bằng tenant_admin. |
| 3 | Cao | D (đồng thời) | design.md:40-42; pack-runs.ts:46-74 | `ensureDef` hiện ghi `pack_version` bằng câu UPDATE thứ hai sau `svc.update`; nếu `source_ref` ghi tương tự, hai lượt mở cùng lúc với ref khác (đổi gán giữa chừng) có thể để def nội dung B mang `source_ref` A ⇒ kẹt bản sai tới lần đổi ref kế. Ngoài ra `attach` ghi `steps` theo lần resolve còn run snapshot def lúc `start` ⇒ có thể lệch. | Ghi `source_ref` trong CÙNG câu UPDATE def (điều kiện `version = cur.version`); thua đua (`VERSION_CONFLICT`) ⇒ đọc lại, `source_ref` ≠ ref của mình ⇒ thử lại `ensureDef` 1 lần, vẫn khác ⇒ log `contract-engine-def-race` và trả `machine`. `start` nhận `expectSourceRef`; def đọc trong tx start có `source_ref` khác ⇒ ném `DEF_STALE` ⇒ usecase thử lại 1 lần. Int: hai lượt mở song song, ref khác nhau ⇒ mỗi run snapshot khớp `flow_steps` của nó. |
| 4 | Cao | D (staleness) | design.md:40 `sourceRef = <defId>@<relVersion>#<hash(id)>`; approval-engine.usecase.ts:72-97 | `compiled()` còn phụ thuộc Group owner (`level2GroupKey` cài đặt + `PACK_OWNER_GROUP_KEY`) và catalog Dify; hash chỉ theo id đã phân giải ⇒ đổi các thứ đó không đổi `sourceRef` ⇒ def tenant cũ. Thuật toán hash không ghi. | `sourceRef = "<defId>@<relVersion>#" + sha256(JSON ổn định của def đã compile).slice(0,16)` — hash toàn bộ đầu ra compile, tự bao mọi phụ thuộc. Unit: đổi owner Group ⇒ ref đổi. |
| 5 | Cao | D (fallback) | design.md:46 | "Flow theo id" khi một mã không phân giải được: chưa ghi là trả null trước compile hay để id rỗng. | Bất kỳ mã nào trong `slot_body` thiếu trong map `idsOf` ⇒ không compile, `compiled()` = null ⇒ log `contract-engine-flow-invalid` + máy cũ (khớp Kịch bản "thiếu Group lúc chạy"). |
| 6 | Cao | C (DDL) | design.md:10-22 | Thiếu chi tiết DDL: "check theo registry khe" (DB không đọc được registry TS), FK + luật xoá của `process_slots.default_def_id`, `process_slot_assignments.def_id`, `process_def_releases.def_id`, kiểu `published_by`/`assigned_by`, index cho đếm "Tenant đang dùng"/B2 theo `def_id`. | `slot text CHECK (slot ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$')`, registry kiểm ở app; mọi `def_id` FK → `hub.process_defs(id) ON DELETE RESTRICT`; `*_by uuid NOT NULL`, `*_at timestamptz NOT NULL DEFAULT now()`; index `process_slot_assignments (def_id)`; `process_def_releases` REVOKE UPDATE, DELETE cho `hub_rw`. |
| 7 | Cao | D (đồng thời publish) | design.md:15-16, 101 | Hai publish cùng `version` nháp: xuất bản không đổi `version` nháp ⇒ cả hai qua khoá lạc quan, `max+1` tính đua ⇒ trùng PK ⇒ 500 (design hứa 409). Tương tự rollback. | Publish/rollback trong một tx: `SELECT … FOR UPDATE` hàng def, kiểm `version`, insert `max(rel_version)+1`, set `published_version`, và tăng `version` nháp (+1) ⇒ lần thứ hai nhận 409 `VERSION_CONFLICT`. |
| 8 | Cao | D (chuyển dữ liệu) | design.md:78-80; tasks.md:94 | Idempotent chưa có luật cụ thể: chạy lần 2 khi def `contracts-approval-<tenantkey>` đã có (có thể đã bị admin sửa) thì bỏ qua hay xuất bản lại? "approval_settings khác mặc định" so với giá trị nào? `<tenantkey>` lấy từ cột nào? | Key đã tồn tại ⇒ bỏ qua tenant (không sửa, không xuất bản, gán chỉ `INSERT … ON CONFLICT DO NOTHING`), báo "đã có". "Khác mặc định" = bất kỳ `level1GroupKey/level2GroupKey/ngưỡng` khác giá trị dựng def "Quy trình HĐ mặc định" ở 0069. `<tenantkey>` = `admin.tenants.slug` (đúng cột slug hiện có). |
| 9 | Cao | G (deploy) | design.md:47, 83; tasks.md:35-36 | Sau 0069 (seed mặc định) mà backfill chưa chạy, tenant có mẫu riêng sẽ chạy quy trình mặc định (đổi hành vi khách) — backfill là bước riêng chờ xác nhận. | Runbook deploy: `db:migrate` 0068+0069 và backfill chạy liền trong CÙNG bước deploy (một lần xác nhận); script chạy `--dry-run` trước. Ghi vào tasks.md "Việc còn lại". |
| 10 | Cao | B (contract L2a) | design.md:55-61 | Thiếu schema response: impact, releases list/item, assignments, process-slots, clone, publish lỗi chỉ rõ bước (dạng `details`), danh sách `tenant_count/is_default`. L3 dựa vào. | Thêm zod vào `packages/contracts` (hub-admin): `impact {tenants:int, running_runs:int}`, `releases {items:[{rel_version,name,published_by,published_at,note}]}`, `assignments {items:[{tenant_id,tenant_name,assigned_at}]}`, `process-slots {items:[{slot,label,default_def_id,default_name}]}`, lỗi 422 `details: {stage_key?, reason}` / `{tenant, keys[]}`. |
| 11 | TB | B | design.md:59 vs defs.routes.ts:67 | `POST …/clone` mới song song `POST …/copy` sẵn có. | `clone` = route riêng chỉ cho def có `slot`; giữ `copy` cho mẫu. Key mới = `<key>-copy-<n>` nhỏ nhất còn trống. |
| 12 | TB | B (B6) | design.md:51, 67 | Tên action audit chưa ghi. | `process_library.publish/rollback/assign/unassign/set_default`, `target` = def id, `meta` = {rel_version, tenant_id, slot}. |
| 13 | TB | F | tasks.md:59 | Một test cho cả 3 bảng; `process_slots`/`releases` không có cột tenant ⇒ "không thấy hàng của tenant X" chỉ đúng nghĩa với bảng gán. | Ca test: scope user ⇒ `process_slots`, `process_def_releases` trả 0 hàng; `process_slot_assignments` chỉ hàng của mình. |
| 14 | TB | D (B2 mặc định) | design.md:63-64 | "mọi tenant bật gói contracts chưa gán" — chưa nêu bảng nguồn tenant bật gói. | Dùng bảng bật gói hiện có của admin (cùng nguồn `enablePack`), một SQL tập. |

## Mâu thuẫn giữa tài liệu
- proposal.md:78 "Quy trình cấp nền tảng (tenant `platform`)" ↔ design.md:10 "`tenant_id NULL` + `slot`" → giữ design (`tenant_id NULL`).
- design.md:51 tiêu đề `/process-library/*` ↔ bảng endpoint `/process-defs…` → xem #2.

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
Không có. Mọi lỗ hổng có mặc định nhất quán với "Quyết định" đã duyệt (chỉ platform_admin; tra theo tenant mỗi lượt; 1 tenant × 1 khe).

## Checklist
| Mục | Kết quả | Bằng chứng (file:dòng / mã) |
|-----|---------|-----------------------------|
| A Phạm vi | Đạt | proposal.md:19-66; tasks.md:21-28 |
| B Hợp đồng | Thiếu | #2, #10, #11, #12 |
| C Dữ liệu | Thiếu | design.md:9-25, 93-98; #1, #6 |
| D Nghiệp vụ | Thiếu | design.md:33-48, 99-103; #3, #4, #5, #7, #8, #14 |
| E UI | Ngoài phạm vi vòng này (L3–L5); không thấy Chặn | proposal.md:23-43; design.md:69-75, 85-89 |
| F Kiểm chứng | Đạt (trừ #13) | tasks.md:49-111, mỗi Kịch bản có `[test: … » …]` |
| G Phụ thuộc & môi trường | Thiếu | #9; không thêm thư viện/env mới |
| H Task | Đạt | tasks.md:21-28 (file, migration, phụ thuộc, làn) |
| H2 Vai trò | Đạt theo Luật 0b (không plan/test-plan riêng) | CLAUDE.md Luật 0b |
| I Nhất quán | Mâu thuẫn | proposal.md:78 ↔ design.md:10; design.md:51 |
| J Độ chính xác | Thiếu | #6, #10 |
| K Hiệu năng | Đạt | design.md:35-37, 49 (p95 ≤ 5 ms, 10.000 tenant/50 def/500 release, SQL cố định theo PK); tasks.md:90 `slot-resolve.perf.int.test.ts`; B2 một SQL tập design.md:63 |
| Migration | Đạt | tasks.md:6; journal cuối `when` 1799100000000, không có 0068/0069 |
| Delta openspec | Đạt | tasks.md:45-111 đúng khuôn `### ADDED/MODIFIED` + `#### Yêu cầu` + `- Kịch bản … [test: path » tiêu đề]`; file MODIFIED tồn tại (`docs/current/sht/duyet-ky-so.md`, `sht/cai-dat-va-quyen.md`, `engine/flow-engine.md`) |

## Quét từ mơ hồ
3 kết quả · vô hại: design.md:41 ("có thể lùi" — giải thích), design.md:90 ("tuỳ chọn" — trường yaml optional), proposal.md:22 ("sau này" — ngoài phạm vi v1).

## Chưa kiểm
UI chi tiết L3–L5 (câu chữ nguyên văn, trạng thái rỗng/lỗi); `def.rules.ts`, `approval.mount.ts`, schema `hub-processes.ts`, tên cột `admin.tenants.slug` (mặc định #8 cần agent L2a xác minh); BA/ADR ngoài thư mục spec.
