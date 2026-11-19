-- CR-191 · lát cr191-partner-connect · BR-191-9/10/11. CHỈ THÊM / thay thân hàm 0145, chạy lại được.
-- (1) «Ai được mời» theo cài đặt công ty (`contracts.connect_settings`, contracts 0129; vắng = `admin`) thay cho ràng buộc cứng «Toàn quyền» của `cc_invite`:
--     `admin` ⇒ chỉ người Toàn quyền (như cũ); `all` ⇒ mọi nhân viên nội bộ đang dùng. Không mở thêm ai ngoài công ty.
-- (2) `cc_search`: người được phép tìm cả công ty chưa kết nối đã bật «cho tìm thấy»; người khác CHỈ thấy công ty đã kết nối (không lộ danh bạ).
-- (3) Từ chối kèm lý do (`connect_decline_reason`, ≤ 300), thu hồi lời mời đã gửi, trang công ty (chỉ công ty đã kết nối, hoặc đang bật «cho tìm thấy» và người xem được phép).
-- Hàm đọc bảng gói contracts bằng plpgsql (liên kết muộn, có `to_regclass`) vì hub dựng TRƯỚC schema contracts trên DB sạch.
ALTER TABLE hub.partner_links ADD COLUMN IF NOT EXISTS connect_decline_reason text;
--> statement-breakpoint
ALTER TABLE hub.partner_links DROP CONSTRAINT IF EXISTS partner_links_decline_reason_ck;
--> statement-breakpoint
ALTER TABLE hub.partner_links ADD CONSTRAINT partner_links_decline_reason_ck
  CHECK (connect_decline_reason IS NULL OR char_length(connect_decline_reason) <= 300);
--> statement-breakpoint
-- Nội bộ: cài đặt của công ty ĐANG thao tác (chỉ đọc đúng hàng của `app.tenant_id` ⇒ RLS bảng gói luôn cho qua).
CREATE OR REPLACE FUNCTION hub.cc_invite_mode_of(p_tenant uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN 'admin';
  END IF;
  IF to_regclass('contracts.connect_settings') IS NULL THEN
    RETURN 'admin';
  END IF;
  SELECT s.invite_by INTO v FROM contracts.connect_settings s WHERE s.tenant_id = p_tenant;
  RETURN COALESCE(v, 'admin');
END $$;
--> statement-breakpoint
-- Người p_user có được tìm/mời đối tác mới không (công ty đang thao tác). Người dùng ngoài/khoá/ngưng ⇒ false.
CREATE OR REPLACE FUNCTION hub.cc_can_invite(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_can_invite: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL THEN
    RETURN false;
  END IF;
  IF hub.cc_invite_mode_of(v_tid) = 'all' THEN
    RETURN EXISTS (SELECT 1 FROM admin.users u
                    WHERE u.id = p_user AND u.tenant_id = v_tid AND u.active AND NOT u.locked_by_tenant AND u.kind = 'internal');
  END IF;
  RETURN EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY[v_tid]) w WHERE w.user_id = p_user);
