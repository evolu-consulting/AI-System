---
id: cr125-g8-flow-flag
lát: cr125-g8-flow-flag
cr: CR-125
làn: nhanh
migration: hub 0126
phụ thuộc:
---
## Plan (ngắn)
Dòng G8 của `docs/specs/CR-125/consistency-audit.md` (#2 phần hai nguồn, check 9). Quyết định người dùng 2026-11-08: BẬT cờ `flow_triggers` cho mọi công ty đã có `company_flows` đang bật (prod: 6 công ty platform gán sẵn).

## Làm
- [x] Migration hub `0126_flow_triggers_backfill.sql`: upsert `flow_triggers=true` cho tenant có dòng `company_flows.enabled`; `on conflict … do update … where not flow_triggers` (idempotent, không đụng tenant khác / hàng đã bật). Int: `processes/library/flow-flag-backfill.int.test.ts`.
- [x] Gán / áp dụng đặt cờ cùng tx: ĐÃ CÓ từ c2 (`company-flows.service.ts` `assign` + `apply` gọi `ensureFlowTriggersOn`); test sẵn `company-flows-active.int.test.ts` (platform gán ⇒ BẬT; công ty khác không đổi). Không sửa thêm.
- [x] ops-watch check `flow_flag` (warn): `ops/adapters/checks/flow-flag.check.ts` (+ registry, `OPS_CHECK_KEYS/META`, i18n vi/en). Một câu SQL tập hợp. Unit `flow-flag.check.test.ts`, int `ops/ops.flow-flag.int.test.ts`.
- [x] `docs/specs/CR-125/wave-review.md` mục A10: SQL kiểm sau migrate (số tenant có flow mà cờ tắt = 0).

## Không làm / Chạm
Không chạm DLC, nhóm G khác, prod. Công tắc Tạm dừng (`FlowSwitch`) giữ nguyên làm cứu hộ; check sẽ cảnh báo khi đang tạm dừng (có chủ đích).

## Test tối thiểu
unit `flow-flag.check.test.ts`; int `flow-flag-backfill.int.test.ts`, `ops.flow-flag.int.test.ts`.

## Quyết định trong lúc làm
- "Đang bật" = `company_flows.enabled`. Check chỉ xét tenant `admin.tenants.active`; migration xét mọi tenant (an toàn hơn).
- Perf: check là một câu `exists`/`not exists` theo `tenant_id` (index `company_flows_enabled_idx`, PK `tenant_flow_settings`), không vòng lặp.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### ADDED ops/flow-flag.md
#### Yêu cầu: Cảnh báo cấu hình quy trình nửa vời
Ops-watch có check `flow_flag`: công ty có quy trình được gán đang bật (`company_flows.enabled`) mà cờ dùng quy trình mới (`tenant_flow_settings.flow_triggers`) tắt hoặc chưa có ⇒ cảnh báo nêu tên công ty và cách xử lý; không còn ⇒ ok.
- Kịch bản: khi công ty có dòng gán đang bật nhưng cờ tắt/vắng thì check cảnh báo, bật cờ thì ok [test: apps/hub-api/src/modules/ops/ops.flow-flag.int.test.ts » gán bật mà cờ tắt/vắng ⇒ warn nêu đúng 2 công ty, bật cờ ⇒ ok]

### MODIFIED engine/company-flows.md
#### Yêu cầu: Công ty đã được gán quy trình luôn dùng quy trình mới
Migration hub 0126 bật cờ cho mọi công ty có `company_flows` đang bật (idempotent, không đụng công ty khác); gán / áp dụng quy trình tự bật cờ cùng giao dịch.
- Kịch bản: khi chạy migration thì công ty có dòng gán bật có cờ BẬT, công ty không có dòng gán giữ nguyên, chạy lại không đổi [test: apps/hub-api/src/modules/processes/library/flow-flag-backfill.int.test.ts » công ty có dòng gán bật ⇒ BẬT, công ty khác không đổi, chạy lại vô hại]
- Kịch bản: khi platform gán quy trình cho công ty thì cờ BẬT cùng giao dịch [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » platform gán quy trình cho công ty mới ⇒ BẬT, công ty không đụng tới ⇒ vẫn TẮT]
