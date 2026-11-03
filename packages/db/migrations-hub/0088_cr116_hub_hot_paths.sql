-- CR-116 · cr116-apply-hub (pha 2, số đo: docs/specs/cr116-bench-hub/tasks.md "## Số đo"). Chỉ THÊM index + 1 hàm; chạy lại
-- cho cùng kết quả.
-- B1 · `launcher-session.isContinuing` (pgss: 2.317 lần, 1.487 buffers/lần): lọc `stage_run_id = $1 and tenant_id = $2` trên
-- `hub.review_tasks` (chỉ có index một phần `status = 'open'`) và `max(started_at)` trên `hub.runs` (không index
-- `stage_run_id`) ⇒ Seq Scan cả hai bảng. Bench 100k hàng: EXPLAIN 7.258 → 15 buffers, p50 26,0 → 0,79 ms; cỡ 100 hàng hoà.
-- Đúng biến thể đã đo ("+index (stage_run_id,tenant_id) cả 2 bảng"). Bảng nhỏ ở prod ⇒ CREATE thường (như 0066/0082).
CREATE INDEX IF NOT EXISTS review_tasks_stage_tenant_idx ON hub.review_tasks (stage_run_id, tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_stage_tenant_started_idx ON hub.runs (stage_run_id, tenant_id, started_at)
  WHERE stage_run_id IS NOT NULL;
--> statement-breakpoint
-- B3 · người nhận `process.updated` cho CẢ LÔ run một câu (bench: lô 100 run p50 44,4 → 8,3 ms, 101 → 2 câu). Cùng thân
-- và cùng cách ly của `hub.process_run_recipients` (0020) — definer bỏ RLS (nhánh `room_members`), search_path cố định, tên
-- bảng đủ schema — nhưng theo tập: mỗi cặp (run, tenant) đầu vào ⇒ hàng (run_id, uid). Cặp tenant không khớp run ⇒ không
-- hàng. Scope 'user' ⇒ chỉ run của tenant GUC; 'system' ⇒ mọi cặp khớp; scope khác/không scope ⇒ không hàng.
CREATE OR REPLACE FUNCTION hub.process_runs_recipients(p_runs uuid[], p_tenants uuid[])
  RETURNS TABLE (run_id uuid, uid uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT DISTINCT r.id, u.uid
  FROM unnest(p_runs, p_tenants) AS p(run, tenant)
  JOIN hub.process_runs r ON r.id = p.run AND r.tenant_id = p.tenant
  CROSS JOIN LATERAL (
    SELECT r.started_by AS uid WHERE r.started_by IS NOT NULL
    UNION
    SELECT m.user_id FROM hub.room_members m
      WHERE r.origin_kind = 'room' AND r.origin_room_id IS NOT NULL
        AND m.room_id = r.origin_room_id AND m.tenant_id = r.tenant_id AND m.left_at IS NULL
    UNION
    SELECT a.user_id FROM hub.review_task_assignees a
      JOIN hub.review_tasks t ON t.id = a.task_id AND t.tenant_id = a.tenant_id
      WHERE t.process_run_id = r.id AND t.tenant_id = r.tenant_id AND t.status = 'open' AND a.user_id IS NOT NULL
    UNION
    SELECT gm.user_id FROM hub.review_tasks t
      JOIN admin.group_members gm ON gm.group_id = t.assignee_group_id AND gm.tenant_id = r.tenant_id
      WHERE t.process_run_id = r.id AND t.tenant_id = r.tenant_id AND t.status = 'open'
        AND t.assignee_group_id IS NOT NULL
  ) u
  WHERE current_setting('app.scope', true) = 'system'
    OR (current_setting('app.scope', true) = 'user'
      AND NULLIF(current_setting('app.tenant_id', true), '')::uuid = r.tenant_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.process_runs_recipients(uuid[], uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.process_runs_recipients(uuid[], uuid[]) TO hub_rw;
