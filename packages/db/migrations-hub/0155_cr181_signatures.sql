-- CR-181 · lát s1 · Chữ ký nội bộ (lõi chung): `hub.user_signatures` (mỗi người ≤ 1 bản ĐANG DÙNG / loại, bản cũ giữ lịch sử), `hub.signature_settings`
-- (thiết lập theo công ty; không có hàng ⇒ mặc định ở tầng ứng dụng), `hub.signature_change_grants` (xin đổi / cho phép đổi, dùng MỘT lần).
-- Khuôn hub 0149: bảng bật RLS KHÔNG FORCE, chỉ policy `app.scope='system'` cho hub_rw ⇒ không ai đọc/ghi bảng trực tiếp ở scope người dùng; mọi đường đi qua
-- hàm DEFINER (search_path cố định, REVOKE PUBLIC). Người dùng KHÔNG là tham số: hàm đọc `app.tenant_id`/`app.user_id` (thiếu ⇒ 42501) ⇒ chỉ đọc/ghi chữ ký của CHÍNH MÌNH.
-- `signature_for_stamp(tenant,user,kind)` cho máy chủ in (BR-K3): ảnh luôn lấy từ DB, tham số phải KHỚP `app.tenant_id`/`app.user_id` (khác ⇒ 42501) ⇒ không đọc hộ người khác.
-- Quyền «quản trị công ty» (Q15) kiểm ở API; hai hàm ghi của quản trị (`sig_settings_put`, `sig_change_grant`) ĐÒI cờ `app.sig_admin = '1'` (route chỉ đặt SET LOCAL trong cùng tx
-- SAU khi đã kiểm Q15, như `app.user_id`) — thiếu cờ ⇒ 42501, nên người dùng thường không tự ghi thiết lập / tự cấp quyền đổi. Quản trị không tự cấp cho chính mình.
-- Mã lỗi: 42501 thiếu ngữ cảnh/không khớp · 22023 đầu vào sai · P0002 SIG_USER_NOT_FOUND (cho phép đổi cho người ngoài công ty).
-- Audit: thêm action `signature_created|signature_settings_changed|signature_change_requested|signature_change_granted|document_signed` + entity `signature`.
-- Chỉ THÊM. Chạy lại được: IF NOT EXISTS / CREATE OR REPLACE; GRANT lặp vô hại.

