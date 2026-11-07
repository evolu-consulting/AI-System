-- CR-124 · q1 · FLOW4-FR-07/11/16 · NFR-01/02/03 · Hộp thư liên công ty `hub.partner_mailbox` (spec §7, §8b).
-- (1) Một dòng mỗi lần gửi A → B: chỉ BẢN CHIA SẺ (`payload` = trường A chọn + lời nhắn + tên công khai A, `file_ref`, `pdf_sha256`).
--     `from_ref` = ref bản ghi phía A (chỉ dùng phát kết quả về A) — KHÔNG bao giờ trả cho B.
-- (2) RLS bật, KHÔNG policy nào cho role gói / scope user. Chỉ `hub_rw` ở scope `system` (bộ chuyển) đọc/ghi thẳng bảng.
-- (3) Người dùng/gói chỉ đi qua 3 hàm SECURITY DEFINER (search_path cố định, REVOKE PUBLIC, kiểm `app.tenant_id` như
--     `hub.emit_flow_event`): `partner_send` (from = tenant hiện tại), `partner_reply` (receiver_flow: to = tenant hiện tại;
--     manual: from = tenant hiện tại), `partner_mailbox_mine` (chỉ cột trạng thái, dòng của mình).
-- (4) Bộ chuyển (hub-api `partners/`): `sent` (kênh platform) ⇒ `contract.received` vào tenant B + `delivered`; `replied` ⇒
--     `partner.<outcome>` vào tenant A + `reply_emitted_at`. event_id theo `mailbox.id` ⇒ chạy lại / 2 Hub vẫn một sự kiện.
-- Role gói (`contracts_rw`) do `packs.install` tạo SAU hub ⇒ khối GRANT cuối bỏ qua khi chưa có; gói cấp lại ở migration gói (q3).
CREATE TABLE IF NOT EXISTS hub.partner_mailbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_tenant uuid NOT NULL,
  to_tenant uuid,
  to_email text,
  channel text NOT NULL,
  from_ref text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_ref text,
  pdf_sha256 text,
  status text NOT NULL DEFAULT 'sent',
  outcome text,
  reason text,
  replied_by_source text,
  evidence jsonb,
  round integer NOT NULL DEFAULT 1,
  prev_id uuid,
  expires_at timestamptz NOT NULL,
  token_hash bytea,
  replied_at timestamptz,
  reply_emitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_mailbox_pkey PRIMARY KEY (id),
  CONSTRAINT partner_mailbox_prev_fk FOREIGN KEY (prev_id) REFERENCES hub.partner_mailbox (id),
  CONSTRAINT partner_mailbox_channel_ck CHECK (channel IN ('platform', 'email', 'manual')),
  CONSTRAINT partner_mailbox_status_ck CHECK (status IN ('sent', 'delivered', 'replied', 'expired', 'closed')),
  CONSTRAINT partner_mailbox_outcome_ck CHECK (outcome IS NULL OR outcome IN ('confirmed', 'returned', 'declined')),
  CONSTRAINT partner_mailbox_source_ck CHECK (
    replied_by_source IS NULL OR replied_by_source IN ('receiver_flow', 'email', 'manual')),
  CONSTRAINT partner_mailbox_replied_ck CHECK (
    status <> 'replied' OR (outcome IS NOT NULL AND replied_by_source IS NOT NULL AND replied_at IS NOT NULL)),
  CONSTRAINT partner_mailbox_target_ck CHECK (
    (channel <> 'platform' OR to_tenant IS NOT NULL) AND (channel <> 'email' OR to_email IS NOT NULL)),
  CONSTRAINT partner_mailbox_self_ck CHECK (to_tenant IS DISTINCT FROM from_tenant),
  CONSTRAINT partner_mailbox_email_ck CHECK (to_email IS NULL OR (length(to_email) <= 320 AND to_email LIKE '%_@_%')),
  CONSTRAINT partner_mailbox_from_ref_ck CHECK (from_ref IS NULL OR length(from_ref) BETWEEN 1 AND 200),
  CONSTRAINT partner_mailbox_payload_ck CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  CONSTRAINT partner_mailbox_evidence_ck CHECK (evidence IS NULL OR jsonb_typeof(evidence) = 'object'),
  CONSTRAINT partner_mailbox_sha_ck CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT partner_mailbox_file_ref_ck CHECK (file_ref IS NULL OR length(file_ref) BETWEEN 1 AND 500),
  CONSTRAINT partner_mailbox_reason_ck CHECK (reason IS NULL OR length(reason) <= 2000),
  CONSTRAINT partner_mailbox_round_ck CHECK (round BETWEEN 1 AND 1000),
  CONSTRAINT partner_mailbox_token_ck CHECK (token_hash IS NULL OR length(token_hash) = 32)
);
--> statement-breakpoint
-- Bộ chuyển: `status = 'sent'|'replied'` theo `created_at` (lô SKIP LOCKED).
CREATE INDEX IF NOT EXISTS partner_mailbox_move_idx ON hub.partner_mailbox (status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_mailbox_from_idx ON hub.partner_mailbox (from_tenant, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_mailbox_to_idx ON hub.partner_mailbox (to_tenant, created_at DESC)
  WHERE to_tenant IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_mailbox_token_uq ON hub.partner_mailbox (token_hash)
  WHERE token_hash IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.partner_mailbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- CHỈ scope system (bộ chuyển). Không policy cho scope user ⇒ hub_rw của request người dùng thấy 0 dòng, ghi ⇒ 42501.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'partner_mailbox'
                 AND policyname = 'partner_mailbox_system') THEN
    CREATE POLICY partner_mailbox_system ON hub.partner_mailbox FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system')
      WITH CHECK (current_setting('app.scope', true) = 'system');
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, UPDATE ON hub.partner_mailbox TO hub_rw;
--> statement-breakpoint
-- partner_send: gọi trong tx của A; chỉ ghi from_tenant = tenant hiện tại. Kiểm B cho phép (§4) + nối (§5) + hạn mức: TODO q2/q3.
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
BEGIN
  IF v_tid IS NULL OR p_from_tenant IS DISTINCT FROM v_tid THEN
    RAISE EXCEPTION 'partner_send: tenant % không phải tenant hiện tại', p_from_tenant USING ERRCODE = '42501';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'partner_send: hạn trả lời phải trong 30 ngày tới' USING ERRCODE = '22023';
  END IF;
  IF p_prev_id IS NOT NULL THEN
    -- Gửi lại sau Trả lại (FLOW4-FR-17): lần trước phải là của chính A, cùng bên nhận.
    SELECT m.round + 1 INTO v_round FROM hub.partner_mailbox m
     WHERE m.id = p_prev_id AND m.from_tenant = v_tid
       AND m.to_tenant IS NOT DISTINCT FROM p_to_tenant AND m.to_email IS NOT DISTINCT FROM p_to_email;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_send: lần gửi trước không thuộc tenant hiện tại' USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO hub.partner_mailbox (from_tenant, to_tenant, to_email, channel, from_ref, payload, file_ref, pdf_sha256,
                                   expires_at, round, prev_id)
  VALUES (v_tid, p_to_tenant, p_to_email, p_channel, p_from_ref, COALESCE(p_payload, '{}'::jsonb), p_file_ref,
          p_pdf_sha256, p_expires_at, v_round, p_prev_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
-- partner_reply: receiver_flow ⇒ to_tenant = tenant hiện tại (OutcomeHandler của B); manual ⇒ from_tenant = tenant hiện tại
-- (A ghi câu trả lời của đối tác, §8b; kênh manual cần ≥ 1 tệp bằng chứng). Trả TRUE khi ghi, FALSE khi gọi lại cùng kết quả
-- (idempotent). Không thấy / sai tenant ⇒ 42501 (không lộ dòng có tồn tại); đã trả lời khác / hết hạn / đóng ⇒ 55000.
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
    -- TODO(CR-124 q5): đường token email (so băm thời gian hằng, không cần tenant) là hàm riêng; chưa mở ở q1.
    RAISE EXCEPTION 'partner_reply: đường email chưa hỗ trợ' USING ERRCODE = '0A000';
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
  SELECT * INTO m FROM hub.partner_mailbox WHERE id = p_mailbox_id FOR UPDATE;
  IF NOT FOUND
     OR (p_source = 'receiver_flow' AND m.to_tenant IS DISTINCT FROM v_tid)
     OR (p_source = 'manual' AND m.from_tenant IS DISTINCT FROM v_tid) THEN
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
         evidence = CASE WHEN p_evidence IS NULL AND v_uid IS NULL THEN NULL
                         ELSE COALESCE(p_evidence, '{}'::jsonb)
                              || jsonb_strip_nulls(jsonb_build_object('recorded_by', v_uid)) END,
         replied_at = now(), updated_at = now()
   WHERE id = m.id;
  RETURN true;
END $$;
--> statement-breakpoint
-- partner_mailbox_mine: dòng mà tenant hiện tại là bên gửi ('out') hoặc nhận ('in'); CHỈ cột trạng thái. `from_ref` chỉ cho 'out'.
CREATE OR REPLACE FUNCTION hub.partner_mailbox_mine(p_limit integer DEFAULT 200)
RETURNS TABLE (
  id uuid, direction text, from_tenant uuid, to_tenant uuid, channel text, from_ref text, status text, outcome text,
  reason text, replied_by_source text, round integer, prev_id uuid, expires_at timestamptz, replied_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_mailbox_mine: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM (
    (SELECT m.id, 'out'::text, m.from_tenant, m.to_tenant, m.channel, m.from_ref, m.status, m.outcome, m.reason,
            m.replied_by_source, m.round, m.prev_id, m.expires_at, m.replied_at, m.created_at, m.updated_at
       FROM hub.partner_mailbox m WHERE m.from_tenant = v_tid ORDER BY m.created_at DESC LIMIT v_lim)
    UNION ALL
    (SELECT m.id, 'in'::text, m.from_tenant, m.to_tenant, m.channel, NULL::text, m.status, m.outcome, m.reason,
            m.replied_by_source, m.round, m.prev_id, m.expires_at, m.replied_at, m.created_at, m.updated_at
       FROM hub.partner_mailbox m WHERE m.to_tenant = v_tid ORDER BY m.created_at DESC LIMIT v_lim)
  ) x ORDER BY 15 DESC LIMIT v_lim;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_send(uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_reply(uuid, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_mailbox_mine(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_send(uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_reply(uuid, text, text, text, jsonb) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_mailbox_mine(integer) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_send(uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid)
      TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_reply(uuid, text, text, text, jsonb) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.partner_mailbox_mine(integer) TO contracts_rw;
  END IF;
END $$;
