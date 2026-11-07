-- CR-124 · q5 · FLOW4-FR-12/13 · spec §8 · NFR-01/02/03 · đường email cho bên nhận chưa dùng nền tảng. Chỉ cộng thêm; chạy lại vô hại.
-- (1) `hub.partner_mailbox` thêm cột gửi email (thuê dòng + số lần thử + lỗi). Token (256-bit ngẫu nhiên, sinh ở app) CHỈ lưu băm SHA-256 ở `token_hash`
--     (0117); bản rõ chỉ nằm trong email. Một lần gửi (một vòng) = một dòng = một token; gửi lại sau Trả lại = dòng mới = token mới.
-- (2) `hub.partner_email_events` — NHẬT KÝ (append-only) mỗi lần gửi/mở/trả lời: IP rút gọn, user-agent, tên + chức vụ người trả lời, băm PDF.
--     RLS bật, chỉ policy scope system; bên gửi đọc qua hàm DEFINER `partner_email_history` (kiểm from_tenant = tenant hiện tại).
-- (3) `partner_reply_apply` — MỘT nơi chuyển dòng sang `replied` (dùng chung `partner_reply` của người dùng/ghi tay và `partner_email_reply` của link
--     email) ⇒ bộ chuyển/tín hiệu `partner.*` y hệt q3. `partner_reply` chỉ còn kiểm tenant rồi gọi `apply` (hành vi không đổi).
-- (4) `partner_email_claim` (bộ gửi email, scope system) · `partner_email_view` / `partner_email_reply` (trang công khai, scope system; tra theo BĂM token,
--     không cần tenant). Mọi hàm: DEFINER, search_path cố định, REVOKE PUBLIC, kiểm `app.scope = 'system'` hoặc `app.tenant_id`.
-- Trạng thái link: open (còn hạn, chưa trả lời) · replied (đã trả lời qua email, chỉ XEM 7 ngày) · closed (bên gửi đã ghi nhận thủ công / đóng) ·
--     expired (quá hạn trả lời, còn 7 ngày hiện "liên hệ <công ty gửi>") · khác ⇒ không có dòng (link không hợp lệ).
ALTER TABLE hub.partner_mailbox ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE hub.partner_mailbox ADD COLUMN IF NOT EXISTS email_lease_until timestamptz;
--> statement-breakpoint
ALTER TABLE hub.partner_mailbox ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.partner_mailbox ADD COLUMN IF NOT EXISTS email_error text;
--> statement-breakpoint
-- Lô gửi email: dòng kênh email chưa gửi (bộ gửi lấy theo thuê, SKIP LOCKED).
CREATE INDEX IF NOT EXISTS partner_mailbox_email_idx ON hub.partner_mailbox (created_at)
  WHERE channel = 'email' AND status = 'sent' AND email_sent_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.partner_email_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mailbox_id uuid NOT NULL,
  event text NOT NULL,
  ip_prefix text,
  user_agent text,
  actor_name text,
  actor_title text,
  pdf_sha256 text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_email_events_pkey PRIMARY KEY (id),
  CONSTRAINT partner_email_events_mailbox_fk FOREIGN KEY (mailbox_id) REFERENCES hub.partner_mailbox (id),
  CONSTRAINT partner_email_events_event_ck CHECK (event IN ('sent', 'error', 'opened', 'replied')),
  CONSTRAINT partner_email_events_text_ck CHECK (
    (ip_prefix IS NULL OR length(ip_prefix) <= 64) AND (user_agent IS NULL OR length(user_agent) <= 200)
    AND (actor_name IS NULL OR length(actor_name) <= 120) AND (actor_title IS NULL OR length(actor_title) <= 120)
    AND (detail IS NULL OR length(detail) <= 300)),
  CONSTRAINT partner_email_events_sha_ck CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_email_events_mailbox_idx ON hub.partner_email_events (mailbox_id, created_at);
