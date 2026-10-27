# dify-input-map (fast lane, CR-095)

Làn: nhanh (UI + luật thuần, không RLS/tiền). Một agent làm trọn.

## Plan
1. Contract: `FlowDifyStep.inputs?: Record<param, ContractField>` (zod record, key `INPUT_NAME_RE`, ≤ 50), `FLOW_CONTRACT_FIELDS`, rule `DIFY_INPUT_UNKNOWN`, `GET /dify-workflows` item thêm `inputs[{name,type,required,description?}]`.
2. Domain `approval-flow-dify.rules.ts`: `difyArgsOf(wf, inputs)` = ánh xạ hiệu lực (tường minh, không thì cùng tên); `validateDifyCatalog` báo `DIFY_INPUT_UNKNOWN` (khoá lạ) / `DIFY_PARAM_UNSUPPORTED` (sai kiểu, hoặc bắt buộc không thoả — giữ mã cũ).
3. Runtime: `compileDef` → `difyArgs(wf, step.inputs)` ⇒ arg `{from:"input", key}` của trường HĐ được ánh xạ (input run đã được `openRun` điền) — không đổi engine.
4. UI: `FlowDifyInputs` dưới "Chạy quy trình tự động", select "Lấy từ trường hợp đồng"; gợi ý mặc định khi thêm bước (`flow-dify-map.ts`).
5. Test: unit domain + web, 1 int PUT /approval-flow.

## Quyết định
- Kiểu: tham số `number` chỉ nhận `total_value`; `text|paragraph` nhận mọi trường; kiểu khác không ánh xạ được (khớp ma trận engine `paramCompatible`). UI chỉ liệt kê trường hợp lệ.
- Bước cũ (không `inputs`) giữ hành vi cũ: khớp cùng tên; UI hiển thị đúng hiệu lực này, bí danh chỉ gợi ý khi thêm bước mới.
- "— Không gửi —" = bỏ khoá; tham số tuỳ chọn trùng tên trường HĐ vẫn được gửi (hành vi cũ giữ nguyên).
- Không migration (steps là jsonb; repo đọc/ghi nguyên object).

## Delta vs docs/current
- `docs/current` chưa mô tả bước Dify ánh xạ tham số; cập nhật ở STATE cuối đợt.
