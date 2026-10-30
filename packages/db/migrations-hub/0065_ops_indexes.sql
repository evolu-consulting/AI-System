-- CR-104 · ops-fix-checks · chỉ mục cho 3 check đọc bảng lớn của ops-watch (Luật 4c: không quét toàn bảng mỗi 30 phút).
-- Viết tay, idempotent (IF NOT EXISTS), chỉ THÊM chỉ mục — không đổi dữ liệu/RLS/GRANT. CREATE INDEX thường trong tx migration
-- (bảng hub.runs/jobs/process_runs của hệ thống này nhỏ; repo không có chỉ mục CONCURRENTLY nào).
-- runs_failed: tổng/failed trong 60 phút theo started_at; ALL_PROVIDERS_EXHAUSTED trong 30 phút theo finished_at (một phần nhỏ).
CREATE INDEX IF NOT EXISTS runs_started_at_idx ON hub.runs (started_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_exhausted_finished_idx ON hub.runs (finished_at)
  WHERE status = 'failed' AND error_code = 'ALL_PROVIDERS_EXHAUSTED';
--> statement-breakpoint
-- stuck: job orphaned trong 60 phút; run quy trình `running` quá hạn.
CREATE INDEX IF NOT EXISTS jobs_orphaned_finished_idx ON hub.jobs (finished_at) WHERE error_reason = 'orphaned';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_running_expires_idx ON hub.process_runs (expires_at) WHERE status = 'running';