-- ── Bảng ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Ảnh = PNG nét ĐEN nền trong suốt đã cắt sát (Q18); màu mực áp lúc in. Không xoá; đổi = retire (retired_at) + insert.
CREATE TABLE IF NOT EXISTS hub.user_signatures (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  method text NOT NULL,
  png bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT user_signatures_pkey PRIMARY KEY (id),
  CONSTRAINT user_signatures_kind_ck CHECK (kind IN ('main', 'initials')),
  CONSTRAINT user_signatures_method_ck CHECK (method IN ('draw', 'upload', 'type')),
  CONSTRAINT user_signatures_png_ck CHECK (octet_length(png) BETWEEN 1 AND 204800),
  CONSTRAINT user_signatures_retired_ck CHECK (retired_at IS NULL OR retired_at >= created_at)
);
--> statement-breakpoint
-- Một bản đang dùng / (tenant, người, loại) (BR-K1) — cũng là index cho getActive / signature_for_stamp.
CREATE UNIQUE INDEX IF NOT EXISTS user_signatures_active_uq ON hub.user_signatures (tenant_id, user_id, kind) WHERE retired_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_signatures_history_ix ON hub.user_signatures (tenant_id, user_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.signature_settings (
  tenant_id uuid NOT NULL,
  methods text[] NOT NULL DEFAULT ARRAY['draw', 'upload', 'type']::text[],
  required boolean NOT NULL DEFAULT true,
  caption text[] NOT NULL DEFAULT ARRAY['name', 'date']::text[],
  ink text NOT NULL DEFAULT 'blue',
  initials text NOT NULL DEFAULT 'shrink',
  change_policy text NOT NULL DEFAULT 'self',
  on_doc_enabled boolean NOT NULL DEFAULT false,
  digital_enabled boolean NOT NULL DEFAULT false,
  digital_provider text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signature_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT signature_settings_methods_ck CHECK (cardinality(methods) >= 1 AND methods <@ ARRAY['draw', 'upload', 'type']::text[]),
  CONSTRAINT signature_settings_caption_ck CHECK (cardinality(caption) <= 4 AND caption <@ ARRAY['name', 'title', 'date', 'time']::text[]),
  CONSTRAINT signature_settings_ink_ck CHECK (ink IN ('blue', 'black')),
  CONSTRAINT signature_settings_initials_ck CHECK (initials IN ('shrink', 'own')),
  CONSTRAINT signature_settings_policy_ck CHECK (change_policy IN ('self', 'admin')),
  CONSTRAINT signature_settings_provider_ck CHECK (digital_provider IS NULL OR char_length(digital_provider) BETWEEN 1 AND 60)
);
--> statement-breakpoint
-- Xin đổi / cho phép đổi: một hàng «mở» (chưa dùng) / (tenant, người); dùng xong (used_at) ⇒ giữ làm lịch sử, được xin lần mới.
CREATE TABLE IF NOT EXISTS hub.signature_change_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  granted_at timestamptz,
  used_at timestamptz,
  CONSTRAINT signature_change_grants_pkey PRIMARY KEY (id),
  CONSTRAINT signature_change_grants_used_ck CHECK (used_at IS NULL OR granted_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS signature_change_grants_open_uq ON hub.signature_change_grants (tenant_id, user_id) WHERE used_at IS NULL;
--> statement-breakpoint
ALTER TABLE hub.user_signatures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.signature_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.signature_change_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_signatures', 'signature_settings', 'signature_change_grants'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t AND policyname = t || '_system') THEN
      EXECUTE format($f$CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw
        USING (current_setting('app.scope', true) = 'system')
        WITH CHECK (current_setting('app.scope', true) = 'system')$f$, t || '_system', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── Hàm DEFINER ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Ngữ cảnh bắt buộc (tenant + người dùng). Hàm nội bộ, KHÔNG cấp cho ai.
CREATE OR REPLACE FUNCTION hub.sig_ctx()
RETURNS TABLE (tid uuid, uid uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'sig_ctx: chưa đặt tenant/người dùng' USING ERRCODE = '42501';
  END IF;
  tid := v_tid; uid := v_uid;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- Bản ĐANG DÙNG của tôi (0 hàng nếu chưa có). p_kind null ⇒ cả hai loại.
CREATE OR REPLACE FUNCTION hub.sig_get_active(p_kind text)
RETURNS TABLE (id uuid, kind text, method text, png bytea, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  RETURN QUERY
  SELECT s.id, s.kind, s.method, s.png, s.created_at
    FROM hub.user_signatures s
   WHERE s.tenant_id = c.tid AND s.user_id = c.uid AND s.retired_at IS NULL AND (p_kind IS NULL OR s.kind = p_kind)
   ORDER BY s.kind;
END $$;
--> statement-breakpoint
-- Lịch sử của tôi (mới → cũ), KHÔNG kèm ảnh. p_limit kẹp 1..100.
CREATE OR REPLACE FUNCTION hub.sig_history(p_kind text, p_limit integer)
RETURNS TABLE (id uuid, kind text, method text, created_at timestamptz, retired_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  RETURN QUERY
  SELECT s.id, s.kind, s.method, s.created_at, s.retired_at
    FROM hub.user_signatures s
   WHERE s.tenant_id = c.tid AND s.user_id = c.uid AND (p_kind IS NULL OR s.kind = p_kind)
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END $$;
--> statement-breakpoint
-- Tạo/đổi chữ ký: retire bản đang dùng + thêm bản mới trong CÙNG một lần gọi (BR-K1). Khoá advisory theo (tenant, người, loại) ⇒ hai lần tạo đồng thời
-- tuần tự, không đụng unique. Trả id bản mới + id bản bị thay (null nếu là bản đầu).
CREATE OR REPLACE FUNCTION hub.sig_create(p_kind text, p_method text, p_png bytea)
RETURNS TABLE (id uuid, created_at timestamptz, replaced_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_old uuid;
  v_new uuid;
  v_at timestamptz;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('main', 'initials') OR p_method IS NULL OR p_method NOT IN ('draw', 'upload', 'type')
     OR p_png IS NULL OR octet_length(p_png) NOT BETWEEN 1 AND 204800 THEN
    RAISE EXCEPTION 'sig_create: đầu vào sai' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tid::text || ':' || c.uid::text || ':' || p_kind, 181));
  UPDATE hub.user_signatures s SET retired_at = now()
   WHERE s.tenant_id = c.tid AND s.user_id = c.uid AND s.kind = p_kind AND s.retired_at IS NULL
  RETURNING s.id INTO v_old;
  INSERT INTO hub.user_signatures AS n (tenant_id, user_id, kind, method, png)
  VALUES (c.tid, c.uid, p_kind, p_method, p_png)
  RETURNING n.id, n.created_at INTO v_new, v_at;
  id := v_new; created_at := v_at; replaced_id := v_old;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- Thiết lập của công ty tôi (0 hàng ⇒ ứng dụng dùng mặc định). Mọi thành viên đọc được (cần biết cách tạo cho phép).
CREATE OR REPLACE FUNCTION hub.sig_settings_get()
RETURNS TABLE (methods text[], required boolean, caption text[], ink text, initials text, change_policy text, on_doc_enabled boolean,
               digital_enabled boolean, digital_provider text, updated_by uuid, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  RETURN QUERY
  SELECT g.methods, g.required, g.caption, g.ink, g.initials, g.change_policy, g.on_doc_enabled, g.digital_enabled, g.digital_provider,
         g.updated_by, g.updated_at
    FROM hub.signature_settings g WHERE g.tenant_id = c.tid;
END $$;
--> statement-breakpoint
-- Ghi thiết lập (upsert). CHECK của bảng chặn giá trị sai (23514). Đòi `app.sig_admin = '1'` (42501).
CREATE OR REPLACE FUNCTION hub.sig_settings_put(p_methods text[], p_required boolean, p_caption text[], p_ink text, p_initials text,
  p_change_policy text, p_on_doc_enabled boolean, p_digital_enabled boolean, p_digital_provider text)
RETURNS TABLE (methods text[], required boolean, caption text[], ink text, initials text, change_policy text, on_doc_enabled boolean,
               digital_enabled boolean, digital_provider text, updated_by uuid, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF COALESCE(current_setting('app.sig_admin', true), '') <> '1' THEN
    RAISE EXCEPTION 'sig_settings_put: cần quyền quản trị công ty' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO hub.signature_settings AS g (tenant_id, methods, required, caption, ink, initials, change_policy, on_doc_enabled,
                                           digital_enabled, digital_provider, updated_by, updated_at)
  VALUES (c.tid, p_methods, p_required, p_caption, p_ink, p_initials, p_change_policy, p_on_doc_enabled, p_digital_enabled,
          p_digital_provider, c.uid, now())
  ON CONFLICT (tenant_id) DO UPDATE SET methods = EXCLUDED.methods, required = EXCLUDED.required, caption = EXCLUDED.caption,
    ink = EXCLUDED.ink, initials = EXCLUDED.initials, change_policy = EXCLUDED.change_policy, on_doc_enabled = EXCLUDED.on_doc_enabled,
    digital_enabled = EXCLUDED.digital_enabled, digital_provider = EXCLUDED.digital_provider, updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING g.methods, g.required, g.caption, g.ink, g.initials, g.change_policy, g.on_doc_enabled, g.digital_enabled, g.digital_provider,
            g.updated_by, g.updated_at;
END $$;
--> statement-breakpoint
-- Hàng xin/cho phép đang mở của TÔI (0 hàng = chưa xin).
CREATE OR REPLACE FUNCTION hub.sig_change_state()
RETURNS TABLE (id uuid, requested_at timestamptz, granted_at timestamptz, granted_by uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  RETURN QUERY
  SELECT g.id, g.requested_at, g.granted_at, g.granted_by
    FROM hub.signature_change_grants g WHERE g.tenant_id = c.tid AND g.user_id = c.uid AND g.used_at IS NULL;
END $$;
--> statement-breakpoint
-- Tôi xin đổi chữ ký. Đã có hàng mở ⇒ giữ nguyên (fresh=false) để API không báo chuông lần hai.
CREATE OR REPLACE FUNCTION hub.sig_change_request()
RETURNS TABLE (id uuid, requested_at timestamptz, granted_at timestamptz, fresh boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  RETURN QUERY
  INSERT INTO hub.signature_change_grants AS g (tenant_id, user_id) VALUES (c.tid, c.uid)
  ON CONFLICT (tenant_id, user_id) WHERE used_at IS NULL DO UPDATE SET requested_at = g.requested_at
  RETURNING g.id, g.requested_at, g.granted_at, (xmax = 0);
END $$;
--> statement-breakpoint
-- Quản trị cho phép người p_user đổi (một lần). Chưa có yêu cầu ⇒ tạo luôn hàng đã cho phép. Đã cho phép từ trước ⇒ giữ mốc cũ (fresh=false; fresh = mốc cho phép là «bây giờ» của giao dịch).
-- Đòi `app.sig_admin = '1'` (42501); p_user = chính mình ⇒ 42501 (quản trị không tự cấp). Người ngoài công ty ⇒ P0002.
CREATE OR REPLACE FUNCTION hub.sig_change_grant(p_user uuid)
RETURNS TABLE (id uuid, requested_at timestamptz, granted_at timestamptz, fresh boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF COALESCE(current_setting('app.sig_admin', true), '') <> '1' THEN
    RAISE EXCEPTION 'sig_change_grant: cần quyền quản trị công ty' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NOT DISTINCT FROM c.uid THEN
    RAISE EXCEPTION 'sig_change_grant: không tự cấp cho chính mình' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM admin.users u WHERE u.id = p_user AND u.tenant_id = c.tid) THEN
    RAISE EXCEPTION 'SIG_USER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  INSERT INTO hub.signature_change_grants AS g (tenant_id, user_id, granted_by, granted_at) VALUES (c.tid, p_user, c.uid, now())
  ON CONFLICT (tenant_id, user_id) WHERE used_at IS NULL DO UPDATE
    SET granted_by = COALESCE(g.granted_by, EXCLUDED.granted_by), granted_at = COALESCE(g.granted_at, EXCLUDED.granted_at)
  RETURNING g.id, g.requested_at, g.granted_at, (g.granted_at = now());
END $$;
--> statement-breakpoint
-- Dùng quyền đổi của TÔI: true nếu có hàng đã cho phép chưa dùng (đánh dấu used_at, nguyên tử ⇒ hai lần gọi chỉ một lần true).
CREATE OR REPLACE FUNCTION hub.sig_change_consume()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  UPDATE hub.signature_change_grants g SET used_at = now()
   WHERE g.tenant_id = c.tid AND g.user_id = c.uid AND g.used_at IS NULL AND g.granted_at IS NOT NULL
  RETURNING g.id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;
--> statement-breakpoint
-- Máy chủ in (BR-K3): ảnh chữ ký ĐANG DÙNG của (tenant, người, loại). Tham số phải khớp ngữ cảnh ⇒ không đọc hộ người khác.
CREATE OR REPLACE FUNCTION hub.signature_for_stamp(p_tenant uuid, p_user uuid, p_kind text)
RETURNS TABLE (id uuid, method text, png bytea, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF p_tenant IS DISTINCT FROM c.tid OR p_user IS DISTINCT FROM c.uid THEN
    RAISE EXCEPTION 'signature_for_stamp: tham số không khớp ngữ cảnh' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.method, s.png, s.created_at
    FROM hub.user_signatures s
   WHERE s.tenant_id = p_tenant AND s.user_id = p_user AND s.kind = p_kind AND s.retired_at IS NULL;
END $$;
--> statement-breakpoint

-- ── audit_log: thêm action + entity (danh sách 0087 / 0071 + mới) ──────────────────────────────────────────────────────────
-- Bảng có thể lớn: ADD … NOT VALID (khoá ngắn) rồi VALIDATE ở statement riêng; chờ khoá tối đa 5s (khuôn 0070/0084).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_action_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%document_signed%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (action IN (
      'grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable', 'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action', 'rotate', 'check', 'degrade', 'write_fail', 'escalate', 'escalate_skipped', 'tool_call', 'branch', 'publish', 'rollback', 'assign', 'unassign', 'set_default', 'assign_process', 'unassign_process', 'set_routing',
      'signature_created', 'signature_settings_changed', 'signature_change_requested', 'signature_change_granted', 'document_signed')) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.audit_log VALIDATE CONSTRAINT hub_audit_log_action_check;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_entity_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%''signature''%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
      entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default',
        'process_def', 'process_run', 'review_task', 'agent_team', 'secret', 'kh_connection', 'kh_query', 'kh_worklog',
        'provider', 'model_profile', 'dlc_step_template', 'signature')) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.audit_log VALIDATE CONSTRAINT hub_audit_log_entity_check;
--> statement-breakpoint

-- ── Quyền ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION hub.sig_ctx(), hub.sig_get_active(text), hub.sig_history(text, integer), hub.sig_create(text, text, bytea),
  hub.sig_settings_get(), hub.sig_settings_put(text[], boolean, text[], text, text, text, boolean, boolean, text),
  hub.sig_change_state(), hub.sig_change_request(), hub.sig_change_grant(uuid), hub.sig_change_consume(),
  hub.signature_for_stamp(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
-- Bảng KHÔNG cấp quyền cho hub_rw: mọi đường đi qua hàm DEFINER (chủ hàm bỏ qua RLS); policy `system` giữ làm lớp phòng thủ.
GRANT EXECUTE ON FUNCTION hub.sig_get_active(text), hub.sig_history(text, integer), hub.sig_create(text, text, bytea),
  hub.sig_settings_get(), hub.sig_settings_put(text[], boolean, text[], text, text, text, boolean, boolean, text),
  hub.sig_change_state(), hub.sig_change_request(), hub.sig_change_grant(uuid), hub.sig_change_consume(),
  hub.signature_for_stamp(uuid, uuid, text) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.sig_get_active(text), hub.signature_for_stamp(uuid, uuid, text) TO contracts_rw;
  END IF;
END $$;
