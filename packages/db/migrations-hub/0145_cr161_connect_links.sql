-- CR-161 · lát 2 · spec §2 R1–R9, §4 · Kết nối hai công ty KHÔNG cần hợp đồng, dựng trên `hub.partner_links` (G1: không bảng «kết nối» riêng).
-- connected(A,B) ⇔ có cả (A→B) và (B→A), cả hai accepted_at NOT NULL và blocked_at NULL. Mọi trạng thái suy ra từ đây (xem `hub.cc_status_of`).
-- Hàm SECURITY DEFINER (search_path cố định, REVOKE PUBLIC, GRANT hub_rw + contracts_rw): mỗi hàm kiểm `app.tenant_id`.
-- Kiểm quyền «Toàn quyền» ở DB: `cc_invite` buộc p_user là người Toàn quyền (việc `admin` gói contracts) của công ty đang thao tác
-- (cùng nguồn grant với `packAccessInput`); các hàm khác chỉ kiểm tenant — cổng người dùng là `packGuard(view,"contracts","admin")` ở route (R1).
-- Lỗi nghiệp vụ có SQLSTATE riêng: CC422 (MESSAGE = CONNECT_NOT_LISTED) · CC409 (MESSAGE = CONNECT_DECLINED | CONNECT_NOT_CONNECTED).
-- Luật thuần trùng `connect.rules.ts` (connectStatusOf, inviteOutcome). Chuông chỉ vào `hub.notifications` với fanout_at = now() ⇒ KHÔNG email/push (R9).
-- Đường cũ (gửi HĐ lần đầu tự kèm lời mời, `partner_link_request`) giữ nguyên; accept/block chỉ thêm nhánh `connect_requested_at`.

ALTER TABLE hub.partner_links
  ADD COLUMN IF NOT EXISTS connect_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS connect_note text,
  ADD COLUMN IF NOT EXISTS connect_by uuid,
  ADD COLUMN IF NOT EXISTS connect_by_name text;
--> statement-breakpoint
ALTER TABLE hub.partner_links DROP CONSTRAINT IF EXISTS partner_links_connect_note_ck;
--> statement-breakpoint
ALTER TABLE hub.partner_links ADD CONSTRAINT partner_links_connect_note_ck
  CHECK (connect_note IS NULL OR char_length(connect_note) <= 500);
--> statement-breakpoint
ALTER TABLE hub.partner_links DROP CONSTRAINT IF EXISTS partner_links_connect_by_name_ck;
--> statement-breakpoint
ALTER TABLE hub.partner_links ADD CONSTRAINT partner_links_connect_by_name_ck
  CHECK (connect_by_name IS NULL OR char_length(connect_by_name) <= 200);
--> statement-breakpoint
-- Lời mời đến (to_tenant) còn chờ; `partner_links_to_ix` cho phía «in» của cc_links/cc_search (PK chỉ phủ from_tenant).
CREATE INDEX IF NOT EXISTS partner_links_to_connect_ix ON hub.partner_links (to_tenant) WHERE connect_requested_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_links_to_ix ON hub.partner_links (to_tenant);
--> statement-breakpoint

