-- CR-124 · q4 · FLOW4-FR-06 · spec §5 · GIỮ lần gửi ĐẦU cho tới khi bên nhận chấp nhận nối:
--   - `partner_send` (kênh nền tảng, link CHƯA chấp nhận nhưng đã có lời mời) ⇒ dòng 'held' (bộ chuyển chỉ giao 'sent' ⇒ không tới B);
--   - `partner_link_accept` ⇒ 'held' → 'sent' (cùng tx chấp nhận, bộ chuyển giao tiếp);
--   - `partner_link_block` ⇒ 'held' → trả lời tự động 'declined' (lý do nói cách khắc phục: gửi qua email) để flow bên gửi đi nhánh Từ chối.
-- Chặn trước (B chặn khi A chưa xin): giữ 'held' im lặng tới hết hạn — không lộ việc bị chặn (như q2). Chỉ thêm trạng thái + thay 3 hàm DEFINER.
ALTER TABLE hub.partner_mailbox DROP CONSTRAINT IF EXISTS partner_mailbox_status_ck;
--> statement-breakpoint
ALTER TABLE hub.partner_mailbox ADD CONSTRAINT partner_mailbox_status_ck
  CHECK (status IN ('held', 'sent', 'delivered', 'replied', 'expired', 'closed')) NOT VALID; -- VALIDATE ở hub 0123 (không giữ khoá khi quét)
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.partner_send(
  p_from_tenant uuid,
  p_to_tenant uuid,
  p_to_email text,
  p_channel text,
  p_from_ref text,
  p_payload jsonb,
  p_file_ref text,
  p_pdf_sha256 text,
  p_expires_at timestamptz,
  p_prev_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_round integer := 1;
  v_id uuid;
  v_status text := 'sent';
BEGIN
  IF v_tid IS NULL OR p_from_tenant IS DISTINCT FROM v_tid THEN
    RAISE EXCEPTION 'partner_send: tenant % không phải tenant hiện tại', p_from_tenant USING ERRCODE = '42501';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'partner_send: hạn trả lời phải trong 30 ngày tới' USING ERRCODE = '22023';
  END IF;
  IF p_channel = 'platform' AND NOT EXISTS (
       SELECT 1 FROM hub.partner_links l
        WHERE l.from_tenant = v_tid AND l.to_tenant = p_to_tenant
          AND l.accepted_at IS NOT NULL AND l.blocked_at IS NULL) THEN
    -- Chưa nối: GIỮ lần gửi — cho cả 3 trường hợp BÊN GỬI KHÔNG PHÂN BIỆT ĐƯỢC: chưa có dòng nối, đã xin chờ B, hoặc B chặn TRƯỚC khi A xin
    -- (giữ im lặng tới hết hạn). Chỉ khi A đã xin RỒI bị chặn (A đã biết) ⇒ từ chối rõ để A đi kênh email.
    IF EXISTS (SELECT 1 FROM hub.partner_links l
                WHERE l.from_tenant = v_tid AND l.to_tenant = p_to_tenant
                  AND l.blocked_at IS NOT NULL AND l.requested_at IS NOT NULL) THEN
      RAISE EXCEPTION 'partner_send: công ty nhận không nhận HĐ qua nền tảng' USING ERRCODE = '42501';
    END IF;
    v_status := 'held';
  END IF;
  IF p_prev_id IS NOT NULL THEN
    SELECT m.round + 1 INTO v_round FROM hub.partner_mailbox m
     WHERE m.id = p_prev_id AND m.from_tenant = v_tid
       AND m.to_tenant IS NOT DISTINCT FROM p_to_tenant AND m.to_email IS NOT DISTINCT FROM p_to_email;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_send: lần gửi trước không thuộc tenant hiện tại' USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO hub.partner_mailbox (from_tenant, to_tenant, to_email, channel, from_ref, payload, file_ref, pdf_sha256,
                                   expires_at, round, prev_id, status)
  VALUES (v_tid, p_to_tenant, p_to_email, p_channel, p_from_ref, COALESCE(p_payload, '{}'::jsonb), p_file_ref,
          p_pdf_sha256, p_expires_at, v_round, p_prev_id, v_status)
  RETURNING id INTO v_id;
  RETURN v_id;
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
  -- Lần gửi đang GIỮ ⇒ thả cho bộ chuyển giao (còn hạn).
  UPDATE hub.partner_mailbox SET status = 'sent', updated_at = now()
   WHERE from_tenant = p_from_tenant AND to_tenant = v_tid AND channel = 'platform' AND status = 'held'
     AND expires_at > now();
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
  IF NOT EXISTS (SELECT 1 FROM admin.tenants t WHERE t.id = p_from_tenant) THEN
    RAISE EXCEPTION 'partner_link_block: công ty không hợp lệ' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.partner_links (from_tenant, to_tenant, blocked_at) VALUES (p_from_tenant, v_tid, now())
  ON CONFLICT (from_tenant, to_tenant) DO UPDATE SET blocked_at = now() WHERE hub.partner_links.blocked_at IS NULL;
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
-- Người phụ trách HĐ nhận phải là thành viên (nội bộ, đang dùng) của CHÍNH công ty: gói không đọc dmin.users ⇒ hàm DEFINER trả boolean.
CREATE OR REPLACE FUNCTION hub.partner_is_member(p_user uuid)
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
    RAISE EXCEPTION 'partner_is_member: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN p_user IS NOT NULL AND EXISTS (SELECT 1 FROM admin.users u
    WHERE u.id = p_user AND u.tenant_id = v_tid AND u.active AND NOT u.locked_by_tenant AND u.kind = 'internal');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_is_member(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_is_member(uuid) TO hub_rw;
--> statement-breakpoint
-- Lời mời nối ĐẾN tenant hiện tại (cho hộp «Hợp đồng đối tác gửi»): công ty gửi (tên/MST công khai) + số lần gửi đang giữ. Chỉ lời mời đã 'xin'.
CREATE OR REPLACE FUNCTION hub.partner_link_invites()
RETURNS TABLE (from_tenant uuid, from_name text, from_tax_code text, from_verified boolean, held integer, requested_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_link_invites: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.from_tenant, t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL,
         (SELECT count(*)::int FROM hub.partner_mailbox m
           WHERE m.from_tenant = l.from_tenant AND m.to_tenant = v_tid AND m.status = 'held'),
         l.requested_at
    FROM hub.partner_links l JOIN admin.tenants t ON t.id = l.from_tenant
   WHERE l.to_tenant = v_tid AND l.requested_at IS NOT NULL AND l.accepted_at IS NULL AND l.blocked_at IS NULL
   ORDER BY l.requested_at DESC LIMIT 100;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_link_invites() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_link_invites() TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT EXECUTE ON FUNCTION hub.partner_link_invites(), hub.partner_is_member(uuid) TO contracts_rw;
  END IF;
END $$;
