-- CR-182 · lát cr182-roles · giao việc theo VAI: `hub.process_role_assignments` (công ty giao NHÓM hoặc MỘT NGƯỜI cho từng vai của một quy trình).
-- Khoá = (tenant_id, flow_id, role_key): `flow_id` = `hub.process_defs.id` (cùng khoá `hub.company_flows.flow_id`; def Thư viện hay def công ty đều được);
-- một vai dùng ở nhiều bước ⇒ MỘT hàng. CHECK đúng một trong `group_id` / `user_id`; bỏ giao = xoá hàng.
-- RLS khuôn `company_flows` (0106): ĐỌC theo tenant (scope user đúng `app.tenant_id`) hoặc system; KHÔNG policy ghi cho scope user và KHÔNG GRANT ghi cho hub_rw
-- ⇒ mọi ghi đi qua hàm DEFINER `hub.role_assign`, hàm ĐÒI cờ `app.company_admin = '1'` (route chỉ đặt SET LOCAL trong cùng tx SAU khi đã kiểm Q15 «quản trị công ty»,
-- như `app.sig_admin` của 0155). Đặt tên chung `company_admin` (không `sig_admin`) vì cờ là «quản trị công ty», dùng lại được cho các hàm ghi quản trị khác.
-- Hàm đọc tenant/người từ `app.tenant_id`/`app.user_id` (`hub.sig_ctx`, 0155; thiếu ⇒ 42501) — người dùng KHÔNG là tham số.
-- Mã lỗi: 42501 thiếu ngữ cảnh/cờ · 22023 đầu vào sai (cả hai đích / nhóm hoặc người không thuộc công ty / người bị khoá) · P0002 quy trình không thấy.
-- Audit: thêm action `role_assigned` (entity dùng `process_def` có sẵn; ghi ở tầng ứng dụng, cùng tx).
-- Chỉ THÊM. Chạy lại được: IF NOT EXISTS / CREATE OR REPLACE; GRANT lặp vô hại.