END $$;
--> statement-breakpoint
-- R2 + BR-191-9 · cùng cột trả về như 0145. Người được phép: công ty đã bật «cho tìm thấy» (mọi trạng thái) + công ty đã kết nối; người khác: chỉ đã kết nối.
CREATE OR REPLACE FUNCTION hub.cc_search(p_q text)
RETURNS TABLE (tenant_id uuid, legal_name text, tax_code text, verified boolean, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_q text := btrim(COALESCE(p_q, ''));
  v_tax text;
  v_can boolean;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_search: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF v_q ~ '^[0-9]{10}(-?[0-9]{3})?$' THEN
    v_tax := CASE WHEN char_length(v_q) = 13 THEN substr(v_q, 1, 10) || '-' || substr(v_q, 11) ELSE v_q END;
  ELSIF char_length(v_q) < 3 THEN
    RETURN;
  END IF;
  v_can := hub.cc_can_invite(NULLIF(current_setting('app.user_id', true), '')::uuid);
  RETURN QUERY
  SELECT x.id, x.legal_name, x.tax_code, x.verified, x.st
    FROM (
      SELECT t.id, t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL AS verified, t.directory_listed,
             hub.cc_status_of(o.requested_at, o.accepted_at, o.blocked_at, o.connect_requested_at,
                              i.accepted_at, i.blocked_at, i.connect_requested_at) AS st
        FROM admin.tenants t
        LEFT JOIN hub.partner_links o ON o.from_tenant = v_tid AND o.to_tenant = t.id
        LEFT JOIN hub.partner_links i ON i.from_tenant = t.id AND i.to_tenant = v_tid
       WHERE t.active AND t.legal_name IS NOT NULL AND t.id <> v_tid
         AND (CASE WHEN v_tax IS NOT NULL THEN t.tax_code = v_tax
                   ELSE t.legal_name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' END)
    ) x
   WHERE x.st = 'connected' OR (v_can AND x.directory_listed)
   ORDER BY x.verified DESC, x.legal_name, x.id
   LIMIT 20;
END $$;
--> statement-breakpoint
-- R3 · như 0145, chỉ đổi dòng kiểm quyền người mời: theo cài đặt công ty (cc_can_invite) thay cho «chỉ Toàn quyền».
CREATE OR REPLACE FUNCTION hub.cc_invite(p_to uuid, p_note text, p_user uuid, p_user_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_name text := left(btrim(COALESCE(p_user_name, '')), 200);
  v_my text;
  o hub.partner_links;
  i hub.partner_links;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_invite: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_to IS NULL OR p_to = v_tid THEN
    RAISE EXCEPTION 'cc_invite: công ty nhận không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'cc_invite: lời nhắn quá 500 ký tự' USING ERRCODE = '22023';
  END IF;
  IF NOT hub.cc_can_invite(p_user) THEN
    RAISE EXCEPTION 'cc_invite: người này không được mời kết nối (cài đặt công ty)' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.tenants t WHERE t.id = p_to AND t.active AND t.directory_listed) THEN
    RAISE EXCEPTION 'CONNECT_NOT_LISTED' USING ERRCODE = 'CC422';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_to::text) || greatest(v_tid::text, p_to::text), 161));
  SELECT * INTO o FROM hub.partner_links l WHERE l.from_tenant = v_tid AND l.to_tenant = p_to;
  SELECT * INTO i FROM hub.partner_links l WHERE l.from_tenant = p_to AND l.to_tenant = v_tid;
  v_my := hub.cc_status_of(o.requested_at, o.accepted_at, o.blocked_at, o.connect_requested_at,
                           i.accepted_at, i.blocked_at, i.connect_requested_at);
  IF v_my = 'connected' THEN
    RETURN 'connected';
  END IF;
  IF o.blocked_at IS NOT NULL THEN
    IF o.requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'CONNECT_DECLINED' USING ERRCODE = 'CC409';
    END IF;
    RETURN 'pending_out';
  END IF;
  IF v_my = 'pending_out' THEN
    RETURN 'pending_out';
  END IF;
  IF v_my = 'pending_in' THEN
    PERFORM hub.cc_do_accept(p_to, v_tid);
    PERFORM hub.cc_bell(p_to, CASE WHEN EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY[p_to]) w WHERE w.user_id = i.connect_by)
                                   THEN ARRAY[i.connect_by] END, 'cc.accepted',
      (SELECT COALESCE(t.legal_name, t.name) FROM admin.tenants t WHERE t.id = v_tid) || ' đã đồng ý kết nối', '',
      '/contracts/partners?party=' || hub.cc_urlenc((SELECT COALESCE(t.legal_name, t.name) FROM admin.tenants t WHERE t.id = v_tid))
        || '&tenant=' || v_tid || '&tab=chat',
      'cc.accepted:' || v_tid || ':' || floor(extract(epoch FROM now()))::bigint);
    RETURN 'connected';
  END IF;
  INSERT INTO hub.partner_links AS l (from_tenant, to_tenant, requested_at, connect_requested_at, connect_note, connect_by, connect_by_name)
  VALUES (v_tid, p_to, now(), now(), v_note, p_user, NULLIF(v_name, ''))
  ON CONFLICT (from_tenant, to_tenant) DO UPDATE
    SET requested_at = COALESCE(l.requested_at, now()), connect_requested_at = now(), connect_note = EXCLUDED.connect_note,
        connect_by = EXCLUDED.connect_by, connect_by_name = EXCLUDED.connect_by_name;
  UPDATE hub.partner_links l SET blocked_at = NULL, connect_decline_reason = NULL
   WHERE l.from_tenant = p_to AND l.to_tenant = v_tid AND l.blocked_at IS NOT NULL;
  PERFORM hub.cc_bell(p_to, NULL, 'cc.invite',
    (SELECT COALESCE(t.legal_name, t.name) FROM admin.tenants t WHERE t.id = v_tid) || ' muốn kết nối với bạn', COALESCE(v_note, ''),
    '/contracts/partners?invites=1', 'cc.invite:' || v_tid || ':' || floor(extract(epoch FROM now()))::bigint);
  RETURN 'pending_out';
