-- CR-121 D-1 · trần quy trình 22 stage (= 20 bước duyệt HĐ + `route` + `finalize`; `PROCESS_STAGES_MAX` = 22): nới mọi CHECK
-- chỉ số stage/bước của engine từ 0..9 (10 stage, 0019/0024) lên 0..21. Chỉ NỚI (hàng cũ luôn thoả) ⇒ ADD … NOT VALID rồi
-- VALIDATE (khoá nhẹ SHARE UPDATE EXCLUSIVE khi quét, không chặn ghi). Không sửa migration cũ (đã chạy prod).
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_stages_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_stages_ck CHECK (jsonb_typeof(stages) = 'array'
  AND jsonb_array_length(stages) BETWEEN 1 AND 22) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_defs VALIDATE CONSTRAINT process_defs_stages_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_stage_idx_ck
  CHECK (current_stage_idx BETWEEN 0 AND 21) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_step_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_step_ck CHECK (current_step BETWEEN 0 AND 21) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_step_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_stage_idx_ck CHECK (stage_idx BETWEEN 0 AND 21) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.stage_runs VALIDATE CONSTRAINT stage_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_round_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_round_ck
  CHECK (round >= 1 AND (back_to_step IS NULL OR back_to_step BETWEEN 0 AND 21)) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.stage_runs VALIDATE CONSTRAINT stage_runs_round_ck;
--> statement-breakpoint
ALTER TABLE hub.process_outputs DROP CONSTRAINT IF EXISTS process_outputs_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_outputs ADD CONSTRAINT process_outputs_idx_ck
  CHECK (stage_idx BETWEEN 0 AND 21 AND version >= 1 AND attempt >= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_outputs VALIDATE CONSTRAINT process_outputs_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_back_events DROP CONSTRAINT IF EXISTS process_back_events_ck;
--> statement-breakpoint
ALTER TABLE hub.process_back_events ADD CONSTRAINT process_back_events_ck CHECK (from_stage_idx BETWEEN 0 AND 21
  AND to_step >= 0 AND to_step < from_step AND from_step <= 21 AND round_after >= 2
  AND char_length(feedback) BETWEEN 1 AND 4000) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_back_events VALIDATE CONSTRAINT process_back_events_ck;