--> statement-breakpoint
ALTER TABLE hub.partner_email_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'partner_email_events'
                 AND policyname = 'partner_email_events_system') THEN
    CREATE POLICY partner_email_events_system ON hub.partner_email_events FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system')
      WITH CHECK (current_setting('app.scope', true) = 'system');
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.partner_email_events TO hub_rw;
--> statement-breakpoint
-- partner_reply_apply: chuyển dòng sang 'replied'. NỘI BỘ (không cấp EXECUTE cho ai; chỉ hàm DEFINER cùng chủ gọi). Người gọi đã kiểm quyền.
-- true = vừa ghi; false = gọi lại cùng kết quả (idempotent); đã trả lời khác / hết hạn / đóng ⇒ 55000.
CREATE OR REPLACE FUNCTION hub.partner_reply_apply(
  p_id uuid, p_outcome text, p_reason text, p_source text, p_evidence jsonb, p_uid uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m hub.partner_mailbox%ROWTYPE;
BEGIN
  SELECT * INTO m FROM hub.partner_mailbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_reply: lần gửi không thuộc tenant hiện tại' USING ERRCODE = '42501';
  END IF;
  IF m.status = 'replied' AND m.outcome = p_outcome AND m.replied_by_source = p_source THEN
    RETURN false;
  END IF;
  IF m.status NOT IN ('sent', 'delivered') OR m.expires_at <= now() THEN
    RAISE EXCEPTION 'partner_reply: lần gửi đã %', m.status USING ERRCODE = '55000';
  END IF;
  IF p_source = 'manual' AND m.channel = 'manual'
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p_evidence->'files') = 'array'
                                          THEN p_evidence->'files' END), 0) = 0 THEN
    RAISE EXCEPTION 'partner_reply: ghi nhận thủ công cần ít nhất một tệp bằng chứng' USING ERRCODE = '22023';
  END IF;
  UPDATE hub.partner_mailbox
     SET status = 'replied', outcome = p_outcome, reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         replied_by_source = p_source,
         -- `recorded_by` luôn do hàm đặt từ `p_uid` (khoá người gọi gửi lên bị bỏ — chống mạo danh người ghi).
         evidence = CASE WHEN p_evidence IS NULL AND p_uid IS NULL THEN NULL
                         ELSE (COALESCE(p_evidence, '{}'::jsonb) - 'recorded_by')
                              || jsonb_strip_nulls(jsonb_build_object('recorded_by', p_uid)) END,
         replied_at = now(), updated_at = now()
   WHERE id = m.id;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_reply_apply(uuid, text, text, text, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
-- partner_reply (cùng chữ ký như 0117): kiểm đầu vào + tenant rồi giao cho `partner_reply_apply`.
CREATE OR REPLACE FUNCTION hub.partner_reply(
  p_mailbox_id uuid,
  p_outcome text,
  p_reason text,
  p_source text,
  p_evidence jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  m hub.partner_mailbox%ROWTYPE;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_reply: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_source = 'email' THEN
    -- Đường link email đi qua `hub.partner_email_reply` (tra theo băm token, không cần tenant) — không mở cho người dùng gói.
    RAISE EXCEPTION 'partner_reply: nguồn email chỉ qua link trả lời' USING ERRCODE = '0A000';
  END IF;
  IF p_source IS DISTINCT FROM 'receiver_flow' AND p_source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'partner_reply: nguồn % không hợp lệ', p_source USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed', 'returned', 'declined') THEN
    RAISE EXCEPTION 'partner_reply: kết quả % không hợp lệ', p_outcome USING ERRCODE = '22023';
  END IF;
  IF p_outcome <> 'confirmed' AND length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'partner_reply: Trả lại / Từ chối cần lý do' USING ERRCODE = '22023';
  END IF;
  IF p_source = 'manual' AND v_uid IS NULL THEN
    RAISE EXCEPTION 'partner_reply: ghi nhận thủ công cần người ghi (app.user_id)' USING ERRCODE = '42501';
  END IF;
  IF p_evidence IS NOT NULL AND (jsonb_typeof(p_evidence) <> 'object' OR pg_column_size(p_evidence) > 65536
     OR (jsonb_typeof(p_evidence->'files') = 'array' AND jsonb_array_length(p_evidence->'files') > 20)) THEN
    RAISE EXCEPTION 'partner_reply: bằng chứng quá lớn (≤ 64 KB, ≤ 20 tệp)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM hub.partner_mailbox WHERE id = p_mailbox_id FOR UPDATE;
  IF NOT FOUND
     OR (p_source = 'receiver_flow' AND (m.channel <> 'platform' OR m.to_tenant IS DISTINCT FROM v_tid))
     OR (p_source = 'manual' AND m.from_tenant IS DISTINCT FROM v_tid) THEN
    RAISE EXCEPTION 'partner_reply: lần gửi không thuộc tenant hiện tại' USING ERRCODE = '42501';
  END IF;
  RETURN hub.partner_reply_apply(m.id, p_outcome, p_reason, p_source, p_evidence, v_uid);
END $$;
--> statement-breakpoint
-- partner_email_claim: bộ gửi email (scope system). Thuê tối đa `p_limit` dòng kênh email chưa gửi (SKIP LOCKED, thuê `p_lease_s` giây, +1 lần thử,
-- tối đa 5) và trả thông tin để dựng thư: tên pháp lý + dấu xác minh CÔNG KHAI của bên gửi, bản chia sẻ, lý do lần trước.
CREATE OR REPLACE FUNCTION hub.partner_email_claim(p_limit integer, p_lease_s integer)
RETURNS TABLE (
  id uuid, from_tenant uuid, to_email text, round integer, payload jsonb, file_ref text, expires_at timestamptz,
  prev_reason text, sender_name text, sender_verified boolean, attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'partner_email_claim: chỉ scope system' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT m.id FROM hub.partner_mailbox m
     WHERE m.channel = 'email' AND m.status = 'sent' AND m.email_sent_at IS NULL AND m.expires_at > now()
       AND m.email_attempts < 5 AND (m.email_lease_until IS NULL OR m.email_lease_until < now())
     ORDER BY m.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE hub.partner_mailbox m
       SET email_lease_until = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_s, 120), 10), 900)),
           email_attempts = m.email_attempts + 1, updated_at = now()
      FROM c WHERE m.id = c.id
    RETURNING m.id, m.from_tenant, m.to_email, m.round, m.payload, m.file_ref, m.expires_at, m.prev_id, m.email_attempts
  )
  SELECT u.id, u.from_tenant, u.to_email, u.round, u.payload, u.file_ref, u.expires_at,
         (SELECT p.reason FROM hub.partner_mailbox p WHERE p.id = u.prev_id AND p.from_tenant = u.from_tenant),
         t.legal_name, t.directory_verified_at IS NOT NULL, u.email_attempts
    FROM u LEFT JOIN admin.tenants t ON t.id = u.from_tenant;
