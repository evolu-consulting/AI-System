-- CR-122 · p22 · (1) hub.platform_settings: cài đặt cấp NỀN TẢNG dạng khoá/giá trị (hiện: `process.stages_max` = số bước tối đa của một quy trình,
-- mặc định 22 khi chưa có hàng). Chỉ platform_admin ghi (route `PUT /process-editor/limits`) qua hàm `hub.set_platform_setting`; hub_rw/hub_ro chỉ đọc.
-- (2) trần cứng 22 → 50 (`PROCESS_STAGES_CEILING`): nới mọi CHECK chỉ số stage/bước của engine từ 0..21 lên 0..49 (chỉ NỚI ⇒ hàng cũ luôn thoả).
-- Ở đây CHỈ `ADD … NOT VALID` (không quét bảng khi giữ khoá); VALIDATE ở migration 0116 riêng (không giữ ACCESS EXCLUSIVE trong lúc quét process_runs/stage_runs/…).
CREATE TABLE IF NOT EXISTS hub.platform_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_pkey PRIMARY KEY (key),
  CONSTRAINT platform_settings_key_ck CHECK (char_length(key) BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE hub.platform_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Đọc: mọi đường hub (hub_rw/hub_ro). GHI: không có policy ghi ⇒ hub_rw không INSERT/UPDATE trực tiếp được (cũng không được GRANT);
-- chỉ qua hàm SECURITY DEFINER bên dưới (khoá cho phép + kiểm giá trị); route `PUT /process-editor/limits` chỉ platform_admin.
CREATE POLICY platform_settings_read ON hub.platform_settings FOR SELECT TO hub_rw, hub_ro USING (true);
--> statement-breakpoint
REVOKE ALL ON hub.platform_settings FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON hub.platform_settings TO hub_rw, hub_ro;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.set_platform_setting(p_key text, p_value jsonb, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, hub AS $fn$
BEGIN
  IF p_key = 'process.stages_max' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric)
       OR (p_value #>> '{}')::numeric NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'invalid value for %', p_key USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown platform setting %', p_key USING ERRCODE = '22023';
  END IF;
  INSERT INTO hub.platform_settings AS s (key, value, updated_by, updated_at) VALUES (p_key, p_value, p_actor, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.set_platform_setting(text, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.set_platform_setting(text, jsonb, uuid) TO hub_rw;
--> statement-breakpoint
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_stages_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_stages_ck CHECK (jsonb_typeof(stages) = 'array'
  AND jsonb_array_length(stages) BETWEEN 1 AND 50) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_stage_idx_ck
  CHECK (current_stage_idx BETWEEN 0 AND 49) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_step_ck;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_step_ck CHECK (current_step BETWEEN 0 AND 49) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_stage_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_stage_idx_ck CHECK (stage_idx BETWEEN 0 AND 49) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_round_ck;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_round_ck
  CHECK (round >= 1 AND (back_to_step IS NULL OR back_to_step BETWEEN 0 AND 49)) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_outputs DROP CONSTRAINT IF EXISTS process_outputs_idx_ck;
--> statement-breakpoint
ALTER TABLE hub.process_outputs ADD CONSTRAINT process_outputs_idx_ck
  CHECK (stage_idx BETWEEN 0 AND 49 AND version >= 1 AND attempt >= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE hub.process_back_events DROP CONSTRAINT IF EXISTS process_back_events_ck;
--> statement-breakpoint
ALTER TABLE hub.process_back_events ADD CONSTRAINT process_back_events_ck CHECK (from_stage_idx BETWEEN 0 AND 49
  AND to_step >= 0 AND to_step < from_step AND from_step <= 49 AND round_after >= 2
  AND char_length(feedback) BETWEEN 1 AND 4000) NOT VALID;
