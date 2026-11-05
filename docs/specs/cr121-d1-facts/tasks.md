---
id: cr121-d1-facts
lát: cr121-d1-facts
cr: CR-121 (phần D, lát D-1)
làn: đầy đủ (đường nóng route/finalize + migration hub)
migration: hub 0097_process_stages_22 (idx 82, sau 0096 của D-4) + pack-contracts 0075_flow_steps_20
phụ thuộc: cr121-d0 (đã gộp)
---
## Plan (ngắn)
Spec: `docs/specs/cr121-d/spec.md` R3 + R4. Dựng `FlowFacts` đủ 4 trường từ HĐ HIỆN TẠI mỗi lần rẽ/kết thúc; nâng trần 20 bước.

## Làm
- [x] `adapters/flow-facts.repo.ts` (mới): `flowFactsRepo(tx, tid).newPartner` (tx gói, MỘT câu, index `contracts_partner_key_idx`) +
  `creatorDepartmentsOf(db)` (scope system hub, MỘT câu CTE đệ quy phòng cha, như `ROUTE_SLOT_SQL`).
- [x] `domain/approval-flow-cond.rules.ts`: `factNeedsOf(steps)` — chỉ đọc nguồn mà mẫu chụp dùng (mẫu cũ ⇒ 0 câu thêm).
- [x] `application/approval-engine.usecase.ts`: `routeStep`/`finalizeRun` dựng dữ kiện đầy đủ (`fullFacts`); `requiredSteps` ở finalize
  dùng cùng dữ kiện (đối tác mới trong tx khoá HĐ; phòng ban đọc song song trước tx).
- [x] Trần: `APPROVAL_FLOW_STEPS_MAX` 20 (contracts + domain), `PROCESS_STAGES_MAX` 22, i18n `v2l` STEPS_MAX, migration hub 0097 nới
  `process_defs_stages_ck` (1..22), `process_runs_stage_idx_ck`/`process_runs_step_ck`/`stage_runs_stage_idx_ck`/`process_outputs_idx_ck`
  (0..21), `stage_runs_round_ck` (`back_to_step` ≤ 21), `process_back_events_ck` (`from_step`/`from_stage_idx` ≤ 21).

## Không làm / Chạm
UI, preview (D-2), kiểm xuất bản (D-2), gán bật engine (D-4), e2e. Nối ngoài dòng D-1 (chỉ thêm, file không lát nào sở hữu):
`extraction.mount.ts` (repo `flowFacts` vào uow gói + `creatorDepartments` kèm nguồn Group), `approval-engine.ports.ts` (kiểu).

## Test tối thiểu
- unit: `domain/approval-flow-facts.rules.test.ts`, `application/approval-engine-facts.test.ts`, `approval-flow.rules.test.ts` (21 ⇒ STEPS_MAX).
- int: `adapters/flow-facts.repo.int.test.ts` (rẽ sau sửa giá trị, phòng con, đối tác mới, chặn chéo tenant, def 20 bước + CHECK 0097).

## Quyết định trong lúc làm
- "Phòng ban người tạo" = phòng của **người bắt đầu lượt duyệt** (`approvals.started_by` = danh tính run của tool), KHÔNG phải
  `contracts.created_by`. Hai người khác nhau khi HĐ do người A tạo mà người B gửi duyệt (vd nhập hộ). Lý do: (1) luật chọn quy trình
  theo phòng ban (CR-118 §11.2, `routeSlot`) đã dùng người bắt đầu lượt — một khái niệm "phòng ban người tạo" phải cùng một người ở cả
  chọn quy trình lẫn điều kiện bước (Luật GỐC 1); (2) lượt mở lại/Đọc lại giữ `started_by` nên kết quả rẽ ổn định; (3) 0 câu SQL thêm để
  biết người (đã có trong ngữ cảnh run). Đổi sang người tạo HĐ ⇒ đổi cả `routeSlot` (lát riêng). Điều phối đồng ý (2026-11-05). **D-3: nhãn trường
  `creator_department` = "Phòng ban người gửi duyệt"** (vi) / "Submitter's department" (en).