END $$;
--> statement-breakpoint
-- partner_email_view: trang công khai tra theo BĂM token (32 byte). Không có dòng = link không hợp lệ (không phân biệt sai/hết hạn xa).
-- Nội dung (payload/file_ref/pdf) CHỈ khi state ∈ {open, replied}; expired/closed chỉ trả tên bên gửi. `p_audit` ghi sự kiện 'opened'.
CREATE OR REPLACE FUNCTION hub.partner_email_view(p_hash bytea, p_ip text, p_ua text, p_audit boolean)
RETURNS TABLE (
  mailbox_id uuid, from_tenant uuid, state text, round integer, payload jsonb, file_ref text, pdf_sha256 text,
  expires_at timestamptz, outcome text, reason text, prev_reason text, sender_name text, sender_tax_code text,
  sender_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m hub.partner_mailbox%ROWTYPE;
  v_state text;
  v_full boolean;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'partner_email_view: chỉ scope system' USING ERRCODE = '42501';
  END IF;
  IF p_hash IS NULL OR length(p_hash) <> 32 THEN
    RETURN;
  END IF;
  SELECT * INTO m FROM hub.partner_mailbox x WHERE x.token_hash = p_hash AND x.channel = 'email';
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_state := CASE
    WHEN m.status = 'replied' AND m.replied_by_source = 'email' THEN
      CASE WHEN m.replied_at > now() - interval '7 days' THEN 'replied' END
    WHEN m.status = 'closed' OR m.status = 'replied' THEN
      CASE WHEN m.updated_at > now() - interval '7 days' THEN 'closed' END
    WHEN m.status IN ('sent', 'delivered') AND m.expires_at > now() THEN 'open'
    ELSE CASE WHEN m.expires_at > now() - interval '7 days' THEN 'expired' END
  END;
  IF v_state IS NULL THEN
    RETURN;
  END IF;
  v_full := v_state IN ('open', 'replied');
  IF p_audit THEN
    INSERT INTO hub.partner_email_events (mailbox_id, event, ip_prefix, user_agent)
    VALUES (m.id, 'opened', left(p_ip, 64), left(p_ua, 200));
  END IF;
  RETURN QUERY
  SELECT m.id, m.from_tenant, v_state, m.round,
         CASE WHEN v_full THEN m.payload END, CASE WHEN v_full THEN m.file_ref END,
         CASE WHEN v_full THEN m.pdf_sha256 END, m.expires_at,
         CASE WHEN v_state = 'replied' THEN m.outcome END, CASE WHEN v_state = 'replied' THEN m.reason END,
         CASE WHEN v_full THEN (SELECT p.reason FROM hub.partner_mailbox p
                                 WHERE p.id = m.prev_id AND p.from_tenant = m.from_tenant) END,
         t.legal_name, CASE WHEN v_full THEN t.tax_code END, t.directory_verified_at IS NOT NULL
    FROM (SELECT 1) one LEFT JOIN admin.tenants t ON t.id = m.from_tenant;
END $$;
--> statement-breakpoint
-- partner_email_reply: trả lời từ trang công khai. Trả mã: ok (vừa ghi) · same (gửi lại cùng kết quả) · conflict (đã trả lời kết quả khác) ·
-- closed (bên gửi đã đóng/ghi thủ công) · expired (quá hạn) · invalid (băm không khớp). Ghi qua `partner_reply_apply` (nguồn 'email') + nhật ký.
CREATE OR REPLACE FUNCTION hub.partner_email_reply(
  p_hash bytea, p_outcome text, p_reason text, p_name text, p_title text, p_ip text, p_ua text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m hub.partner_mailbox%ROWTYPE;
  v_name text := btrim(COALESCE(p_name, ''));
  v_title text := btrim(COALESCE(p_title, ''));
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'partner_email_reply: chỉ scope system' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed', 'returned', 'declined') THEN
    RAISE EXCEPTION 'partner_email_reply: kết quả % không hợp lệ', p_outcome USING ERRCODE = '22023';
  END IF;
  IF p_outcome <> 'confirmed' AND length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'partner_email_reply: Trả lại / Từ chối cần lý do' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) > 2000 THEN
    RAISE EXCEPTION 'partner_email_reply: lý do quá dài (≤ 2000)' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 OR length(v_title) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'partner_email_reply: cần họ tên và chức vụ (2–120 ký tự)' USING ERRCODE = '22023';
  END IF;
  IF p_hash IS NULL OR length(p_hash) <> 32 THEN
    RETURN 'invalid';
  END IF;
  SELECT * INTO m FROM hub.partner_mailbox x WHERE x.token_hash = p_hash AND x.channel = 'email' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;
  IF m.status = 'replied' AND m.replied_by_source = 'email' THEN
    RETURN CASE WHEN m.outcome = p_outcome THEN 'same' ELSE 'conflict' END;
  END IF;
  IF m.status IN ('closed', 'replied') THEN
    RETURN 'closed';
  END IF;
  IF m.status NOT IN ('sent', 'delivered') OR m.expires_at <= now() THEN
    RETURN 'expired';
  END IF;
  PERFORM hub.partner_reply_apply(
    m.id, p_outcome, p_reason, 'email',
    jsonb_build_object('actor_name', v_name, 'actor_title', v_title, 'ip_prefix', left(p_ip, 64),
                       'pdf_sha256', m.pdf_sha256, 'via', 'email_link'),
    NULL);
  INSERT INTO hub.partner_email_events (mailbox_id, event, ip_prefix, user_agent, actor_name, actor_title, pdf_sha256, detail)
  VALUES (m.id, 'replied', left(p_ip, 64), left(p_ua, 200), v_name, v_title, m.pdf_sha256, p_outcome);
  RETURN 'ok';
END $$;
--> statement-breakpoint
-- partner_email_history: nhật ký gửi/mở/trả lời của MỘT lần gửi — chỉ bên GỬI (from_tenant = tenant hiện tại); tenant khác ⇒ 42501.
CREATE OR REPLACE FUNCTION hub.partner_email_history(p_mailbox_id uuid)
RETURNS TABLE (
  event text, ip_prefix text, user_agent text, actor_name text, actor_title text, pdf_sha256 text, detail text,
  created_at timestamptz
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
    RAISE EXCEPTION 'partner_email_history: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub.partner_mailbox m WHERE m.id = p_mailbox_id AND m.from_tenant = v_tid) THEN
    RAISE EXCEPTION 'partner_email_history: lần gửi không thuộc tenant hiện tại' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.event, e.ip_prefix, e.user_agent, e.actor_name, e.actor_title, e.pdf_sha256, e.detail, e.created_at
    FROM hub.partner_email_events e WHERE e.mailbox_id = p_mailbox_id ORDER BY e.created_at, e.id LIMIT 200;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_reply(uuid, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_email_claim(integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_email_view(bytea, text, text, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_email_reply(bytea, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_email_history(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_reply(uuid, text, text, text, jsonb) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_email_claim(integer, integer),
  hub.partner_email_view(bytea, text, text, boolean),
  hub.partner_email_reply(bytea, text, text, text, text, text, text),
  hub.partner_email_history(uuid) TO hub_rw;
--> statement-breakpoint
-- Role gói (`contracts_rw`) do packs.install tạo SAU hub ⇒ bỏ qua khi chưa có; chỉ cấp hàm nhật ký cho bên GỬI (hàm tự kiểm tenant).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_reply(uuid, text, text, text, jsonb) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_email_history(uuid) TO contracts_rw;
  END IF;
END $$;
