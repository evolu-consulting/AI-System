-- CR-121 c9 · (1) `process_defs.source_rel_version`: bản xuất bản của def thư viện lúc "Sao chép cho công ty này" (UI "Sao từ … · vN";
-- `source_template_id` đã có từ 0019, KHÔNG có cột bản ⇒ thêm cột nullable). (2) Index tra "bản riêng đã sao từ nguồn X" (idempotent
-- 200 `created:false`). (3) Index lọc lượt chạy theo def thư viện (`snapshot->>'process_def_id'`, ghi lúc launch theo luật) —
-- `GET /process-runs?def_id=&slot=` cùng câu SQL, bị chặn theo (tenant_id, def, started_at). Chỉ THÊM; chạy lại vô hại.
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS source_rel_version integer;
--> statement-breakpoint
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_source_rel_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_source_rel_ck CHECK (
  source_rel_version IS NULL OR (source_rel_version >= 1 AND source_template_id IS NOT NULL AND tenant_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_defs_company_copy_idx ON hub.process_defs (tenant_id, source_template_id)
  WHERE source_rel_version IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_snap_def_idx ON hub.process_runs (tenant_id, ((snapshot ->> 'process_def_id')), started_at DESC);
