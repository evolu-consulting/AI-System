---
id: cr122-p19-tool-reason
lát: cr122-p19-tool-reason
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Bước tự động (tool) lỗi ⇒ stage `needs_decision` nhưng thẻ HĐ chỉ nói "một bước tự động gặp lỗi". Ghi MÃ MÁY lỗi vào
`hub.stage_runs.last_error_code` (cột có sẵn) ở mọi đường `tool_failed`, đẩy mã qua `stepsView.decision.code` ⇒ `attention.code`
của thẻ, rồi UI map mã ⇒ câu "vì sao + làm gì" (i18n vi + en).

## Làm
- `tool-stage-settle.ts` / `run-tool-stage.usecase.ts`: mã `TOOL_OFF` · `NO_REAL_ACTION` · `INPUT_SCHEMA_INVALID` · `MISSING_ARG:<tên>` ·
  `RESULT_TOO_LARGE` · `OUTPUT_REJECTED` · `TOOL_CRASH` · hoặc mã lỗi của tool; `ToolStageRepo.decide` nhận `code` ⇒ ghi `last_error_code`;
  log warn `process-tool-decision` (tool_key + code, không PII). Registry gói log thêm `code`.
- `packs/contracts/adapters/intake.errors.ts`: lỗi Ký số (ESignFail trừ `ESIGN_PROVIDER` tạm thời; `NO_PARTNER_EMAIL`,
  `ESIGN_NODE_NO_SIGNER`…) ⇒ `PackToolBusinessError(mã)` ⇒ không thử lại vô ích, mã tới được stage.
- `stepsView.decision.code` ⇒ `EngineAttention.code` ⇒ contract `ApprovalAttention.code` ⇒ `attention.ts` + i18n `…attention.reason.tool.*`.

## Không làm / Chạm
Không sửa `tool-run.rules.ts`, `bridge/`, runtime node Nếu, DLC. Không migration (dùng cột có sẵn, ≤ 64 ký tự).

## Test tối thiểu
unit `attention.tool.test.ts` (mã ⇒ khoá i18n, đủ vi+en), `intake.errors.test.ts`; int `tool-fail-reason.int.test.ts` (ESIGN_DISABLED ⇒
`last_error_code` + thẻ có `code`; thiếu đầu vào ⇒ `MISSING_ARG`); e2e hành trình `journey-approval` một lần trên evotest.

## Quyết định trong lúc làm
- Lỗi Ký số nghiệp vụ không còn bị coi là `UPSTREAM_ERROR` (trước đây thử lại ~10' rồi mới dừng); lỗi mạng/nhà cung cấp vẫn thử lại.
- Mã lạ ⇒ câu chung kèm mã để báo quản trị; `retry_exhausted` giữ câu cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Bước tự động lỗi nói rõ vì sao và làm gì
Khi stage `tool` chuyển `needs_decision` vì `tool_failed`, engine ghi mã máy của lỗi vào `last_error_code` của stage (mã của tool, hoặc
`TOOL_OFF`, `NO_REAL_ACTION`, `INPUT_SCHEMA_INVALID`, `MISSING_ARG:<tên>`, `RESULT_TOO_LARGE`, `OUTPUT_REJECTED`, `TOOL_CRASH`) và log
cảnh báo kèm khoá tool + mã. Thẻ duyệt hợp đồng mang mã ở `attention.code` và hiện câu tiếng Việt/Anh nêu nguyên nhân và cách xử lý
(vd chưa bật ký số ⇒ vào Cài đặt › Ký số bật rồi Thử lại); mã lạ ⇒ câu chung kèm mã. Các nút quyết định giữ nguyên.
- Kịch bản: khi tool Ký số trả `ESIGN_DISABLED` thì stage `needs_decision`, `last_error_code = ESIGN_DISABLED` và thẻ duyệt có `attention.code` [test: apps/hub-api/src/modules/processes/adapters/tools/tool-fail-reason.int.test.ts » tool trả ESIGN_DISABLED ⇒ stage needs_decision, last_error_code, thẻ có code]
- Kịch bản: khi thiếu đầu vào của tool thì `last_error_code = MISSING_ARG:<tên>` [test: apps/hub-api/src/modules/processes/adapters/tools/tool-fail-reason.int.test.ts » thiếu đầu vào ⇒ MISSING_ARG:<tên>]
- Kịch bản: khi hiển thị thẻ với mã đã biết thì dùng câu riêng, mã lạ dùng câu chung kèm mã [test: apps/workspace-web/src/features/contract-approval/lib/attention.tool.test.ts » mã lạ ⇒ câu chung kèm mã, không mã ⇒ câu cũ]
- Kịch bản: khi tool Ký số ném lỗi nghiệp vụ thì kết quả có mã đó, không phải `UPSTREAM_ERROR` [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.errors.test.ts » qua registry: mã nghiệp vụ giữ nguyên, lỗi mạng ⇒ UPSTREAM_ERROR]

## Việc còn lại
Gộp `docs/current/engine/flow-runtime.md` khi slice:merge.