-- ── Hàm thuần (không DEFINER): R7, trạng thái nhìn từ A. o_* = dòng (A→B), i_* = dòng (B→A). Thứ tự ưu tiên đúng như spec. ───────
CREATE OR REPLACE FUNCTION hub.cc_status_of(
  o_requested timestamptz, o_accepted timestamptz, o_blocked timestamptz, o_creq timestamptz,
  i_accepted timestamptz, i_blocked timestamptz, i_creq timestamptz
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN o_accepted IS NOT NULL AND o_blocked IS NULL AND i_accepted IS NOT NULL AND i_blocked IS NULL THEN 'connected'
    WHEN o_creq IS NOT NULL THEN 'pending_out'
    WHEN i_creq IS NOT NULL THEN 'pending_in'
    WHEN o_blocked IS NOT NULL AND o_requested IS NOT NULL THEN 'declined'
    ELSE 'none' END
$$;
--> statement-breakpoint
-- Mã hoá phần trăm (UTF-8) cho tham số `party=` trong link chuông.
CREATE OR REPLACE FUNCTION hub.cc_urlenc(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(string_agg(CASE
           WHEN get_byte(x.bb, g.i) BETWEEN 48 AND 57 OR get_byte(x.bb, g.i) BETWEEN 65 AND 90
             OR get_byte(x.bb, g.i) BETWEEN 97 AND 122 OR get_byte(x.bb, g.i) IN (45, 46, 95, 126)
           THEN chr(get_byte(x.bb, g.i))
           ELSE '%' || upper(lpad(to_hex(get_byte(x.bb, g.i)), 2, '0')) END, '' ORDER BY g.i), '')
    FROM (SELECT convert_to(COALESCE(p, ''), 'UTF8') AS bb) x
    CROSS JOIN LATERAL generate_series(0, length(x.bb) - 1) AS g(i)
$$;
--> statement-breakpoint

-- ── Nội bộ (KHÔNG GRANT cho ai; chỉ hàm DEFINER khác gọi) ──────────────────────────────────────────────────────────────────
-- Người Toàn quyền = user nội bộ đang dùng, thuộc Group được cấp `contracts-admin`, gói contracts còn hiệu lực (`contracts-read`
-- và `contracts-admin` có entitlement chưa thu hồi, status ≠ off) — đúng `packAccessInput`/`grantsOf` (chỉ grant theo Group).
CREATE OR REPLACE FUNCTION hub.cc_owners_raw(p_tenants uuid[])
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT u.tenant_id, u.id
    FROM admin.users u
   WHERE u.tenant_id = ANY (p_tenants) AND u.active AND NOT u.locked_by_tenant AND u.kind = 'internal'
     AND EXISTS (SELECT 1 FROM admin.features fr
                   JOIN admin.feature_entitlements er ON er.feature_id = fr.id AND er.tenant_id = u.tenant_id AND er.revoked_at IS NULL
                  WHERE fr.key = 'contracts-read' AND fr.status <> 'off')
     AND EXISTS (SELECT 1 FROM admin.features fa
                   JOIN admin.feature_entitlements ea ON ea.feature_id = fa.id AND ea.tenant_id = u.tenant_id AND ea.revoked_at IS NULL
                   JOIN admin.feature_grants g ON g.feature_id = fa.id AND g.tenant_id = u.tenant_id AND g.group_id IS NOT NULL
                   JOIN admin.group_members gm ON gm.tenant_id = g.tenant_id AND gm.group_id = g.group_id AND gm.user_id = u.id
                  WHERE fa.key = 'contracts-admin' AND fa.status <> 'off')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.cc_connected_raw(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*) = 2 FROM hub.partner_links l
   WHERE ((l.from_tenant = p_a AND l.to_tenant = p_b) OR (l.from_tenant = p_b AND l.to_tenant = p_a))
     AND l.accepted_at IS NOT NULL AND l.blocked_at IS NULL
$$;
--> statement-breakpoint
-- Chuông cho người Toàn quyền của p_tenant (hoặc đúng p_users nếu có). fanout_at = now() ⇒ đã «chia kênh» sẵn: không email/push.
CREATE OR REPLACE FUNCTION hub.cc_bell(
  p_tenant uuid, p_users uuid[], p_kind text, p_title text, p_body text, p_link text, p_dedup text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, fanout_at)
    SELECT p_tenant, o.user_id, 'contracts', p_kind, left(p_title, 200), left(COALESCE(p_body, ''), 2000), p_link,
           left(p_dedup, 128), now()
      FROM hub.cc_owners_raw(ARRAY[p_tenant]) o
     WHERE p_users IS NULL OR o.user_id = ANY (p_users)
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO v_n FROM ins;
  RETURN v_n;
END $$;
--> statement-breakpoint
-- R4 · «đồng ý» trong MỘT câu lệnh (nguyên tử): (from→to) accepted/gỡ chặn/xoá lời mời chờ + upsert (to→from) accepted. Trả true khi có đổi.
CREATE OR REPLACE FUNCTION hub.cc_do_accept(p_from uuid, p_to uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH a AS (
    UPDATE hub.partner_links l
       SET accepted_at = COALESCE(l.accepted_at, now()), blocked_at = NULL, connect_requested_at = NULL
     WHERE l.from_tenant = p_from AND l.to_tenant = p_to AND l.connect_requested_at IS NOT NULL
    RETURNING 1)
  INSERT INTO hub.partner_links AS r (from_tenant, to_tenant, requested_at, accepted_at)
  SELECT p_to, p_from, now(), now() WHERE EXISTS (SELECT 1 FROM a)
  ON CONFLICT (from_tenant, to_tenant) DO UPDATE
    SET requested_at = COALESCE(r.requested_at, now()), accepted_at = COALESCE(r.accepted_at, now()),
        blocked_at = NULL, connect_requested_at = NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
--> statement-breakpoint

-- ── Công khai (hub_rw, contracts_rw) ─────────────────────────────────────────────────────────────────────────────────────────
-- Chỉ trả người của công ty đang thao tác, hoặc công ty đang kết nối / có lời mời chờ với nó (không lộ user công ty tuỳ ý).
CREATE OR REPLACE FUNCTION hub.cc_owner_users(p_tenants uuid[])
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_owner_users: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_tenants IS NULL OR cardinality(p_tenants) > 100 THEN
    RAISE EXCEPTION 'cc_owner_users: mảng công ty không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT o.tenant_id, o.user_id
    FROM hub.cc_owners_raw(ARRAY(
      SELECT t FROM unnest(p_tenants) t
       WHERE t = v_tid
          OR EXISTS (SELECT 1 FROM hub.partner_links l
                      WHERE ((l.from_tenant = v_tid AND l.to_tenant = t) OR (l.from_tenant = t AND l.to_tenant = v_tid))
                        AND l.connect_requested_at IS NOT NULL)
          OR hub.cc_connected_raw(v_tid, t))) o;
END $$;
--> statement-breakpoint
-- connected(a,b); chỉ trả true khi công ty đang thao tác là một trong hai (không dò quan hệ của hai công ty khác).
CREATE OR REPLACE FUNCTION hub.cc_connected(p_a uuid, p_b uuid)
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
    RAISE EXCEPTION 'cc_connected: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b OR v_tid NOT IN (p_a, p_b) THEN
    RETURN false;
  END IF;
  RETURN hub.cc_connected_raw(p_a, p_b);
END $$;
--> statement-breakpoint
-- R2 · tìm công ty trong Danh bạ: MST (10 số, hoặc 10 số + chi nhánh 3 số có/không dấu «-») khớp đúng, hoặc tên pháp lý chứa ≥ 3 ký tự.
-- Chỉ active + directory_listed + có tên pháp lý, loại chính A, ≤ 20; kèm trạng thái R7 bằng LEFT JOIN 2 lần trên PK (from,to).
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
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_search: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF v_q ~ '^[0-9]{10}(-?[0-9]{3})?$' THEN
    v_tax := CASE WHEN char_length(v_q) = 13 THEN substr(v_q, 1, 10) || '-' || substr(v_q, 11) ELSE v_q END;
  ELSIF char_length(v_q) < 3 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT t.id, t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL,
         hub.cc_status_of(o.requested_at, o.accepted_at, o.blocked_at, o.connect_requested_at,
                          i.accepted_at, i.blocked_at, i.connect_requested_at)
    FROM admin.tenants t
    LEFT JOIN hub.partner_links o ON o.from_tenant = v_tid AND o.to_tenant = t.id
    LEFT JOIN hub.partner_links i ON i.from_tenant = t.id AND i.to_tenant = v_tid
   WHERE t.directory_listed AND t.active AND t.legal_name IS NOT NULL AND t.id <> v_tid
     AND (CASE WHEN v_tax IS NOT NULL THEN t.tax_code = v_tax
               ELSE t.legal_name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' END)
   ORDER BY (t.directory_verified_at IS NOT NULL) DESC, t.legal_name, t.id
   LIMIT 20;
END $$;
--> statement-breakpoint
-- R3 · gửi lời mời. Trả ConnectStatus. Khoá advisory theo cặp ⇒ hai bên mời chéo cùng lúc vẫn ra đúng một kết quả.
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
  -- Người mời phải là người Toàn quyền (R1) của chính công ty đang thao tác.
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY[v_tid]) w WHERE w.user_id = p_user) THEN
    RAISE EXCEPTION 'cc_invite: chỉ người Toàn quyền được mời kết nối' USING ERRCODE = '42501';
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
    RETURN 'pending_out'; -- B chặn TRƯỚC khi A từng mời: không lộ (giữ quy tắc 0118), không đổi gì
  END IF;
  IF v_my = 'pending_out' THEN
    RETURN 'pending_out';
  END IF;
  IF v_my = 'pending_in' THEN
    -- Mời chéo: lời mời ngược của B đang chờ ⇒ A đồng ý luôn (R4, A là bên nhận).
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
  -- A từng chặn B (dòng B→A) ⇒ A chủ động mời nên gỡ chặn của A.
  UPDATE hub.partner_links l SET blocked_at = NULL
   WHERE l.from_tenant = p_to AND l.to_tenant = v_tid AND l.blocked_at IS NOT NULL;
  PERFORM hub.cc_bell(p_to, NULL, 'cc.invite',
    (SELECT COALESCE(t.legal_name, t.name) FROM admin.tenants t WHERE t.id = v_tid) || ' muốn kết nối với bạn', COALESCE(v_note, ''),
    '/contracts/partners?invites=1', 'cc.invite:' || v_tid || ':' || floor(extract(epoch FROM now()))::bigint);
  RETURN 'pending_out';
END $$;
--> statement-breakpoint
-- R4 · thay thân (0122 + nhánh CR-161). Chỉ B (to_tenant = tenant hiện tại). Dòng có `connect_requested_at` ⇒ nối HAI chiều (cc_do_accept);
-- đường cũ (lời mời sinh từ gửi HĐ) ⇒ như 0122, chỉ một chiều. Cả hai nhánh đều thả lần gửi HĐ đang giữ.
CREATE OR REPLACE FUNCTION hub.partner_link_accept(p_from_tenant uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_n integer;
  v_by uuid;
  v_name text;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_link_accept: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub.partner_links l WHERE l.from_tenant = p_from_tenant AND l.to_tenant = v_tid) THEN
    RAISE EXCEPTION 'partner_link_accept: không có lời mời tới công ty hiện tại' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_from_tenant::text) || greatest(v_tid::text, p_from_tenant::text), 161));
  SELECT l.connect_by INTO v_by FROM hub.partner_links l
   WHERE l.from_tenant = p_from_tenant AND l.to_tenant = v_tid AND l.connect_requested_at IS NOT NULL;
  IF FOUND THEN
    v_n := CASE WHEN hub.cc_do_accept(p_from_tenant, v_tid) THEN 1 ELSE 0 END;
    SELECT COALESCE(t.legal_name, t.name) INTO v_name FROM admin.tenants t WHERE t.id = v_tid;
    -- Chuông «đã đồng ý» cho người mời (còn là người Toàn quyền), không thì mọi người Toàn quyền của bên mời.
    PERFORM hub.cc_bell(p_from_tenant,
      CASE WHEN EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY[p_from_tenant]) w WHERE w.user_id = v_by) THEN ARRAY[v_by] END,
      'cc.accepted', COALESCE(v_name, 'Công ty') || ' đã đồng ý kết nối', '',
      '/contracts/partners?party=' || hub.cc_urlenc(v_name) || '&tenant=' || v_tid || '&tab=chat',
      'cc.accepted:' || v_tid || ':' || floor(extract(epoch FROM now()))::bigint);
  ELSE
    UPDATE hub.partner_links
       SET accepted_at = COALESCE(accepted_at, now()), blocked_at = NULL
     WHERE from_tenant = p_from_tenant AND to_tenant = v_tid AND (accepted_at IS NULL OR blocked_at IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  -- Lần gửi đang GIỮ ⇒ thả cho bộ chuyển giao (còn hạn).
  UPDATE hub.partner_mailbox SET status = 'sent', updated_at = now()
   WHERE from_tenant = p_from_tenant AND to_tenant = v_tid AND channel = 'platform' AND status = 'held'
     AND expires_at > now();
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
-- R5 · thay thân (0122 + xoá `connect_requested_at`): từ chối lời mời = chặn có sẵn. Không chuông cho bên mời (Q3).
CREATE OR REPLACE FUNCTION hub.partner_link_block(p_from_tenant uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_n integer;
BEGIN
  IF v_tid IS NULL OR p_from_tenant IS NULL OR p_from_tenant = v_tid THEN
    RAISE EXCEPTION 'partner_link_block: công ty không hợp lệ' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.tenants t WHERE t.id = p_from_tenant) THEN
    RAISE EXCEPTION 'partner_link_block: công ty không hợp lệ' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.partner_links (from_tenant, to_tenant, blocked_at) VALUES (p_from_tenant, v_tid, now())
  ON CONFLICT (from_tenant, to_tenant) DO UPDATE SET blocked_at = now(), connect_requested_at = NULL
    WHERE hub.partner_links.blocked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Lần gửi đang GIỮ ⇒ trả lời tự động Từ chối (chỉ khi A đã xin; chặn trước thì im lặng — không lộ).
  UPDATE hub.partner_mailbox m SET status = 'replied', outcome = 'declined', replied_by_source = 'receiver_flow',
         reason = 'Công ty nhận không nhận hợp đồng qua nền tảng — hãy gửi qua email.',
         replied_at = now(), updated_at = now()
   WHERE m.from_tenant = p_from_tenant AND m.to_tenant = v_tid AND m.channel = 'platform' AND m.status = 'held'
     AND EXISTS (SELECT 1 FROM hub.partner_links l
                  WHERE l.from_tenant = p_from_tenant AND l.to_tenant = v_tid AND l.requested_at IS NOT NULL);
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
-- R6 · ngắt kết nối: chỉ khi connected, xoá cả hai dòng chưa chặn (một câu DELETE), chuông cho người Toàn quyền của B.
-- Ghi audit do route (lát API) làm: CHECK `hub.audit_log.action` không có «disconnect» và hàm này không biết người thao tác.
CREATE OR REPLACE FUNCTION hub.cc_disconnect(p_other uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_name text;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_disconnect: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_tid THEN
    RAISE EXCEPTION 'cc_disconnect: công ty không hợp lệ' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_other::text) || greatest(v_tid::text, p_other::text), 161));
  IF NOT hub.cc_connected_raw(v_tid, p_other) THEN
    RAISE EXCEPTION 'CONNECT_NOT_CONNECTED' USING ERRCODE = 'CC409';
  END IF;
  DELETE FROM hub.partner_links l
   WHERE ((l.from_tenant = v_tid AND l.to_tenant = p_other) OR (l.from_tenant = p_other AND l.to_tenant = v_tid))
     AND l.blocked_at IS NULL;
  SELECT COALESCE(t.legal_name, t.name) INTO v_name FROM admin.tenants t WHERE t.id = v_tid;
  PERFORM hub.cc_bell(p_other, NULL, 'cc.disconnected', COALESCE(v_name, 'Công ty') || ' đã ngắt kết nối', '',
    '/contracts/partners', 'cc.disconnected:' || v_tid || ':' || floor(extract(epoch FROM now()))::bigint);
  RETURN true;
