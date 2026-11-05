-- CR-121 · cr121-c3a-overview-api · "Tổng quan admin platform" (`GET /ops/overview`, hub-api, chỉ platform_admin). Viết tay, idempotent;
-- chỉ THÊM quyền đọc + 2 chỉ mục — không đổi dữ liệu/RLS/cột.
-- (1) hub_rw (hub_api) cần ĐỌC `hub.dify_runs` để đếm lỗi công cụ AI / tỷ lệ lỗi Dify (0056 chỉ cấp SELECT cho admin_rw; ghi vẫn chỉ qua
--     hàm DEFINER `hub.log_dify_run`). Bảng cấp nền tảng, không RLS — route đọc chỉ cho platform_admin.
-- (2) Hai câu tổng quan lọc theo THỜI GIAN trên mọi công ty: `dify_runs (created_at)` và `process_runs (started_at)` (đã có chỉ mục theo
--     (workflow_id, created_at) / (tenant_id, started_at) nhưng không dùng được cho cửa sổ toàn nền tảng) — Luật 4c: không quét toàn bảng.
GRANT SELECT ON hub.dify_runs TO hub_rw;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dify_runs_created_at_idx ON hub.dify_runs (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_started_at_idx ON hub.process_runs (started_at);
