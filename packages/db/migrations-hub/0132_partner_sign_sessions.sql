-- CR-127 · P1 · BR-60…65 · spec §2.4, §3 #12–#14c · gap-d §3: PHIÊN KÝ CHUNG liên công ty ("Ký cùng lúc", giai đoạn đầu `selfsign`).
-- (1) Bảng riêng `hub.partner_sign_sessions`, FK `mailbox_id` → `hub.partner_mailbox` (KHÔNG đổi `partner_mailbox_outcome_ck`).
--     RLS bật, CHỈ policy `hub_rw` scope `system` (bộ chuyển) — khuôn 0117. Người dùng/gói chỉ đi qua hàm SECURITY DEFINER.
-- (2) Hàm DEFINER: phía (`from`/`to`) SUY TỪ `app.tenant_id`; tenant không thuộc phiên ⇒ RAISE `SESSION_FORBIDDEN` (42501).
--     Phiên đã kết thúc / sai bước ⇒ `SESSION_NOT_ACTIVE` (55000). Văn bản ký khác bản đã thống nhất ⇒ `SESSION_HASH_MISMATCH` (22023).
-- (3) Mỗi lần đổi trạng thái hạ cờ `emitted_from/emitted_to` ⇒ bộ chuyển (`partners/mailbox-mover.ts`, pha phiên ký) báo gói từng bên
--     (chuyển HĐ #12–#14c qua cổng `applyTransition` + tín hiệu `sign.session.*`) rồi bật lại cờ. Hạn trả lời / hạn ký tính ở bộ chuyển
--     (`deadline <= now()`), không ngủ chờ (Luật 4c).
-- Quyết định trong lúc làm (ghi spec §12): thêm trạng thái `declined` (một bên từ chối ký ⇒ reject hai bên, #13), cột `sign_h`
-- (hạn ký tính từ lúc bên nhận đồng ý), `expire_choice` (bên gửi chọn Gửi lại/Dừng khi quá hạn ký, #14b/#14c) và 3 hàm
-- `sign_session_decline`, `sign_session_fallback`, `sign_session_resolve` (spec chỉ nêu 5 hàm; thiếu đường cho #13/#14b/#14c/"Xử lý bình thường").
-- Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS hub.partner_sign_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mailbox_id uuid NOT NULL,
  from_tenant uuid NOT NULL,
  to_tenant uuid NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  reason text,
  accept_deadline_at timestamptz NOT NULL,
  sign_h integer NOT NULL,
  sign_deadline_at timestamptz,
  pdf_sha256 text NOT NULL,
  from_signed_at timestamptz,
  from_signer_name text,
  to_signed_at timestamptz,
  to_signer_name text,
  cancel_side text,
  cancel_reason text,
  expire_choice text,
  emitted_from boolean NOT NULL DEFAULT true,
  emitted_to boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_sign_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT partner_sign_sessions_mailbox_fk FOREIGN KEY (mailbox_id) REFERENCES hub.partner_mailbox (id),
  CONSTRAINT partner_sign_sessions_status_ck CHECK (status IN
    ('proposed', 'accepted', 'signing', 'done', 'cancelled', 'declined', 'expired', 'fallback')),
  CONSTRAINT partner_sign_sessions_self_ck CHECK (from_tenant <> to_tenant),
  CONSTRAINT partner_sign_sessions_sha_ck CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT partner_sign_sessions_sign_h_ck CHECK (sign_h BETWEEN 1 AND 168),
  CONSTRAINT partner_sign_sessions_side_ck CHECK (cancel_side IS NULL OR cancel_side IN ('from', 'to')),
  CONSTRAINT partner_sign_sessions_choice_ck CHECK (
    expire_choice IS NULL OR (status = 'expired' AND expire_choice IN ('resend', 'stop'))),
  CONSTRAINT partner_sign_sessions_text_ck CHECK ((reason IS NULL OR char_length(reason) <= 2000)
    AND (cancel_reason IS NULL OR char_length(cancel_reason) <= 2000)
    AND (from_signer_name IS NULL OR char_length(from_signer_name) BETWEEN 1 AND 200)
    AND (to_signer_name IS NULL OR char_length(to_signer_name) BETWEEN 1 AND 200)),
  CONSTRAINT partner_sign_sessions_done_ck CHECK (
    status <> 'done' OR (from_signed_at IS NOT NULL AND to_signed_at IS NOT NULL))
);
--> statement-breakpoint
-- Một phiên mỗi lần gửi (gửi lại = lần gửi mới ⇒ phiên mới).
CREATE UNIQUE INDEX IF NOT EXISTS partner_sign_sessions_mailbox_uq ON hub.partner_sign_sessions (mailbox_id);
--> statement-breakpoint
-- Bộ chuyển: phiên còn cờ chưa báo (ít) + phiên còn mở theo hạn.
CREATE INDEX IF NOT EXISTS partner_sign_sessions_pending_idx ON hub.partner_sign_sessions (updated_at)
  WHERE NOT (emitted_from AND emitted_to);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_sign_sessions_open_idx ON hub.partner_sign_sessions (status, accept_deadline_at, sign_deadline_at)
  WHERE status IN ('proposed', 'accepted', 'signing');
--> statement-breakpoint
ALTER TABLE hub.partner_sign_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'partner_sign_sessions'
                 AND policyname = 'partner_sign_sessions_system') THEN
    CREATE POLICY partner_sign_sessions_system ON hub.partner_sign_sessions FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system')
      WITH CHECK (current_setting('app.scope', true) = 'system');
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, UPDATE ON hub.partner_sign_sessions TO hub_rw;
--> statement-breakpoint
-- Khoá dòng phiên + suy phía của tenant hiện tại. Không thuộc phiên (hoặc phiên không có) ⇒ SESSION_FORBIDDEN (không lộ phiên có tồn tại).
CREATE OR REPLACE FUNCTION hub.sign_session_lock(p_session uuid, OUT r hub.partner_sign_sessions, OUT side text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  SELECT * INTO r FROM hub.partner_sign_sessions s WHERE s.id = p_session FOR UPDATE;
  IF v_tid IS NULL OR r.id IS NULL OR v_tid NOT IN (r.from_tenant, r.to_tenant) THEN
    RAISE EXCEPTION 'SESSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  side := CASE WHEN v_tid = r.from_tenant THEN 'from' ELSE 'to' END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.sign_session_lock(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Bên GỬI đề xuất ký cùng lúc cho lần gửi kênh nền tảng của CHÍNH mình (cùng tx `partner_send`). Gọi lại cùng lần gửi ⇒ trả phiên cũ.
CREATE OR REPLACE FUNCTION hub.sign_session_propose(
  p_mailbox uuid, p_reason text, p_accept_h integer, p_sign_h integer, p_pdf_sha256 text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  m hub.partner_mailbox;
  v_id uuid;
BEGIN
  SELECT * INTO m FROM hub.partner_mailbox x WHERE x.id = p_mailbox;
  IF v_tid IS NULL OR m.id IS NULL OR m.from_tenant <> v_tid THEN
    RAISE EXCEPTION 'SESSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF m.channel <> 'platform' OR m.status NOT IN ('sent', 'delivered') THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  IF p_accept_h IS NULL OR p_accept_h NOT BETWEEN 1 AND 168 OR p_sign_h IS NULL OR p_sign_h NOT BETWEEN 1 AND 168 THEN
    RAISE EXCEPTION 'sign_session_propose: hạn phải từ 1 đến 168 giờ' USING ERRCODE = '22023';
  END IF;
  INSERT INTO hub.partner_sign_sessions (mailbox_id, from_tenant, to_tenant, reason, accept_deadline_at, sign_h, pdf_sha256)
  VALUES (m.id, m.from_tenant, m.to_tenant, NULLIF(btrim(p_reason), ''), now() + make_interval(hours => p_accept_h),
    p_sign_h, p_pdf_sha256)
  ON CONFLICT (mailbox_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT s.id INTO v_id FROM hub.partner_sign_sessions s WHERE s.mailbox_id = m.id;
  END IF;
  RETURN v_id;
END $$;
--> statement-breakpoint
-- Bên NHẬN đồng ý (còn trong hạn trả lời) ⇒ `accepted`, hạn ký = now() + sign_h. Gọi lại khi đã accepted ⇒ không đổi (idempotent).
CREATE OR REPLACE FUNCTION hub.sign_session_accept(p_session uuid, p_signer_name text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM hub.sign_session_lock(p_session);
  IF l.side <> 'to' THEN RAISE EXCEPTION 'SESSION_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF (l.r).status = 'accepted' THEN RETURN 'accepted'; END IF;
  IF (l.r).status <> 'proposed' OR (l.r).accept_deadline_at <= now() THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  UPDATE hub.partner_sign_sessions SET status = 'accepted', to_signer_name = NULLIF(btrim(p_signer_name), ''),
    sign_deadline_at = now() + make_interval(hours => sign_h), emitted_from = false, emitted_to = false, updated_at = now()
  WHERE id = p_session;
  RETURN 'accepted';
END $$;
--> statement-breakpoint
-- Bên NHẬN chọn "Xử lý bình thường" ⇒ `fallback` (bộ chuyển cũng đặt khi hết hạn trả lời).
CREATE OR REPLACE FUNCTION hub.sign_session_fallback(p_session uuid) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM hub.sign_session_lock(p_session);
  IF l.side <> 'to' THEN RAISE EXCEPTION 'SESSION_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF (l.r).status = 'fallback' THEN RETURN 'fallback'; END IF;
  IF (l.r).status <> 'proposed' THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000'; END IF;
  UPDATE hub.partner_sign_sessions SET status = 'fallback', emitted_from = false, emitted_to = false, updated_at = now()
  WHERE id = p_session;
  RETURN 'fallback';
END $$;
--> statement-breakpoint
-- Một bên đã ký (phong bì của bên đó hoàn tất) — so sha256 văn bản ký với bản đã thống nhất. Cả hai đã ký ⇒ `done` (cùng câu, khoá dòng).
-- Ký lại cùng bên ⇒ không đổi (idempotent).
CREATE OR REPLACE FUNCTION hub.sign_session_mark_signed(p_session uuid, p_signer_name text, p_pdf_sha256 text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
  v_status text;
BEGIN
  SELECT * INTO l FROM hub.sign_session_lock(p_session);
  IF (l.r).status = 'done' THEN RETURN 'done'; END IF;
  IF (l.r).status NOT IN ('accepted', 'signing') OR (l.r).sign_deadline_at <= now() THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  IF p_pdf_sha256 IS DISTINCT FROM (l.r).pdf_sha256 THEN
    RAISE EXCEPTION 'SESSION_HASH_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF (l.side = 'from' AND (l.r).from_signed_at IS NOT NULL) OR (l.side = 'to' AND (l.r).to_signed_at IS NOT NULL) THEN
    RETURN (l.r).status;
  END IF;
  UPDATE hub.partner_sign_sessions s SET
    from_signed_at = CASE WHEN l.side = 'from' THEN now() ELSE s.from_signed_at END,
    from_signer_name = CASE WHEN l.side = 'from' THEN NULLIF(btrim(p_signer_name), '') ELSE s.from_signer_name END,
    to_signed_at = CASE WHEN l.side = 'to' THEN now() ELSE s.to_signed_at END,
    to_signer_name = CASE WHEN l.side = 'to' THEN COALESCE(NULLIF(btrim(p_signer_name), ''), s.to_signer_name)
      ELSE s.to_signer_name END,
    status = CASE WHEN (l.side = 'from' AND s.to_signed_at IS NOT NULL) OR (l.side = 'to' AND s.from_signed_at IS NOT NULL)
      THEN 'done' ELSE 'signing' END,
    emitted_from = false, emitted_to = false, updated_at = now()
  WHERE s.id = p_session
  RETURNING s.status INTO v_status;
  RETURN v_status;
END $$;
--> statement-breakpoint
-- Một bên từ chối ký (đề xuất hoặc đang ký) ⇒ `declined` (reject hai bên, #13).
CREATE OR REPLACE FUNCTION hub.sign_session_decline(p_session uuid, p_reason text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM hub.sign_session_lock(p_session);
  IF (l.r).status = 'declined' THEN RETURN 'declined'; END IF;
  IF (l.r).status NOT IN ('proposed', 'accepted', 'signing') THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  UPDATE hub.partner_sign_sessions SET status = 'declined', cancel_side = l.side, cancel_reason = NULLIF(btrim(p_reason), ''),
    emitted_from = false, emitted_to = false, updated_at = now()
  WHERE id = p_session;
  RETURN 'declined';
END $$;
--> statement-breakpoint
-- "Huỷ phiên ký" (R#5) — một bên, khi phiên còn mở ⇒ `cancelled` (#14a: bên gửi draft, bên nhận draft "chờ bản sửa").
CREATE OR REPLACE FUNCTION hub.sign_session_cancel(p_session uuid, p_reason text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM hub.sign_session_lock(p_session);
  IF (l.r).status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF (l.r).status NOT IN ('proposed', 'accepted', 'signing') THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  UPDATE hub.partner_sign_sessions SET status = 'cancelled', cancel_side = l.side, cancel_reason = NULLIF(btrim(p_reason), ''),
    emitted_from = false, emitted_to = false, updated_at = now()
  WHERE id = p_session;
  RETURN 'cancelled';
END $$;
--> statement-breakpoint
-- Quá hạn ký: bên GỬI chọn Gửi lại (`resend` ⇒ #14b như #14a) / Dừng (`stop` ⇒ #14c reject hai bên). Chọn một lần.
CREATE OR REPLACE FUNCTION hub.sign_session_resolve(p_session uuid, p_choice text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM hub.sign_session_lock(p_session);
  IF l.side <> 'from' THEN RAISE EXCEPTION 'SESSION_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('resend', 'stop') THEN
    RAISE EXCEPTION 'sign_session_resolve: lựa chọn không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF (l.r).status = 'expired' AND (l.r).expire_choice = p_choice THEN RETURN p_choice; END IF;
  IF (l.r).status <> 'expired' OR (l.r).expire_choice IS NOT NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  UPDATE hub.partner_sign_sessions SET expire_choice = p_choice, emitted_from = false, emitted_to = false, updated_at = now()
  WHERE id = p_session;
  RETURN p_choice;
END $$;
--> statement-breakpoint
-- Xem phiên (hai bên): chỉ trạng thái, hạn, tên công ty + tên người ký hai bên — KHÔNG id tenant/user, không mailbox.
CREATE OR REPLACE FUNCTION hub.sign_session_mine(p_session uuid)
RETURNS TABLE (
  side text, status text, expire_choice text, reason text, accept_deadline_at timestamptz, sign_deadline_at timestamptz,
  from_company text, from_signer_name text, from_signed_at timestamptz,
  to_company text, to_signer_name text, to_signed_at timestamptz, cancel_side text, cancel_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  RETURN QUERY
  SELECT CASE WHEN v_tid = s.from_tenant THEN 'from' ELSE 'to' END, s.status, s.expire_choice, s.reason,
    s.accept_deadline_at, s.sign_deadline_at, fa.legal_name, s.from_signer_name, s.from_signed_at,
    ta.legal_name, s.to_signer_name, s.to_signed_at, s.cancel_side, s.cancel_reason
  FROM hub.partner_sign_sessions s
  LEFT JOIN admin.tenants fa ON fa.id = s.from_tenant
  LEFT JOIN admin.tenants ta ON ta.id = s.to_tenant
  WHERE s.id = p_session AND v_tid IS NOT NULL AND v_tid IN (s.from_tenant, s.to_tenant);
END $$;
--> statement-breakpoint
-- Phiên của các lần gửi (theo tập) mà tenant hiện tại là MỘT bên — bên nhận gắn HĐ nhận vào phiên lúc nhận lô (`receiveInbox`).
CREATE OR REPLACE FUNCTION hub.sign_session_by_mailbox(p_mailboxes uuid[])
RETURNS TABLE (mailbox_id uuid, session_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.mailbox_id, s.id FROM hub.partner_sign_sessions s
  WHERE s.mailbox_id = ANY(p_mailboxes)
    AND NULLIF(current_setting('app.tenant_id', true), '')::uuid IN (s.from_tenant, s.to_tenant);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.sign_session_propose(uuid, text, integer, integer, text), hub.sign_session_accept(uuid, text),
  hub.sign_session_fallback(uuid), hub.sign_session_mark_signed(uuid, text, text), hub.sign_session_decline(uuid, text),
  hub.sign_session_cancel(uuid, text), hub.sign_session_resolve(uuid, text), hub.sign_session_mine(uuid),
  hub.sign_session_by_mailbox(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.sign_session_propose(uuid, text, integer, integer, text), hub.sign_session_accept(uuid, text),
  hub.sign_session_fallback(uuid), hub.sign_session_mark_signed(uuid, text, text), hub.sign_session_decline(uuid, text),
  hub.sign_session_cancel(uuid, text), hub.sign_session_resolve(uuid, text), hub.sign_session_mine(uuid),
  hub.sign_session_by_mailbox(uuid[]) TO hub_rw;
--> statement-breakpoint
-- Role gói do packs.install tạo SAU hub ⇒ bỏ qua khi chưa có; gói cấp lại ở MIGC 0095.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT EXECUTE ON FUNCTION hub.sign_session_propose(uuid, text, integer, integer, text), hub.sign_session_accept(uuid, text),
      hub.sign_session_fallback(uuid), hub.sign_session_mark_signed(uuid, text, text), hub.sign_session_decline(uuid, text),
      hub.sign_session_cancel(uuid, text), hub.sign_session_resolve(uuid, text), hub.sign_session_mine(uuid),
  hub.sign_session_by_mailbox(uuid[]) TO contracts_rw;
  END IF;
END $$;
