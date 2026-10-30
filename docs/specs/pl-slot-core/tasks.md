---
id: pl-slot-core
lát: pl-slot-core
cr: CR-105
làn: đầy đủ
migration: hub 0068 (`when` 1801000000000)
phụ thuộc: docs/specs/process-library (design.md, tasks.md L1)
---
## Plan (ngắn)
L1 của CR-105 (xem `docs/specs/process-library/tasks.md`). Test phần tenant/RLS + đường mở lượt viết trước code.

## Làm
- 0068: `process_defs.slot/slot_body/published_version/source_ref` (+ CHECK), `process_runs.is_test`, `process_def_releases`
  (REVOKE UPDATE/DELETE), `process_slots`, `process_slot_assignments` (PK tenant×slot, FK RESTRICT, index def_id), RLS, thu hẹp
  `process_defs_select`. Drizzle: `hub-processes.ts` (cột) + `hub-process-library.ts` (bảng mới).
- Stage schema: `group_key`, `also_group_keys`, `escalate.group_key`, `answerer.group_key`, `run_group_keys` (`process-group-refs.ts`).
- `def.rules` + `def-group-keys.rules`: def thư viện chỉ mã, def tenant chỉ id ⇒ `PROCESS_REF_INVALID`.
- Registry khe `SlotSpec` (kit) + `processes/library/slots.ts`; khe `contracts.approval` đăng ký ở `approval.mount.ts`.
- `resolveSlot` (1 SQL, `processes/library/slot-resolve.repo.ts`), `ensureDef({sourceRef})`, `start.slot` (kiểm `source_ref` + ghi
  `process_name`/`process_version` vào snapshot run), `sourceRefOf` trên cổng.
- `startEngineApproval`/`reopen` mở lượt theo khe; không có bản xuất bản ⇒ `readFlow` cũ.

## Không làm / Chạm
Route thư viện, publish/rollback/clone/assign, seed mặc định (L2a, 0069); UI; bỏ `PUT /approval-flow`/sync (L4).

## Test tối thiểu
`library-rls.int`, `approval-engine-slot.int`, `def-group-keys.rules`, `approval-slot.rules`, `slot-resolve.perf.int` (p95 0,99 ms).

## Quyết định trong lúc làm
- 2026-10-31 `defineRlsSuite` chỉ đặt role gói + `app.tenant_id` (không `app.scope`, đòi FORCE RLS + role NOINHERIT) ⇒ không áp được
  bảng Hub; `library-rls.int` viết tay cùng các ca (đọc chéo, ghi chéo, không scope, thăm dò tồn tại) qua `inHub`.
- 2026-10-31 `source_ref` đóng bằng UPDATE thứ hai có guard `version = <version vừa ghi>` (không cùng UPDATE với `DefsService`, để không
  đổi chữ ký service của L2a); `updateDef` luôn xoá `source_ref` ⇒ sửa tay def tenant làm lần mở lượt kế đồng bộ lại. Thua đua ⇒ thử
  lại 1 lần rồi ném ⇒ máy cũ.
- 2026-10-31 `start` kiểm `source_ref` sau khi tạo run (cùng câu ghi `process_name`): def run chụp phải mang đúng ref ở đúng version;
  lệch ⇒ huỷ run + ném ⇒ máy cũ.
- 2026-10-31 `process_name` ghi vào `hub.process_runs.snapshot` (không thêm cột ở `contracts.approvals` — ngoài migration của lát).
- 2026-10-31 sha256 tính ở engine (`PackRunsPort.sourceRefOf`) vì lớp 1–2 của gói không được dùng `node:*` (depcruise).
- 2026-10-31 `slot_body` của `contracts.approval` = `Flow` với `department_group_key`/`escalate_group_key`/
  `company_signer.department_group_key` (`*_group_id` = null); thiếu BẤT KỲ mã nào ở tenant ⇒ cả lượt máy cũ.
- 2026-10-31 int test của gói cần cổng engine thật ⇒ `apps/hub-api/src/test-support/pack-runs-port.ts` (test gói không import thẳng
  `modules/processes/**` — pack-boundary).
- 2026-10-31 `run_group_keys` chỉ có ở schema + luật; lưu cột cho def thư viện để L2a.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-105)

### ADDED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Quy trình thư viện gắn khe của app
Def thư viện (`tenant_id NULL` + `slot`) trỏ phòng ban bằng mã, không id; def tenant chỉ bằng id.
- Kịch bản: khi def thư viện có khe chứa `group_id` thay vì mã thì lưu bị từ chối 422 `PROCESS_REF_INVALID` [test: apps/hub-api/src/modules/processes/defs/def-group-keys.rules.test.ts » def thư viện dùng id Group ⇒ PROCESS_REF_INVALID]

#### Yêu cầu: Gán tenant × khe = đúng một quy trình
Bảng gán khoá chính (tenant, khe); tenant chỉ đọc hàng của mình, ghi chỉ scope hệ thống; bản phát hành và khe chỉ scope hệ thống.
- Kịch bản: khi tenant Y đọc bảng gán, bản phát hành, khe thì không thấy hàng của tenant X [test: apps/hub-api/src/modules/processes/library/library-rls.int.test.ts » chặn đọc chéo tenant bảng gán, release, khe]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Engine mở lượt theo quy trình gán cho tenant
Mỗi lần mở lượt duyệt (kể cả mở lại), gói tra quy trình theo tenant của HĐ: gán của khe `contracts.approval`, không có ⇒ mặc định; lấy bản xuất bản, phân giải mã phòng ban theo tenant, đồng bộ def tenant `contracts-approval` khi `source_ref` khác; lượt đang chạy giữ snapshot. Chưa có bản xuất bản ⇒ đọc mẫu cũ (L4 bỏ).
- Kịch bản: khi X gán A, Y gán B thì HĐ của X chạy các bước của A, HĐ của Y chạy các bước của B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » X gán A, Y gán B chạy đúng quy trình]
- Kịch bản: khi đổi gán X từ A sang B lúc một HĐ đang duyệt thì lượt đó chạy hết theo A, HĐ vào duyệt sau chạy B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » đổi gán: lượt dở giữ snapshot, lượt mới chạy quy trình mới]
- Kịch bản: khi Group theo mã đã bị xoá khỏi tenant thì lượt chạy máy 2 bước và log `contract-engine-flow-invalid` [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » thiếu Group lúc chạy ⇒ máy cũ]
- Kịch bản: khi mở lượt với 10.000 tenant và 500 bản phát hành thì `resolveSlot` p95 ≤ 5 ms với số câu SQL cố định [test: apps/hub-api/src/modules/processes/library/slot-resolve.perf.int.test.ts » resolveSlot p95 ≤ 5 ms]

## Việc còn lại
- L2a: route/publish/assign/seed 0069; lưu `run_group_keys`; `loadDefRefs` cho def thư viện (tool `contracts-*` + chế độ `library`).
- Dọn DB test perf `ai_system_plslot_*` (tạo khi đo perf trên DB riêng; agent không được phép DROP).