END $$;
--> statement-breakpoint
-- Chạy lại trên DB đã qua hub 0149 (cc_links bỏ cột `unread` ⇒ kiểu trả về khác): DROP trước, quyền cấp lại ở cuối file.
DROP FUNCTION IF EXISTS hub.cc_links(text, timestamptz, uuid, integer);
--> statement-breakpoint
-- Danh sách kết nối (connected / pending_in / pending_out) của A, keyset `(since, tenant_id) DESC`, 1 câu. p_limit kẹp 1..101
-- (route xin limit+1 để biết còn trang). `unread` = 0 ở 0145; hub 0146 (luồng trò chuyện) thay thân để tính chưa đọc.
CREATE OR REPLACE FUNCTION hub.cc_links(p_status text, p_cur_t timestamptz, p_cur_id uuid, p_limit integer)
RETURNS TABLE (
  tenant_id uuid, legal_name text, tax_code text, verified boolean, status text, note text, invited_by_name text,
  since timestamptz, unread integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 101);
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_links: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.other, t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL, x.st, x.note, x.by_name, x.ts, 0
    FROM (
      SELECT y.other, y.st, y.note, y.by_name,
             CASE y.st WHEN 'connected' THEN GREATEST(y.o_acc, y.i_acc)
                       WHEN 'pending_out' THEN y.o_creq ELSE y.i_creq END AS ts
        FROM (
          SELECT COALESCE(o.to_tenant, i.from_tenant) AS other,
                 o.accepted_at AS o_acc, i.accepted_at AS i_acc, o.connect_requested_at AS o_creq, i.connect_requested_at AS i_creq,
                 hub.cc_status_of(o.requested_at, o.accepted_at, o.blocked_at, o.connect_requested_at,
                                  i.accepted_at, i.blocked_at, i.connect_requested_at) AS st,
                 COALESCE(o.connect_note, i.connect_note) AS note, COALESCE(o.connect_by_name, i.connect_by_name) AS by_name
            FROM (SELECT * FROM hub.partner_links WHERE from_tenant = v_tid) o
            FULL JOIN (SELECT * FROM hub.partner_links WHERE to_tenant = v_tid) i ON i.from_tenant = o.to_tenant
        ) y
    ) x
    JOIN admin.tenants t ON t.id = x.other
   WHERE x.st IN ('connected', 'pending_in', 'pending_out')
     AND (p_status IS NULL OR x.st = p_status)
     AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (x.ts, x.other) < (p_cur_t, p_cur_id))
   ORDER BY x.ts DESC, x.other DESC
   LIMIT v_lim;
