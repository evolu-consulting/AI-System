-- CR-122 · E1 · ADR-0038 · FLOW2-FR-03/05/07/20 · danh sách flow của công ty + trigger trên def + cờ FLOW_TRIGGERS.
-- (1) `process_defs.trigger` = `FlowDef.trigger {event, when?}` (một nguồn: trên def); `trigger_event` sinh từ đó để chọn flow
--     bằng index. NULL = def cũ (khe / chạy thử) — bộ điều phối bỏ qua.
-- (2) `company_flows` (tenant, flow, enabled, replaced_by, position, off_reason) = nguồn duy nhất "công ty có flow nào, đang bật
--     không" (thay process_tenant_defs + routings + rules + slots ở R1). `flow_id` trỏ def Thư viện (được gán) hoặc def công ty.
-- (3) `tenant_flow_settings.flow_triggers` (mặc định false = bóng: bộ điều phối chỉ ghi "lẽ ra chạy", không mở lượt — readiness #3).
-- (4) RLS: đọc/ghi theo tenant (scope user đúng `app.tenant_id`) hoặc system; cờ chỉ system ghi. Chạy lại vô hại.
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS trigger jsonb;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS app text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_defs_app_ck') THEN
    ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_app_ck CHECK (app IS NULL OR app ~ '^[a-z0-9-]{2,32}$');
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS trigger_event text
  GENERATED ALWAYS AS (trigger ->> 'event') STORED;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_defs_trigger_ck') THEN
    ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_trigger_ck CHECK (trigger IS NULL OR (
      jsonb_typeof(trigger) = 'object' AND (trigger ->> 'event') ~ '^[a-z][a-z0-9_-]{0,39}\.[a-z][a-z0-9_-]{0,39}$'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_defs_trigger_event_idx ON hub.process_defs (trigger_event)
  WHERE trigger_event IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.company_flows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  replaced_by uuid,
  off_reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_flows_pkey PRIMARY KEY (id),
  CONSTRAINT company_flows_flow_uq UNIQUE (tenant_id, flow_id),
  CONSTRAINT company_flows_flow_fk FOREIGN KEY (flow_id) REFERENCES hub.process_defs (id) ON DELETE RESTRICT,
  CONSTRAINT company_flows_replaced_fk FOREIGN KEY (replaced_by) REFERENCES hub.company_flows (id) ON DELETE SET NULL,
  CONSTRAINT company_flows_position_ck CHECK (position BETWEEN 0 AND 999),
  CONSTRAINT company_flows_off_reason_ck CHECK (off_reason IS NULL OR off_reason IN
    ('replaced', 'reverted', 'turned_off', 'not_published')),
  CONSTRAINT company_flows_replaced_off_ck CHECK (replaced_by IS NULL OR NOT enabled)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS company_flows_enabled_idx ON hub.company_flows (tenant_id, position) WHERE enabled;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS company_flows_flow_idx ON hub.company_flows (flow_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.tenant_flow_settings (
  tenant_id uuid NOT NULL,
  flow_triggers boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_flow_settings_pkey PRIMARY KEY (tenant_id)
);
--> statement-breakpoint
ALTER TABLE hub.company_flows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.tenant_flow_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'company_flows'
                 AND policyname = 'company_flows_rw') THEN
    EXECUTE format('CREATE POLICY company_flows_rw ON hub.company_flows FOR ALL TO hub_rw USING %s WITH CHECK %s', v_t, v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'tenant_flow_settings'
                 AND policyname = 'tenant_flow_settings_select') THEN
    EXECUTE format('CREATE POLICY tenant_flow_settings_select ON hub.tenant_flow_settings FOR SELECT TO hub_rw USING %s', v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'tenant_flow_settings'
                 AND policyname = 'tenant_flow_settings_write') THEN
    EXECUTE format('CREATE POLICY tenant_flow_settings_write ON hub.tenant_flow_settings FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.company_flows TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.tenant_flow_settings TO hub_rw;