END $$;
--> statement-breakpoint
-- BR-191-10 · từ chối (= chặn có sẵn của `partner_link_block`) + ghi lý do (≤ 300) trên dòng bị chặn. Không báo bên mời (Q3 CR-161). Trả true khi có đổi.
CREATE OR REPLACE FUNCTION hub.cc_decline(p_from uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ok boolean;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_decline: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'cc_decline: lý do quá 300 ký tự' USING ERRCODE = '22023';
  END IF;
  v_ok := hub.partner_link_block(p_from);
  IF v_ok THEN
    UPDATE hub.partner_links l SET connect_decline_reason = v_reason
     WHERE l.from_tenant = p_from AND l.to_tenant = v_tid AND l.blocked_at IS NOT NULL;
  END IF;
  RETURN v_ok;
END $$;
--> statement-breakpoint
-- BR-191-10 · thu hồi lời mời ĐÃ GỬI (chỉ khi còn chờ). Xoá dòng nếu dòng chỉ sinh từ lời mời; còn thư giữ ở hộp thư thì chỉ gỡ phần «kết nối».
CREATE OR REPLACE FUNCTION hub.cc_withdraw(p_to uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_n integer;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_withdraw: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_to IS NULL OR p_to = v_tid THEN
    RAISE EXCEPTION 'cc_withdraw: công ty không hợp lệ' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_to::text) || greatest(v_tid::text, p_to::text), 161));
  DELETE FROM hub.partner_links l
   WHERE l.from_tenant = v_tid AND l.to_tenant = p_to AND l.connect_requested_at IS NOT NULL
     AND l.accepted_at IS NULL AND l.blocked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM hub.partner_mailbox m WHERE m.from_tenant = l.from_tenant AND m.to_tenant = l.to_tenant);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    UPDATE hub.partner_links l
       SET connect_requested_at = NULL, connect_note = NULL, connect_by = NULL, connect_by_name = NULL
     WHERE l.from_tenant = v_tid AND l.to_tenant = p_to AND l.connect_requested_at IS NOT NULL
       AND l.accepted_at IS NULL AND l.blocked_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
-- BR-191-9 · «trang công ty» (không có bài): công ty đã kết nối, hoặc công ty đang bật «cho tìm thấy» khi người xem được phép tìm/mời.
-- Chỉ trả hồ sơ công khai tối thiểu (tên pháp lý, MST, dấu xác minh, địa chỉ, ảnh bìa). Ảnh bìa đọc từ `contracts.company_settings.cover` (CR-192 sở hữu; chỉ đọc);
-- không đọc được ⇒ null ⇒ UI dùng bìa mặc định.
CREATE OR REPLACE FUNCTION hub.cc_company_page(p_tenant uuid)
RETURNS TABLE (tenant_id uuid, legal_name text, tax_code text, verified boolean, address text, status text, cover text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_can boolean;
  r record;
  v_cover text;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_company_page: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_tenant IS NULL OR p_tenant = v_tid THEN
    RETURN;
  END IF;
  v_can := hub.cc_can_invite(NULLIF(current_setting('app.user_id', true), '')::uuid);
  SELECT x.id, x.legal_name, x.tax_code, x.verified, x.address, x.st INTO r
    FROM (
      SELECT t.id, t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL AS verified, t.address, t.directory_listed,
             hub.cc_status_of(o.requested_at, o.accepted_at, o.blocked_at, o.connect_requested_at,
                              i.accepted_at, i.blocked_at, i.connect_requested_at) AS st
        FROM admin.tenants t
        LEFT JOIN hub.partner_links o ON o.from_tenant = v_tid AND o.to_tenant = t.id
        LEFT JOIN hub.partner_links i ON i.from_tenant = t.id AND i.to_tenant = v_tid
       WHERE t.id = p_tenant AND t.active AND t.legal_name IS NOT NULL
    ) x
   WHERE x.st = 'connected' OR (v_can AND x.directory_listed);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Bảng gói contracts có thể chưa có trên DB dựng sạch ⇒ kiểm `to_regclass`, đọc bằng EXECUTE (không gắn chặt lúc dựng hàm).
  IF to_regclass('contracts.company_settings') IS NOT NULL THEN
    EXECUTE 'SELECT cs.cover FROM contracts.company_settings cs WHERE cs.tenant_id = $1' INTO v_cover USING p_tenant;
  END IF;
  RETURN QUERY SELECT r.id, r.legal_name, r.tax_code, r.verified, r.address, r.st, v_cover;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_invite_mode_of(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_can_invite(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_decline(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_withdraw(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_company_page(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_can_invite(uuid), hub.cc_decline(uuid, text), hub.cc_withdraw(uuid), hub.cc_company_page(uuid) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_can_invite(uuid), hub.cc_decline(uuid, text), hub.cc_withdraw(uuid), hub.cc_company_page(uuid) TO contracts_rw;
  END IF;
END $$;