- Pack-contracts 0075 nới `approval_flows_steps_ck` (0047) + `approvals_flow_steps_ck` (0050) 1..8 ⇒ 1..20 (mẫu tenant + bản chụp lượt).
- "HĐ đã duyệt" cho `new_partner` = `confirmed_at is not null`, `kind = 'contract'`, cùng `partner_key`; HĐ chưa có khoá đối tác ⇒ null.
- Role gói `contracts_rw` không đọc `admin.*`, `hub_api` không đọc `contracts.*` ⇒ hai nguồn, mỗi nguồn ≤ 1 câu, chỉ khi mẫu dùng tới.
  Phòng ban đọc NGOÀI tx gói (không giữ hai kết nối). Finalize đọc phòng ban song song với `passedStages` (không thêm độ trễ).
- Perf (số câu SQL mỗi lần rẽ): byRun 1 + đối tác mới 0/1 + phòng ban 0/1 (mẫu cũ: 1 như trước). Finalize: +1 phòng ban (song song) +
  0/1 đối tác mới trong tx.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: trần stage quy trình 22
Quy trình (def) có tối đa 22 stage (`PROCESS_STAGES_MAX`), chỉ số stage/bước 0..21; DB nới CHECK theo (migration hub 0097).
- Kịch bản: def duyệt HĐ 20 bước (22 stage) lưu được; run ở stage 21 qua CHECK; bước 22 bị chặn [test: apps/hub-api/src/modules/packs/contracts/adapters/flow-facts.repo.int.test.ts » def 20 bước (22 stage) lưu qua ensureDef thật]
- Kịch bản: mẫu 21 bước ⇒ STEPS_MAX [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow.rules.test.ts » validateFlow]

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: rẽ theo dữ kiện hiện tại của HĐ
Tool `contracts-route`/`contracts-finalize` xét điều kiện bước trên loại HĐ, giá trị, phòng ban người bắt đầu lượt (gồm phòng cha) và đối tác mới,
đọc lại mỗi lần rẽ; thiếu dữ liệu ⇒ bước chạy.
- Kịch bản: 600 tr qua bước ≥ 500 tr; sửa còn 100 tr giữa lượt ⇒ lần rẽ sau bỏ qua [test: apps/hub-api/src/modules/packs/contracts/adapters/flow-facts.repo.int.test.ts » 600 tr ⇒ qua bước ≥ 500 tr]
- Kịch bản: người bắt đầu thuộc phòng con của sales ⇒ điều kiện `creator_department in [sales]` đúng [test: apps/hub-api/src/modules/packs/contracts/adapters/flow-facts.repo.int.test.ts » người bắt đầu thuộc phòng con của sales]
- Kịch bản: HĐ chưa gắn đối tác ⇒ bước chạy; đã có HĐ duyệt cùng đối tác ⇒ bỏ qua [test: apps/hub-api/src/modules/packs/contracts/adapters/flow-facts.repo.int.test.ts » đối tác mới]
- Kịch bản: finalize đòi bước phòng ban khi áp dụng [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-facts.test.ts » contracts-finalize kiểm lại cùng dữ kiện]
- Kịch bản: đọc dữ kiện không thấy dữ liệu tenant khác [test: apps/hub-api/src/modules/packs/contracts/adapters/flow-facts.repo.int.test.ts » chặn đọc chéo tenant]

## Việc còn lại
- (Đã xử, điều phối duyệt) `BRANCH_RULES_MAX` 10 ⇒ 20 ở contracts, hub `branch-def.rules.ts`, admin-web `branch-rules.ts` (mẫu 20 bước
  cần tới 19 luật rẽ mỗi stage); test khoá sửa phần hằng: `P-d/rules/d2/{contracts-pd2,def-issues}.test.ts`,
  `P-b2/rules/contracts-pb2.test.ts`, admin-web `step-ops.test.ts`.
- Thẻ duyệt (`approval-engine-card.usecase.ts`) vẫn hiện bỏ qua theo loại/giá trị; điều kiện phòng/đối tác hiện "chạy" (D-2/D-3).
