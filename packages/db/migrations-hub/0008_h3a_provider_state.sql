-- WRK-FR-22 · WRK-FR-15 · H3a-R05 (plan-db H3a §1, D1): cột probe + tín hiệu quota của provider subscription.
-- Viết tay, idempotent như 0006 (ADD COLUMN IF NOT EXISTS; CHECK qua DO $$ … pg_constraint): chạy được trên DB sạch và DB đã có 0007.
-- Chỉ thêm cột NULL + CHECK — không mất dữ liệu. RLS/GRANT không đổi (agent_runtime: SELECT, INSERT, UPDATE mức bảng ở 0000).
ALTER TABLE hub.provider_state
  ADD COLUMN IF NOT EXISTS last_probe_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_limit_type text,
  ADD COLUMN IF NOT EXISTS utilization real,
  ADD COLUMN IF NOT EXISTS warn_at timestamptz,
  ADD COLUMN IF NOT EXISTS warn_resets_at timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_state_rate_limit_type_check'
                 AND conrelid = 'hub.provider_state'::regclass) THEN
    ALTER TABLE hub.provider_state ADD CONSTRAINT provider_state_rate_limit_type_check
      CHECK (rate_limit_type IS NULL OR rate_limit_type ~ '^[a-z0-9_]{1,40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_state_utilization_check'
                 AND conrelid = 'hub.provider_state'::regclass) THEN
    ALTER TABLE hub.provider_state ADD CONSTRAINT provider_state_utilization_check
      CHECK (utilization IS NULL OR (utilization >= 0 AND utilization <= 1));
  END IF;
END $$;
