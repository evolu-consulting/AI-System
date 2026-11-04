-- CR-118 §11.2 · cr118-flow-routing · nhiều quy trình mỗi tenant × khe + luật chọn quy trình theo phòng ban người khởi tạo.
-- (1) `process_tenant_defs`: tập quy trình thư viện platform_admin ĐÃ GÁN cho tenant (nhiều mỗi khe); ghi chỉ system.
-- (2) `process_routings`: đầu danh sách luật tenant × khe (`version` chống ghi đè đồng thời).
-- (3) `process_routing_rules`: luật có thứ tự (`priority` 0..49 ⇒ ≤ 50 luật), `condition` `{departmentIds: uuid[]}`, `def_id`
--     PHẢI thuộc tập đã gán (FK (tenant, slot, def) ON DELETE RESTRICT ⇒ bỏ gán quy trình đang được luật dùng bị chặn), ≤ 1 mặc định.
-- (4) RLS: đọc theo tenant (scope user đúng `app.tenant_id`) hoặc system; luật ghi được ở scope user đúng tenant (tenant admin —
--     cổng vai ở route) hoặc system. (5) audit + assign_process, unassign_process, set_routing.
-- Chỉ THÊM bảng/giá trị CHECK; không đổi bảng CR-105 (`process_slot_assignments` vẫn là đường cũ khi chưa có luật). Chạy lại vô hại.
CREATE TABLE IF NOT EXISTS hub.process_tenant_defs (
  tenant_id uuid NOT NULL,
  def_id uuid NOT NULL,
  slot text NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_tenant_defs_pkey PRIMARY KEY (tenant_id, def_id),
  CONSTRAINT process_tenant_defs_slot_uq UNIQUE (tenant_id, slot, def_id),
  CONSTRAINT process_tenant_defs_slot_ck CHECK (slot ~ '^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT process_tenant_defs_def_fk FOREIGN KEY (def_id) REFERENCES hub.process_defs (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_tenant_defs_def_idx ON hub.process_tenant_defs (def_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.process_routings (
  tenant_id uuid NOT NULL,
  slot text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_routings_pkey PRIMARY KEY (tenant_id, slot),
  CONSTRAINT process_routings_slot_ck CHECK (slot ~ '^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT process_routings_version_ck CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.process_routing_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slot text NOT NULL,
  priority integer NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  def_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  CONSTRAINT process_routing_rules_pkey PRIMARY KEY (id),
  CONSTRAINT process_routing_rules_prio_uq UNIQUE (tenant_id, slot, priority),
  CONSTRAINT process_routing_rules_prio_ck CHECK (priority BETWEEN 0 AND 49),
  CONSTRAINT process_routing_rules_cond_ck CHECK (jsonb_typeof(condition) = 'object'),
  CONSTRAINT process_routing_rules_head_fk FOREIGN KEY (tenant_id, slot)
    REFERENCES hub.process_routings (tenant_id, slot) ON DELETE CASCADE,
  CONSTRAINT process_routing_rules_def_fk FOREIGN KEY (tenant_id, slot, def_id)
    REFERENCES hub.process_tenant_defs (tenant_id, slot, def_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_routing_rules_one_default
  ON hub.process_routing_rules (tenant_id, slot) WHERE is_default;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_routing_rules_def_idx ON hub.process_routing_rules (tenant_id, slot, def_id);
--> statement-breakpoint
ALTER TABLE hub.process_tenant_defs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.process_routings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.process_routing_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_tenant_defs'
                 AND policyname = 'process_tenant_defs_select') THEN
    EXECUTE format('CREATE POLICY process_tenant_defs_select ON hub.process_tenant_defs FOR SELECT TO hub_rw USING %s', v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_tenant_defs'
                 AND policyname = 'process_tenant_defs_write') THEN
    EXECUTE format('CREATE POLICY process_tenant_defs_write ON hub.process_tenant_defs FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_routings'
                 AND policyname = 'process_routings_rw') THEN
    EXECUTE format('CREATE POLICY process_routings_rw ON hub.process_routings FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_t, v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_routing_rules'
                 AND policyname = 'process_routing_rules_rw') THEN
    EXECUTE format('CREATE POLICY process_routing_rules_rw ON hub.process_routing_rules FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_t, v_t);
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.process_tenant_defs TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.process_routings TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.process_routing_rules TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_action_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%set_routing%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (action IN (
      'grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable', 'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action', 'rotate', 'check', 'degrade', 'write_fail', 'escalate', 'escalate_skipped', 'tool_call', 'branch', 'publish', 'rollback', 'assign', 'unassign', 'set_default', 'assign_process', 'unassign_process', 'set_routing'));
  END IF;
END $$;
