---
id: cr121-f2-run-detail-404
lát: cr121-f2-run-detail-404
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi e2e D-5 ca 7: `GET /process-runs/<run_id>/detail` 404 với `run_id` lấy từ thẻ duyệt HĐ. Nguyên nhân gốc: `run_id` của thẻ duyệt = `contracts.approvals.id`
(lượt duyệt của GÓI), còn route nhận `hub.process_runs.id` (lượt engine = `approvals.engine_run_id`) ⇒ không có hàng ⇒ `PROCESS_NOT_FOUND`.
Không phải lỗi tra def / `tenant_id` / quyền: `readHead` chỉ đọc `hub.process_runs` theo id + tenant. Sửa tại nguồn: thẻ duyệt engine trả thêm `engine_run_id`.

## Làm
- `packages/contracts/src/pack-contracts/approval.ts`: `ContractApproval.engine_run_id` (uuid|null, optional ⇒ tương thích hub cũ).
- `approval-engine-card.rules.ts`: `engineCardView` điền `engine_run_id` từ `approval.engineRunId` (không thêm câu SQL: đã đọc sẵn).
- Int `tests/acceptance/CF/run-detail-engine-id.int.test.ts`.

## Không làm / Chạm
Không migration, không UI, không sửa e2e (D-5 giữ; spec D-5 cần đọc `engine_run_id` thay vì `run_id`). Route detail/log giữ nguyên 3 câu SQL (≤ 4).
Không nới quyền: tenant_admin công ty khác vẫn 404.

## Test tối thiểu
Int một ca đường thật: gán quy trình thư viện qua service routing (PUT) ⇒ mở lượt duyệt ⇒ platform_admin gọi detail bằng `engine_run_id` = 200;
`run_id` của gói = 404; tenant_admin công ty khác = 404 (có/không `?tenant_id`).

## Quyết định trong lúc làm
- Không cho route processes tra `contracts.approvals` (vỡ ranh giới module gói/engine); mở thêm id đúng ở thẻ.
- `FlowView.run.id` giữ nguyên (= id lượt duyệt, dùng cho hành động duyệt).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Thẻ duyệt hợp đồng chạy engine nêu id lượt chạy engine
Thẻ duyệt (`ContractApproval`) của lượt engine trả thêm `engine_run_id` (id lượt chạy trên engine quy trình, khác `run_id` = lượt duyệt của gói); trang "Chi tiết lượt chạy" của quản trị mở bằng id này. Quyền không đổi: tenant_admin công ty khác nhận 404.
- Kịch bản: khi quy trình thư viện đã gán cho công ty và HĐ vào duyệt thì thẻ trả engine_run_id và platform_admin mở chi tiết lượt chạy nhận 200, tenant_admin công ty khác nhận 404 [test: tests/acceptance/CF/run-detail-engine-id.int.test.ts » F-2 · thẻ duyệt trả engine_run_id nên platform_admin mở được chi tiết, tenant_admin công ty khác 404]

## Việc còn lại
- e2e D-5 ca 7: đọc `engine_run_id` từ thẻ (điều phối sửa).
