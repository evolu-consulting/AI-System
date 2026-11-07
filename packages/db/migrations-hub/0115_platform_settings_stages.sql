-- CR-122 · p22 · (1) hub.platform_settings: cài đặt cấp NỀN TẢNG dạng khoá/giá trị (hiện: `process.stages_max` = số bước tối đa của một quy trình,
-- mặc định 22 khi chưa có hàng). Chỉ platform_admin ghi (route `PUT /process-editor/limits`); hub_rw đọc/ghi, hub_ro đọc.
-- (2) trần cứng 22 → 50 (`PROCESS_STAGES_CEILING`): nới mọi CHECK chỉ số stage/bước của engine từ 0..21 lên 0..49 (chỉ NỚI ⇒ ADD … NOT VALID rồi VALIDATE như 0097).
CREATE TABLE IF NOT EXISTS hub.platform_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_pkey PRIMARY KEY (key),
  CONSTRAINT platform_settings_key_ck CHECK (char_length(key) BETWEEN 1 AND 80)
);
--> statement-breakpoint
REVOKE ALL ON hub.platform_settings FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.platform_settings TO hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.platform_settings TO hub_ro;
--> statement-breakpoint
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_stages_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_stages_ck CHECK (jsonb_typeof(stages) = 'array'
  AND jsonb_array_length(stages) BETWEEN 1 AND 50) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_defs VALIDATE CONSTRAINT process_defs_stages_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_stage_idx_ck
  CHECK (current_stage_idx BETWEEN 0 AND 49) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_step_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_step_ck CHECK (current_step BETWEEN 0 AND 49) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_step_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_stage_idx_ck CHECK (stage_idx BETWEEN 0 AND 49) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.stage_runs VALIDATE CONSTRAINT stage_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_round_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_round_ck
  CHECK (round >= 1 AND (back_to_step IS NULL OR back_to_step BETWEEN 0 AND 49)) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.stage_runs VALIDATE CONSTRAINT stage_runs_round_ck;
--> statement-breakpoint
ALTER TABLE hub.process_outputs DROP CONSTRAINT IF EXISTS process_outputs_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_outputs ADD CONSTRAINT process_outputs_idx_ck
  CHECK (stage_idx BETWEEN 0 AND 49 AND version >= 1 AND attempt >= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_outputs VALIDATE CONSTRAINT process_outputs_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_back_events DROP CONSTRAINT IF EXISTS process_back_events_ck;
--> statement-breakpoint
ALTER TABLE hub.process_back_events ADD CONSTRAINT process_back_events_ck CHECK (from_stage_idx BETWEEN 0 AND 49
  AND to_step >= 0 AND to_step < from_step AND from_step <= 49 AND round_after >= 2
  AND char_length(feedback) BETWEEN 1 AND 4000) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_back_events VALIDATE CONSTRAINT process_back_events_ck;