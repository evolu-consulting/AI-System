# Admin · Liên kết nguồn và lượt chạy lại

Cập nhật: 2026-11-09 · Gộp từ: cr121-r4-run-links (đợt cr125-wave).

## Yêu cầu: Liên kết nguồn và lượt chạy lại (nguồn: cr121-r4-run-links)
Lượt gắn hợp đồng hiện nhãn hợp đồng (có liên kết khi biết URL app) cạnh "Kích hoạt bởi" và nút "Mở lại quy trình" (thẻ xác nhận + lý do) cho quản trị công ty; lượt đã được chạy lại hiện câu "đã chạy lại" kèm liên kết tới lượt mới.
- Kịch bản: khi lượt gắn hợp đồng và đã được chạy lại thì chi tiết trả `source` và `rerun_by` [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » R-4 · nguồn hợp đồng và lượt đã chạy lại]
- Kịch bản: khi chỉ quản trị đúng công ty và lượt gắn hợp đồng thì mới có nút Mở lại quy trình [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts]
