# cr174-skipped-steps — CR-174 (bước thuộc nhánh không đi vào hiện «Bỏ qua»)

## Plan
Danh sách «Các bước duyệt»: khi chọn «Nhờ đối tác ký?» = Không, bước «Chọn đối tác & người nhận» vẫn hiện «Đang chờ đối tác trả lời». Nguyên nhân: `outcomeOf` (hub `processes/runs/pack-runs-modules.ts`) coi stage `skipped` là «đã bắt đầu» ⇒ `waiting`. Sửa ở chỗ dựng view (một nguồn): outcome mới `skipped` cho stage bị bỏ qua, hoặc lượt đã kết thúc mà bước chưa từng chạy; bước tương lai của lượt còn chạy giữ `pending`. Web `ModuleStepRow` vẽ chữ mờ «Bỏ qua», chấm xám, không câu «đang chờ».

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Unit phân loại done / waiting / pending / skipped, rồi sửa `outcomeOf` + truyền trạng thái lượt (`RUN_ENDED`) | `processes/runs/pack-runs-modules.{ts,test.ts}`, `pack-runs-view.ts` | [x] |
| 2 | Thêm `skipped` vào enum outcome (contract + kiểu hub) | `packages/contracts/src/{flow/view,pack-contracts/approval}.ts`, `pack-runs.ports.ts`, `approval-engine-card.rules.ts` | [x] |
| 3 | Web vẽ «Bỏ qua» + i18n vi/en | `ModuleStepRow.tsx`, `esignflow.{vi,en}.json` | [x] |
| 4 | e2e: thêm kiểm `approval-step-module` có `data-outcome="skipped"` + chữ «Bỏ qua» vào ca flows3 FL3-1 khi nhánh đó gộp vào staging-improve | e2e flows3 | [ ] |

## Quyết định trong lúc làm
- Thêm `skipped` vào enum `outcome` (đổi contract cộng thêm, tương thích ngược) thay vì ẩn bước: người dùng thấy rõ bước nào không áp dụng.
- Bước không phải module (không cụm) không đổi: vốn bị ẩn khi chưa tới.

## Việc còn lại
- e2e FL3-1 chưa có trên nhánh này (nằm ở nhánh e2e-tenant-flows) nên chưa chạy evotest; mục 4 làm khi gộp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Bước thuộc nhánh không đi vào hiện «Bỏ qua»
Trong danh sách các bước duyệt, bước của nhánh không đi vào (nhánh rẽ khác được chọn, hoặc lượt đã kết thúc mà bước chưa chạy) hiện «Bỏ qua» bằng chữ mờ, không chấm chờ và không câu «đang chờ». Bước tương lai của lượt còn chạy hiện như cũ.
- Kịch bản: khi stage của nhánh không đi vào bị bỏ qua thì bước hiện Bỏ qua, không Đang chờ [test: apps/hub-api/src/modules/processes/runs/pack-runs-modules.test.ts » nhánh không đi vào]
- Kịch bản: khi lượt đã kết thúc mà bước chưa từng chạy thì bước hiện Bỏ qua [test: apps/hub-api/src/modules/processes/runs/pack-runs-modules.test.ts » lượt đã kết thúc mà bước chưa từng chạy]
- Kịch bản: khi lượt còn chạy thì bước tương lai vẫn Chưa tới và bước đang chờ vẫn Đang chờ [test: apps/hub-api/src/modules/processes/runs/pack-runs-modules.test.ts » lượt còn chạy]