END $$;
--> statement-breakpoint
-- Chuông cho người Toàn quyền của công ty KHÁC (cc.msg ở lát trò chuyện). p_batch = [{tenant_id, user_id, kind, title, body?, link?, dedup_key}]
-- (≤ 500). Chỉ nhận công ty ≠ công ty hiện tại đang kết nối hoặc có lời mời chờ với nó, và user thuộc người Toàn quyền công ty đó;
-- dòng khác bỏ qua im lặng. kind chỉ `cc.*`. Khử trùng bằng UNIQUE (tenant,user,source,dedup_key). Trả số chuông mới.
CREATE OR REPLACE FUNCTION hub.cc_notify(p_batch jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_n integer;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_notify: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 500 THEN
    RAISE EXCEPTION 'cc_notify: lô phải là mảng ≤ 500' USING ERRCODE = '22023';
  END IF;
  WITH b AS (
    SELECT x.tenant_id, x.user_id, x.kind, x.title, COALESCE(x.body, '') AS body, x.link, x.dedup_key
      FROM jsonb_to_recordset(p_batch) AS x(tenant_id uuid, user_id uuid, kind text, title text, body text, link text, dedup_key text)
     WHERE x.tenant_id IS NOT NULL AND x.tenant_id <> v_tid AND x.user_id IS NOT NULL AND x.kind ~ '^cc\.[a-z_]{1,30}$'
       AND x.title IS NOT NULL AND x.dedup_key IS NOT NULL
  ), ok AS (
    SELECT b.* FROM b
     WHERE EXISTS (SELECT 1 FROM hub.partner_links l
                    WHERE ((l.from_tenant = v_tid AND l.to_tenant = b.tenant_id) OR (l.from_tenant = b.tenant_id AND l.to_tenant = v_tid))
                      AND l.connect_requested_at IS NOT NULL)
        OR hub.cc_connected_raw(v_tid, b.tenant_id)
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, fanout_at)
    SELECT ok.tenant_id, ok.user_id, 'contracts', ok.kind, left(ok.title, 200), left(ok.body, 2000), ok.link, left(ok.dedup_key, 128), now()
      FROM ok
     WHERE EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY(SELECT DISTINCT ok2.tenant_id FROM ok ok2)) w
                    WHERE w.tenant_id = ok.tenant_id AND w.user_id = ok.user_id)
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO v_n FROM ins;
  RETURN v_n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_status_of(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_urlenc(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_owners_raw(uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_connected_raw(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_bell(uuid, uuid[], text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_do_accept(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_owner_users(uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_connected(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_search(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_invite(uuid, text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_disconnect(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_links(text, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_notify(jsonb) FROM PUBLIC;
--> statement-breakpoint
-- hub_rw (hub-api, scope user) và, khi có, role gói `contracts_rw` (tạo SAU hub ⇒ khối DO như 0118) + `community_rw` (chỉ cc_connected).
-- Hàm nội bộ (cc_owners_raw, cc_connected_raw, cc_bell, cc_do_accept, cc_status_of, cc_urlenc) KHÔNG cấp cho ai: chỉ hàm DEFINER gọi.
GRANT EXECUTE ON FUNCTION hub.cc_owner_users(uuid[]), hub.cc_connected(uuid, uuid), hub.cc_search(text),
  hub.cc_invite(uuid, text, uuid, text), hub.cc_disconnect(uuid), hub.cc_links(text, timestamptz, uuid, integer),
  hub.cc_notify(jsonb) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_owner_users(uuid[]), hub.cc_connected(uuid, uuid), hub.cc_search(text),
      hub.cc_invite(uuid, text, uuid, text), hub.cc_disconnect(uuid), hub.cc_links(text, timestamptz, uuid, integer),
      hub.cc_notify(jsonb), hub.partner_link_accept(uuid), hub.partner_link_block(uuid) TO contracts_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_rw') THEN
    GRANT USAGE ON SCHEMA hub TO community_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_connected(uuid, uuid) TO community_rw;
  END IF;
END $$;
