-- CR-121 · cr121-c3a-overview-api · "Tổng quan admin platform" (`GET /ops/overview`, hub-api, chỉ platform_admin). Viết tay, idempotent;
-- chỉ THÊM view + 2 chỉ mục — không đổi dữ liệu/RLS/cột, KHÔNG cấp quyền bảng cho hub_rw.
-- (1) hub_api cần ĐẾM lỗi công cụ AI / tỷ lệ lỗi Dify từ `hub.dify_runs` nhưng KHÔNG được đọc cả bảng (error_message, id Dify của mọi tenant).
--     View hẹp `hub.dify_run_stats` chỉ lộ 3 cột cần cho tổng quan (không tenant, không thông báo lỗi, không id phía Dify); chủ view đọc bảng
--     (view không security_invoker), hub_rw chỉ được SELECT view. Ghi dify_runs vẫn chỉ qua hàm DEFINER `hub.log_dify_run`.
-- (2) Hai câu tổng quan lọc theo THỜI GIAN trên mọi công ty: `dify_runs (created_at)` và `process_runs (started_at)` (đã có chỉ mục theo
--     (workflow_id, created_at) / (tenant_id, started_at) nhưng không dùng được cho cửa sổ toàn nền tảng) — Luật 4c: không quét toàn bảng.
CREATE OR REPLACE VIEW hub.dify_run_stats AS
  SELECT workflow_id, status, created_at FROM hub.dify_runs;
--> statement-breakpoint
REVOKE ALL ON hub.dify_run_stats FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON hub.dify_run_stats TO hub_rw;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dify_runs_created_at_idx ON hub.dify_runs (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_started_at_idx ON hub.process_runs (started_at);