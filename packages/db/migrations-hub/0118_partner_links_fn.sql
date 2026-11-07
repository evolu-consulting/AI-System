-- CR-124 · q2 · FLOW4-FR-06 · spec §5 · Nối đối tác (consent một lần) trên `hub.partner_links {from_tenant, to_tenant}`.
-- Bảng đã có ở 0117 (RLS chỉ hub_rw scope system). Người dùng/gói chỉ đi qua 4 hàm SECURITY DEFINER (search_path cố định,
-- REVOKE PUBLIC, kiểm `app.tenant_id` như `hub.partner_send`). Quy ước: dòng (A → B) = "A xin gửi HĐ cho B".
--   request(B)  : A (tenant hiện tại) tạo lời mời; B phải đang bật "cho phép tìm thấy" (đọc admin.tenants bằng quyền chủ hàm).
--   accept(A)   : CHỈ B (to_tenant = tenant hiện tại) chấp nhận lời mời tới mình; bỏ chặn nếu đang chặn.
--   block(A)    : CHỈ B chặn A (cả khi A chưa gửi — chặn trước). Giữ accepted_at làm lịch sử.
--   mine()      : dòng mà tenant hiện tại là bên gửi ('out') hoặc nhận ('in'), kèm tên/MST công khai của bên kia.
-- Sai bên / không có lời mời ⇒ 42501 (không lộ có hay không). `partner_send` (0117) giữ nguyên: vẫn cần accepted_at, chưa blocked_at.
CREATE OR REPLACE FUNCTION hub.partner_link_request(p_to_tenant uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_status text;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_link_request: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_to_tenant IS NULL OR p_to_tenant = v_tid THEN
    RAISE EXCEPTION 'partner_link_request: công ty nhận không hợp lệ' USING ERRCODE = '22023';
  END IF;
  -- Đã có dòng (kể cả B chặn trước) ⇒ trả trạng thái hiện tại, không đổi, không cần B còn bật danh bạ.
  SELECT CASE WHEN l.blocked_at IS NOT NULL THEN 'blocked' WHEN l.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END
    INTO v_status FROM hub.partner_links l WHERE l.from_tenant = v_tid AND l.to_tenant = p_to_tenant;
  IF FOUND THEN
    RETURN v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.tenants t WHERE t.id = p_to_tenant AND t.active AND t.directory_listed) THEN
    RAISE EXCEPTION 'partner_link_request: công ty nhận không bật cho phép tìm thấy' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.partner_links (from_tenant, to_tenant) VALUES (v_tid, p_to_tenant) ON CONFLICT DO NOTHING;
  RETURN 'pending';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.partner_link_accept(p_from_tenant uuid)
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
    RAISE EXCEPTION 'partner_link_accept: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub.partner_links l WHERE l.from_tenant = p_from_tenant AND l.to_tenant = v_tid) THEN
    RAISE EXCEPTION 'partner_link_accept: không có lời mời tới công ty hiện tại' USING ERRCODE = '42501';
  END IF;
  UPDATE hub.partner_links
     SET accepted_at = COALESCE(accepted_at, now()), blocked_at = NULL
   WHERE from_tenant = p_from_tenant AND to_tenant = v_tid AND (accepted_at IS NULL OR blocked_at IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
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
  INSERT INTO hub.partner_links (from_tenant, to_tenant, blocked_at) VALUES (p_from_tenant, v_tid, now())
  ON CONFLICT (from_tenant, to_tenant) DO UPDATE SET blocked_at = now() WHERE hub.partner_links.blocked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.partner_links_mine()
RETURNS TABLE (
  direction text, other_tenant uuid, other_name text, other_tax_code text, other_verified boolean, status text,
  created_at timestamptz, decided_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_links_mine: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.direction, x.other, COALESCE(t.legal_name, t.name), t.tax_code, t.directory_verified_at IS NOT NULL,
         CASE WHEN x.blocked_at IS NOT NULL THEN 'blocked' WHEN x.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END,
         x.created_at, COALESCE(x.blocked_at, x.accepted_at)
    FROM (
      SELECT 'out'::text AS direction, l.to_tenant AS other, l.accepted_at, l.blocked_at, l.created_at
        FROM hub.partner_links l WHERE l.from_tenant = v_tid
      UNION ALL
      SELECT 'in'::text, l.from_tenant, l.accepted_at, l.blocked_at, l.created_at
        FROM hub.partner_links l WHERE l.to_tenant = v_tid
    ) x
    LEFT JOIN admin.tenants t ON t.id = x.other
   ORDER BY x.created_at DESC LIMIT 200;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_link_request(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_link_accept(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_link_block(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_links_mine() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_link_request(uuid) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_link_accept(uuid) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_link_block(uuid) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_links_mine() TO hub_rw;
--> statement-breakpoint
-- Role gói (`contracts_rw`) do packs.install tạo SAU hub ⇒ khối này bỏ qua khi chưa có; gói cấp lại ở migration gói (q3).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_link_request(uuid), hub.partner_link_accept(uuid),
      hub.partner_link_block(uuid), hub.partner_links_mine() TO contracts_rw;
  END IF;
END $$;
