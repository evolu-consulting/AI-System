-- CR-105 · L1 pl-slot-core · thư viện quy trình + gán tenant × khe (design.md §1, §8; readiness Chặn 1 + Cao).
-- (1) `process_defs`: `slot` (khe app; chỉ def thư viện `tenant_id NULL`), `slot_body` (dạng Form của khe, Group theo MÃ),
--     `published_version` (NULL = chưa xuất bản), `source_ref` (def tenant vật chất hoá: sha256-16 của def đã biên dịch).
-- (2) `process_runs.is_test` (lượt chạy thử từ "Mẫu · chạy thử").
-- (3) `process_def_releases` bất biến (REVOKE UPDATE/DELETE), `process_slots` (một mặc định mỗi khe),
--     `process_slot_assignments` PK (tenant, slot) — FK def ON DELETE RESTRICT, index (def_id).
-- (4) RLS: assignments đọc theo tenant (ghi chỉ system); releases/slots chỉ system; thu hẹp `process_defs_select` scope user
--     về `tenant_id NULL AND slot IS NULL` (mẫu chạy thử) hoặc def của tenant — def thư viện chỉ scope system (platform_admin).
-- Chỉ THÊM cột/bảng + thay một policy; không mất dữ liệu; chạy lại vô hại.
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS slot text;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS slot_body jsonb;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS published_version integer;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS source_ref text;
--> statement-breakpoint
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_slot_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_slot_ck CHECK (
  slot IS NULL OR (slot ~ '^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$' AND tenant_id IS NULL));
--> statement-breakpoint
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_published_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_published_ck CHECK (
  published_version IS NULL OR (published_version >= 1 AND slot IS NOT NULL));
--> statement-breakpoint
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_source_ref_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_source_ref_ck CHECK (
  source_ref IS NULL OR (tenant_id IS NOT NULL AND source_ref ~ '^[0-9a-f]{16}$'));
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.process_def_releases (
  def_id uuid NOT NULL,
  rel_version integer NOT NULL,
  name text NOT NULL,
  stages jsonb NOT NULL,
  slot_body jsonb,
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',
  CONSTRAINT process_def_releases_pkey PRIMARY KEY (def_id, rel_version),
  CONSTRAINT process_def_releases_version_ck CHECK (rel_version >= 1),
  CONSTRAINT process_def_releases_def_fk FOREIGN KEY (def_id) REFERENCES hub.process_defs (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.process_slots (
  slot text PRIMARY KEY,
  default_def_id uuid NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_slots_slot_ck CHECK (slot ~ '^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT process_slots_def_fk FOREIGN KEY (default_def_id) REFERENCES hub.process_defs (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_slots_def_idx ON hub.process_slots (default_def_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.process_slot_assignments (
  tenant_id uuid NOT NULL,
  slot text NOT NULL,
  def_id uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_slot_assignments_pkey PRIMARY KEY (tenant_id, slot),
  CONSTRAINT process_slot_assignments_slot_ck CHECK (slot ~ '^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT process_slot_assignments_def_fk FOREIGN KEY (def_id) REFERENCES hub.process_defs (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_slot_assignments_def_idx ON hub.process_slot_assignments (def_id);
--> statement-breakpoint
ALTER TABLE hub.process_def_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.process_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.process_slot_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
BEGIN
  -- assignments: tenant chỉ ĐỌC hàng của mình; ghi chỉ system (route platform_admin + withConfigWrite).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_slot_assignments'
                 AND policyname = 'process_slot_assignments_select') THEN
    EXECUTE format('CREATE POLICY process_slot_assignments_select ON hub.process_slot_assignments FOR SELECT TO hub_rw'
      || ' USING %s', v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_slot_assignments'
                 AND policyname = 'process_slot_assignments_write') THEN
    EXECUTE format('CREATE POLICY process_slot_assignments_write ON hub.process_slot_assignments FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
  -- releases / slots: không cột tenant ⇒ chỉ system (tenant đọc gián tiếp qua resolveSlot của gói).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_def_releases'
                 AND policyname = 'process_def_releases_sys') THEN
    EXECUTE format('CREATE POLICY process_def_releases_sys ON hub.process_def_releases FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_slots'
                 AND policyname = 'process_slots_sys') THEN
    EXECUTE format('CREATE POLICY process_slots_sys ON hub.process_slots FOR ALL TO hub_rw USING %s WITH CHECK %s',
      v_sys, v_sys);
  END IF;
END $$;
--> statement-breakpoint
-- Chặn 1 (readiness): scope user chỉ thấy mẫu chạy thử (`slot IS NULL`) + def của tenant mình; def thư viện chỉ scope system.
DROP POLICY IF EXISTS process_defs_select ON hub.process_defs;
--> statement-breakpoint
CREATE POLICY process_defs_select ON hub.process_defs FOR SELECT TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND ((tenant_id IS NULL AND slot IS NULL)
                  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)));
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.process_def_releases TO hub_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON hub.process_def_releases FROM hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.process_slots TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.process_slot_assignments TO hub_rw;
