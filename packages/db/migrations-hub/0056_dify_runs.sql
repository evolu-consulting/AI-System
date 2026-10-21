-- dify-workflows · lịch sử chạy Dify theo workflow cho Admin → Workflows → "Lịch sử chạy" (platform_admin).
-- Mỗi lời gọi Dify của Hub (lệnh / agent / tool MCP) ghi một dòng cùng usage `billing=dify` qua `hub.log_dify_run`
-- (SECURITY DEFINER, EXECUTE hub_rw — hub_api không INSERT trực tiếp). Lưu thêm id phía Dify (workflow_run_id,
-- conversation_id, task_id), trạng thái, thời gian, token, thông báo lỗi đã che. Bảng cấp platform, không RLS
-- (như usage_logs): Admin luôn lọc tenant tường minh. Chỉ thêm bảng + hàm — không mất dữ liệu.
CREATE TABLE IF NOT EXISTS hub.dify_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  workflow_id uuid NOT NULL,
  run_id uuid,
  step_id uuid,
  trigger text NOT NULL,
  status text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  error_message text,
  dify_workflow_run_id text,
  dify_conversation_id text,
  dify_task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dify_runs_pkey PRIMARY KEY (id),
  CONSTRAINT dify_runs_trigger_check CHECK (trigger IN ('command', 'agent', 'schedule')),
  CONSTRAINT dify_runs_status_check CHECK (status IN ('ok', 'failed', 'aborted')),
  CONSTRAINT dify_runs_tokens_check CHECK (input_tokens >= 0 AND output_tokens >= 0 AND duration_ms >= 0),
  CONSTRAINT dify_runs_error_check CHECK (error_message IS NULL OR char_length(error_message) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dify_runs_workflow_at_idx ON hub.dify_runs (workflow_id, created_at DESC, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dify_runs_step_idx ON hub.dify_runs (step_id) WHERE step_id IS NOT NULL;
--> statement-breakpoint
GRANT SELECT ON hub.dify_runs TO admin_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.log_dify_run(
  p_tenant_id uuid, p_user_id uuid, p_workflow_id uuid, p_run_id uuid, p_step_id uuid, p_trigger text,
  p_status text, p_duration_ms integer, p_input_tokens integer, p_output_tokens integer, p_error text,
  p_dify_workflow_run_id text, p_dify_conversation_id text, p_dify_task_id text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  INSERT INTO hub.dify_runs (tenant_id, user_id, workflow_id, run_id, step_id, trigger, status, duration_ms,
    input_tokens, output_tokens, error_message, dify_workflow_run_id, dify_conversation_id, dify_task_id)
  VALUES (p_tenant_id, p_user_id, p_workflow_id, p_run_id, p_step_id, p_trigger, p_status,
    greatest(p_duration_ms, 0), greatest(p_input_tokens, 0), greatest(p_output_tokens, 0),
    left(p_error, 500), p_dify_workflow_run_id, p_dify_conversation_id, p_dify_task_id)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.log_dify_run(uuid, uuid, uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.log_dify_run(uuid, uuid, uuid, uuid, uuid, text, text, integer, integer, integer, text, text, text, text) TO hub_rw;