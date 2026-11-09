---
id: cr126-partner-pick-fix2
lát: cr126-partner-pick-fix2
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-engine, cr126-partner-pick-perm
---
## Plan (ngắn)
e2e q6/s7 đỏ: người nhóm phụ trách mở việc «Chọn đối tác & người nhận» nhưng không thấy form. Nguyên nhân (sản phẩm): `collapseModuleSteps`
gắn `module` cho dòng form đang mở ⇒ `approval-flow-view.rules` vẽ bước có `outcome` bằng `moduleFlowStep` (bước tự động «Tự động», bỏ form).

## Làm
- `processes/runs/pack-runs-modules.ts`: cụm node có stage người làm đang mở ⇒ dòng là chính bước đó (task + form), không gắn `module`.

## Không làm / Chạm
Không đổi e2e. Perf: không thêm câu SQL.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Bước chọn người nhận hiện form cho người được giao
Khi bước «Chọn đối tác & người nhận» của node Gửi đối tác đang mở, thẻ hiện bước đó như bước điền form (không phải bước tự động).
- Kịch bản: khi form trong node đang mở thì dòng thẻ là bước form có việc, không mang trạng thái node [test: apps/hub-api/src/modules/processes/runs/pack-runs-modules.test.ts » form đang mở]

## Việc còn lại
- e2e q6/s7 chạy lại một lần (journey-approval-journey).
