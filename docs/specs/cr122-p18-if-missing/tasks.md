---
id: cr122-p18-if-missing
lát: cr122-p18-if-missing
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Demo: HĐ chưa có Giá trị ⇒ node Nếu "Giá trị trên 120 triệu?" lặng lẽ rẽ nhánh "≤" như thể = 0 (vi phạm Luật GỐC 3).
Sửa: vế `fact`/`input` mà kết quả phụ thuộc còn trống (null/""/[]; so số mà không phải số) ⇒ Nếu KHÔNG rẽ, dừng "Cần xử lý"
lý do mới `missing_fact` (mang khoá trường thiếu); Thử lại (`add_attempt`) xếp lại stage Nếu ⇒ đọc lại dữ kiện hiện tại; Huỷ.

## Làm
- [x] `missingKeysOf` (domain/if/if.rules.ts) — AND có vế Sai chắc / OR có vế Đúng chắc ⇒ kết quả đã rõ, không dừng.
- [x] `settleStep` (ifTargetOf/takeBranch): thiếu ⇒ `StepRepo.missingFact` (flow-step.repo: stage Nếu + run `needs_decision`,
      `decision = {reason: missing_fact, stage_idx, missing, options: [add_attempt, cancel], at}`), không ghi lần rẽ.
- [x] `DECISION_REASONS` + `missing_fact` (nối cuối, 25) · `onAddAttempt`: `missing_fact` ⇒ queued giữ `attempt` (như timer_invalid).
- [x] Thẻ duyệt HĐ: `stepsView.decision.missing` ⇒ `attention.missing` = NHÃN dữ kiện từ `CONTRACTS_MANIFEST` (một nguồn);
      workspace-web: "Quy trình đang dừng: Thiếu Giá trị hợp đồng — điền vào hợp đồng rồi bấm Thử lại" + nút Thử lại sẵn có
      (owner/admin gói, `POST .../approval/retry`).
- [x] i18n vi+en (contracts attention.reason.missing_fact[_any], process common missing_fact[_hint]), nhãn thread.

## Không làm / Chạm
Không chạm tool-run.rules.ts, bridge/, tool-stage-settle.ts, DLC. Không migration (decision là jsonb, `review_tasks.reason` không
dùng — như `facts_changed` không tạo task).

## Test tối thiểu
- unit: if.rules.test.ts (missingKeysOf), approval-engine-card.rules.test.ts, approval-engine-card.usecase.test.ts (nhãn), attention.test.ts.
- int: flow-step.repo.int.test.ts (thiếu ⇒ needs_decision missing_fact; điền + chạy lại Nếu ⇒ đúng nhánh; "abc" ⇒ thiếu).
- e2e: journey-approval (evotest) — hồi quy.

## Quyết định trong lúc làm
- Vế `field` (output bước trước) giữ như cũ (không dừng) — chỉ `fact`/`input` theo brief.
- Nhãn trường đổi ở usecase gói (domain chỉ builtin, ADR-0023); khoá lạ ⇒ giữ khoá.
- Acceptance khoá `contracts-pd2.test.ts` sửa 24→25 (nối cuối enum, cùng kiểu E2b) + relock.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Node Nếu không rẽ khi thiếu dữ kiện (CR-122 P18)
Điều kiện của node Nếu đọc dữ kiện app (`fact`) hoặc input run mà giá trị còn trống (null, "", danh sách rỗng; so số mà giá trị
không phải số) và kết quả phụ thuộc vào vế đó ⇒ engine KHÔNG chọn nhánh: stage Nếu và lượt chạy `needs_decision` với
`decision.reason = missing_fact`, `decision.missing` = khoá còn thiếu, lựa chọn Thử lại (`add_attempt`, xếp lại Nếu để đọc lại
dữ kiện hiện tại) hoặc Huỷ. Thẻ duyệt hợp đồng nêu nhãn trường ("Thiếu Giá trị hợp đồng — điền vào hợp đồng rồi bấm Thử lại")
và nút Thử lại cho chủ hợp đồng/quản trị gói.
- Kịch bản: Giá trị trống ⇒ Nếu + run needs_decision missing_fact, không ghi lần rẽ; điền giá trị + chạy lại Nếu ⇒ rẽ đúng nhánh [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » CR-122 P18 · trường trống ⇒ KHÔNG rẽ]
- Kịch bản: giá trị không phải số khi so số ⇒ cũng là thiếu [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » CR-122 P18 · số không hợp lệ]
- Kịch bản: AND có vế chắc Sai / OR có vế chắc Đúng ⇒ không dừng vì vế thiếu [test: apps/hub-api/src/modules/processes/domain/if/if.rules.test.ts » kết quả đã rõ]
- Kịch bản: thẻ duyệt nêu nhãn trường từ manifest, không lộ khoá [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-card.usecase.test.ts » CR-122 P18]
- Kịch bản: banner hiện câu "Thiếu <nhãn> — … Thử lại" [test: apps/workspace-web/src/features/contract-approval/lib/attention.test.ts » CR-122 P18]

## Việc còn lại
- Chưa có int/e2e đi đường HTTP Thử lại thật (`POST .../approval/retry` ⇒ GateService.decide add_attempt ⇒ Nếu chạy lại) — đường
  `add_attempt` giữ attempt dùng chung nhánh `timer_invalid` (AC-H41). Nên thêm vào e2e hành trình đợt cuối CR.
- admin-web RunHeader: nút riêng cho `missing_fact` chưa làm (task quyết định chung + i18n common đã có).
