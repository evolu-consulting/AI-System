-- B4 · CR-060 · WRK-FR-27 · PB-R16 · GRANT SELECT(id, status) trên hub.runs cho agent_runtime.
-- Vòng LRU snapshot của Runtime đọc run đang chạy (`runtimes/resolve/host.py` + `runtimes/cli/job_run.py`
-- `_active_runs`: SELECT id WHERE id = ANY(...) AND status='running'); trước đây 42501 "permission denied
-- for table runs" ⇒ cache snapshot không dọn + log lặp. hub.runs bật RLS (0001, policy chỉ cho hub_rw),
-- nên THÊM policy FOR SELECT cho agent_runtime — chỉ hàng status='running'. Quyền cột tối thiểu (id,status):
-- KHÔNG lộ tenant_id/nội dung run cross-tenant (worker vốn đã biết run_id qua hub.jobs). Viết tay, idempotent
-- (GRANT lặp lại vô hại; policy kiểm pg_policies). KHÔNG sửa 0021 (đã áp dev/test). Không mất dữ liệu.

GRANT SELECT (id, status) ON hub.runs TO agent_runtime;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'runs'
                 AND policyname = 'runs_agent_runtime_select') THEN
    CREATE POLICY runs_agent_runtime_select ON hub.runs FOR SELECT TO agent_runtime
      USING (status = 'running');
  END IF;
END
$$;