CREATE TABLE IF NOT EXISTS hub.process_role_assignments (
  tenant_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  role_key text NOT NULL,
  group_id uuid,
  user_id uuid,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_role_assignments_pkey PRIMARY KEY (tenant_id, flow_id, role_key),
  CONSTRAINT process_role_assignments_flow_fk FOREIGN KEY (flow_id) REFERENCES hub.process_defs (id) ON DELETE CASCADE,
  CONSTRAINT process_role_assignments_key_ck CHECK (role_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  CONSTRAINT process_role_assignments_one_ck CHECK ((group_id IS NULL) <> (user_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE hub.process_role_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_role_assignments'
                 AND policyname = 'process_role_assignments_select') THEN
    EXECUTE format('CREATE POLICY process_role_assignments_select ON hub.process_role_assignments FOR SELECT TO hub_rw USING %s', v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_role_assignments'
                 AND policyname = 'process_role_assignments_system_write') THEN
    EXECUTE format('CREATE POLICY process_role_assignments_system_write ON hub.process_role_assignments FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
END $$;
--> statement-breakpoint
-- Chỉ đọc cho hub_rw; ghi (scope user) chỉ qua hàm DEFINER. (Scope system có policy ghi nhưng không có GRANT ghi ⇒ cũng phải qua hàm.)
GRANT SELECT ON hub.process_role_assignments TO hub_rw;
--> statement-breakpoint

-- ── Hàm ghi của quản trị công ty ───────────────────────────────────────────────────────────────────────────────────────────
-- Giao / đổi / bỏ giao MỘT vai (p_group xor p_user; cả hai null ⇒ bỏ giao). Trả giá trị TRƯỚC và SAU để ghi audit (BR-G3).
-- Khoá advisory theo (tenant, flow, vai) ⇒ hai quản trị cùng đổi một vai nối tiếp nhau, `before` luôn đúng.
CREATE OR REPLACE FUNCTION hub.role_assign(p_flow uuid, p_role text, p_group uuid, p_user uuid)
RETURNS TABLE (before_group uuid, before_user uuid, after_group uuid, after_user uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  b record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF COALESCE(current_setting('app.company_admin', true), '') <> '1' THEN
    RAISE EXCEPTION 'role_assign: cần quyền quản trị công ty' USING ERRCODE = '42501';
  END IF;
  IF p_group IS NOT NULL AND p_user IS NOT NULL THEN
    RAISE EXCEPTION 'role_assign: chỉ một trong nhóm hoặc người' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL OR p_role !~ '^[a-z0-9][a-z0-9-]{0,39}$' THEN
    RAISE EXCEPTION 'role_assign: khoá vai sai' USING ERRCODE = '22023';
  END IF;
  -- Quy trình của công ty này hoặc của Thư viện (tenant_id null), chưa xoá.
  IF NOT EXISTS (SELECT 1 FROM hub.process_defs d WHERE d.id = p_flow AND d.deleted_at IS NULL
                 AND (d.tenant_id = c.tid OR d.tenant_id IS NULL)) THEN
    RAISE EXCEPTION 'role_assign: không thấy quy trình' USING ERRCODE = 'P0002';
  END IF;
  IF p_group IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admin.groups g WHERE g.id = p_group AND g.tenant_id = c.tid) THEN
    RAISE EXCEPTION 'role_assign: nhóm không thuộc công ty' USING ERRCODE = '22023';
  END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admin.users u WHERE u.id = p_user AND u.tenant_id = c.tid
                                          AND u.kind = 'internal' AND u.active AND NOT u.locked_by_tenant) THEN
    RAISE EXCEPTION 'role_assign: người không dùng được ở công ty' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tid::text || ':' || p_flow::text || ':' || p_role, 182));
  SELECT a.group_id, a.user_id INTO b FROM hub.process_role_assignments a
   WHERE a.tenant_id = c.tid AND a.flow_id = p_flow AND a.role_key = p_role;
  before_group := b.group_id; before_user := b.user_id;
  IF p_group IS NULL AND p_user IS NULL THEN
    DELETE FROM hub.process_role_assignments a WHERE a.tenant_id = c.tid AND a.flow_id = p_flow AND a.role_key = p_role;
  ELSE
    INSERT INTO hub.process_role_assignments AS a (tenant_id, flow_id, role_key, group_id, user_id, updated_by, updated_at)
    VALUES (c.tid, p_flow, p_role, p_group, p_user, c.uid, now())
    ON CONFLICT (tenant_id, flow_id, role_key) DO UPDATE SET group_id = EXCLUDED.group_id, user_id = EXCLUDED.user_id,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  END IF;
  after_group := p_group; after_user := p_user;
  RETURN NEXT;
END $$;
--> statement-breakpoint

-- ── audit_log: thêm action `role_assigned` (danh sách 0155 + mới) ───────────────────────────────────────────────────────────
-- Bảng có thể lớn: ADD … NOT VALID (khoá ngắn) rồi VALIDATE ở statement riêng; chờ khoá tối đa 5s (khuôn 0070/0084/0155).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_action_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%role_assigned%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (action IN (
      'grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable', 'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action', 'rotate', 'check', 'degrade', 'write_fail', 'escalate', 'escalate_skipped', 'tool_call', 'branch', 'publish', 'rollback', 'assign', 'unassign', 'set_default', 'assign_process', 'unassign_process', 'set_routing',
      'signature_created', 'signature_settings_changed', 'signature_change_requested', 'signature_change_granted', 'document_signed',
      'role_assigned')) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.audit_log VALIDATE CONSTRAINT hub_audit_log_action_check;
--> statement-breakpoint

-- ── Quyền ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION hub.role_assign(uuid, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.role_assign(uuid, text, uuid, uuid) TO hub_rw;
