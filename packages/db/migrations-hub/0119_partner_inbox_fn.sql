-- CR-124 · q3 · FLOW4-FR-06/07/15 · spec §5, §7 · 3 hàm DEFINER cho gói Hợp đồng (role `contracts_rw`) — gói KHÔNG đọc `hub.partner_mailbox` /
-- `hub.partner_links` / `admin.tenants` trực tiếp (không policy); mỗi hàm kiểm `app.tenant_id` như `hub.partner_send` (search_path cố định,
-- REVOKE PUBLIC):
--   partner_self()          : tên pháp lý / MST / dấu xác minh CÔNG KHAI của tenant hiện tại (ghi vào bản chia sẻ gửi đi).
--   partner_route(mst)      : công ty nhận theo MST KHỚP ĐÚNG (chỉ công ty bật "cho phép tìm thấy") + trạng thái nối của tenant hiện tại
--                             (accepted | pending | blocked) — chọn kênh nền tảng/email (FR-15). Không lộ công ty tắt danh bạ. Chặn trước (chưa xin) ⇒ pending.
--   partner_inbox_take(n)   : lô dòng 'sent' kênh nền tảng gửi TỚI tenant hiện tại ⇒ 'delivered' (FOR UPDATE SKIP LOCKED, một câu) và trả bản
--                             chia sẻ + thông tin công khai bên gửi + lý do lần trước (FR-17). Chỉ dòng của chính tenant; không trả from_ref/evidence.
CREATE OR REPLACE FUNCTION hub.partner_self()
RETURNS TABLE (name text, tax_code text, verified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_self: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL
    FROM admin.tenants t WHERE t.id = v_tid;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.partner_route(p_tax_code text)
RETURNS TABLE (to_tenant uuid, name text, verified boolean, link text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_route: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_tax_code IS NULL OR length(p_tax_code) NOT BETWEEN 10 AND 14 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT t.id, t.legal_name, t.directory_verified_at IS NOT NULL,
         CASE WHEN l.blocked_at IS NOT NULL AND l.requested_at IS NOT NULL THEN 'blocked'
              WHEN l.accepted_at IS NOT NULL AND l.blocked_at IS NULL THEN 'accepted'
              ELSE 'pending' END
    FROM admin.tenants t
    LEFT JOIN hub.partner_links l ON l.from_tenant = v_tid AND l.to_tenant = t.id
   WHERE t.tax_code = p_tax_code AND t.active AND t.directory_listed AND t.id <> v_tid
   LIMIT 1;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.partner_inbox_take(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, round integer, prev_reason text, payload jsonb, file_ref text, pdf_sha256 text, expires_at timestamptz,
  sender_name text, sender_tax_code text, sender_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_inbox_take: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT m.id FROM hub.partner_mailbox m
     WHERE m.to_tenant = v_tid AND m.channel = 'platform' AND m.status = 'sent' AND m.expires_at > now()
       AND NOT EXISTS (SELECT 1 FROM hub.partner_links l
                        WHERE l.from_tenant = m.from_tenant AND l.to_tenant = v_tid AND l.blocked_at IS NOT NULL)
     ORDER BY m.created_at LIMIT v_lim FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE hub.partner_mailbox m SET status = 'delivered', updated_at = now()
      FROM c WHERE m.id = c.id
    RETURNING m.id, m.from_tenant, m.prev_id, m.round, m.payload, m.file_ref, m.pdf_sha256, m.expires_at
  )
  SELECT u.id, u.round, (SELECT p.reason FROM hub.partner_mailbox p
                          WHERE p.id = u.prev_id AND p.from_tenant = u.from_tenant),
         u.payload, u.file_ref, u.pdf_sha256, u.expires_at,
         t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL
    FROM u LEFT JOIN admin.tenants t ON t.id = u.from_tenant;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_self() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_route(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_inbox_take(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_self(), hub.partner_route(text), hub.partner_inbox_take(integer) TO hub_rw;
--> statement-breakpoint
-- Role gói (`contracts_rw`) do packs.install tạo SAU hub ⇒ khối này bỏ qua khi chưa có; gói cấp lại ở migration gói (contracts 0085).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_self(), hub.partner_route(text), hub.partner_inbox_take(integer)
      TO contracts_rw;
  END IF;
END $$;
