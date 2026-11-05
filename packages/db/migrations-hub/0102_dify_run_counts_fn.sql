-- CR-121 F-4 · view `hub.dify_run_stats` (0100) chạy theo quyền chủ view ⇒ mọi đường hub_rw đọc được metadata Dify (workflow, trạng thái,
-- thời điểm từng lần chạy) của MỌI công ty. Thay bằng hai hàm SECURITY DEFINER chỉ trả SỐ ĐẾM (không tenant, không thời điểm từng
-- dòng, không lỗi, không id phía Dify). Pin search_path, REVOKE PUBLIC, chỉ hub_rw được EXECUTE. Chỉ phục vụ "Tổng quan admin platform".
--   dify_run_counts(since[, until])  → (workflow_id, status, n) trong [since, until).  `until` mặc định vô hạn ⇒ gọi một đối số vẫn được.
--   dify_failing_tool_count(since, streak[, until]) → SỐ workflow có `streak` lần chạy gần nhất (trong cửa sổ) đều `failed`.
-- Chạy lại vô hại. Phụ thuộc: bảng hub.dify_runs + chỉ mục `dify_runs_created_at_idx` (0100).
DROP VIEW IF EXISTS hub.dify_run_stats;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.dify_run_counts(p_since timestamptz, p_until timestamptz DEFAULT 'infinity')
  RETURNS TABLE (workflow_id uuid, status text, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.workflow_id, r.status, count(*)::bigint
  FROM hub.dify_runs r
  WHERE r.created_at >= p_since AND r.created_at < p_until
  GROUP BY r.workflow_id, r.status
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.dify_failing_tool_count(p_since timestamptz, p_streak integer, p_until timestamptz DEFAULT 'infinity')
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*)::int FROM (
    SELECT x.workflow_id
    FROM (SELECT r.workflow_id, r.status,
            row_number() OVER (PARTITION BY r.workflow_id ORDER BY r.created_at DESC) AS rn
          FROM hub.dify_runs r WHERE r.created_at >= p_since AND r.created_at < p_until) x
    WHERE x.rn <= p_streak
    GROUP BY x.workflow_id
    HAVING count(*) = p_streak AND bool_and(x.status = 'failed')) f
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.dify_run_counts(timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.dify_failing_tool_count(timestamptz, integer, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.dify_run_counts(timestamptz, timestamptz) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.dify_failing_tool_count(timestamptz, integer, timestamptz) TO hub_rw;
--> statement-breakpoint
-- Low (review cuối đợt): `rerun_of` (0098) FK mặc định NO ACTION ⇒ xoá run gốc bị chặn bởi run chạy-lại. Đổi sang SET NULL
-- (run chạy lại vẫn tồn tại, chỉ mất liên kết). NOT VALID rồi VALIDATE (khoá ngắn, như 0098). Chạy lại vô hại.
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_rerun_of_fk;
--> statement-breakpoint
ALTER TABLE hub.process_runs
  ADD CONSTRAINT process_runs_rerun_of_fk FOREIGN KEY (rerun_of) REFERENCES hub.process_runs (id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_rerun_of_fk;
