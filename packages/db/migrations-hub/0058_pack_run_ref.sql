-- contract-flow S1a · cầu gói ↔ engine v2: (1) run gắn bản ghi gói `pack_key` + `pack_record_id` (CHỈ `PackRunsPort.start`
-- ghi, route công khai `/process-*` không ghi); đã gắn thì không đổi (trigger). (2) `process_defs.pack_version` = version def gói
-- đã đồng bộ (`ensureDef` idempotent theo version). Chạy lại vô hại.
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS pack_key text;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS pack_record_id uuid;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_pack_ref_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_pack_ref_ck CHECK (
  (pack_key IS NULL) = (pack_record_id IS NULL) AND (pack_key IS NULL OR pack_key ~ '^[a-z][a-z0-9-]{0,39}$'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_pack_ref_idx ON hub.process_runs (tenant_id, pack_key, pack_record_id)
  WHERE pack_key IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.process_runs_pack_ref_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pack_key IS NOT NULL AND (NEW.pack_key IS DISTINCT FROM OLD.pack_key
      OR NEW.pack_record_id IS DISTINCT FROM OLD.pack_record_id) THEN
    RAISE EXCEPTION 'process_runs.pack_ref is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS process_runs_pack_ref_frozen ON hub.process_runs;
--> statement-breakpoint
CREATE TRIGGER process_runs_pack_ref_frozen BEFORE UPDATE OF pack_key, pack_record_id ON hub.process_runs
  FOR EACH ROW EXECUTE FUNCTION hub.process_runs_pack_ref_frozen();
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS pack_version integer;
