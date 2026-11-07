-- CR-122 · p22 · VALIDATE các CHECK đã nới ở 0115 (ADD … NOT VALID). Tách migration riêng: VALIDATE chỉ giữ SHARE UPDATE EXCLUSIVE khi quét,\n-- không còn nằm chung giao dịch với DROP/ADD CONSTRAINT (ACCESS EXCLUSIVE) của 0115.
ALTER TABLE hub.process_defs VALIDATE CONSTRAINT process_defs_stages_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_step_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs VALIDATE CONSTRAINT stage_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs VALIDATE CONSTRAINT stage_runs_round_ck;
--> statement-breakpoint
ALTER TABLE hub.process_outputs VALIDATE CONSTRAINT process_outputs_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_back_events VALIDATE CONSTRAINT process_back_events_ck;
