-- CR-182 · đợt 2 · «Đối tác ký qua link riêng» (BR-C5). CHỈ THÊM, chạy lại được.
-- · `partner_sign_links`: MỘT link = một lần mời ký (token CHỈ lưu BĂM SHA-256, 32 byte). Thu hồi (`revoked_at`) khi «Gửi lại».
-- · `partner_quick_signatures`: chữ ký nhanh của đối tác (PNG ≤ 200 KB) gắn với link — KHÔNG phải chữ ký của người dùng nền tảng.
-- Truy cập công khai CHỈ qua hàm DEFINER theo BĂM token (bảng không lộ cho route công khai); role gói `contracts_rw` chỉ được gọi hàm.
-- Bản ký của đối tác: `sign_versions.signed_by` = NULL + `signer_contact_id` + `signer_label` («Đối tác: <tên liên hệ>»); dấu của đối tác ở `sign_marks`
-- dùng `quick_signature_id` (không có `user_signature_id`), `signer_id` = id liên hệ.
CREATE TABLE IF NOT EXISTS contracts.partner_sign_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  opened_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_sign_links_pkey PRIMARY KEY (id),
  CONSTRAINT partner_sign_links_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT partner_sign_links_hash_uq UNIQUE (token_hash),
  CONSTRAINT partner_sign_links_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT partner_sign_links_hash_ck CHECK (octet_length(token_hash) = 32),
  CONSTRAINT partner_sign_links_reason_ck CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 2000),
  CONSTRAINT partner_sign_links_end_ck CHECK (signed_at IS NULL OR declined_at IS NULL)
);
--> statement-breakpoint
-- «Link mới nhất của HĐ» (gửi lại thu hồi link cũ; trang HĐ/phiên ký hiện trạng thái link mới nhất).
CREATE INDEX IF NOT EXISTS partner_sign_links_contract_idx ON contracts.partner_sign_links (tenant_id, contract_id, created_at DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_sign_links');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.partner_quick_signatures (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  link_id uuid NOT NULL,
  method text NOT NULL,
  png bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_quick_signatures_pkey PRIMARY KEY (id),
  CONSTRAINT partner_quick_signatures_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT partner_quick_signatures_link_fk FOREIGN KEY (link_id, tenant_id)
    REFERENCES contracts.partner_sign_links (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT partner_quick_signatures_method_ck CHECK (method IN ('type', 'draw')),
  CONSTRAINT partner_quick_signatures_png_ck CHECK (octet_length(png) BETWEEN 1 AND 204800)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_quick_signatures_link_idx ON contracts.partner_quick_signatures (link_id, created_at DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_quick_signatures');
--> statement-breakpoint
-- Bản ký của đối tác (không có người dùng nền tảng).
ALTER TABLE contracts.sign_versions ALTER COLUMN signed_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.sign_versions ADD COLUMN IF NOT EXISTS signer_contact_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.sign_versions ADD COLUMN IF NOT EXISTS signer_label text;
--> statement-breakpoint
ALTER TABLE contracts.sign_versions DROP CONSTRAINT IF EXISTS sign_versions_signer_ck;
--> statement-breakpoint
ALTER TABLE contracts.sign_versions ADD CONSTRAINT sign_versions_signer_ck
  CHECK ((signed_by IS NULL) <> (signer_contact_id IS NULL) AND (signer_contact_id IS NULL OR char_length(signer_label) BETWEEN 1 AND 300));
--> statement-breakpoint
ALTER TABLE contracts.sign_marks ALTER COLUMN user_signature_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.sign_marks ADD COLUMN IF NOT EXISTS quick_signature_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.sign_marks DROP CONSTRAINT IF EXISTS sign_marks_quick_fk;
--> statement-breakpoint
ALTER TABLE contracts.sign_marks ADD CONSTRAINT sign_marks_quick_fk FOREIGN KEY (quick_signature_id, tenant_id)
  REFERENCES contracts.partner_quick_signatures (id, tenant_id);
--> statement-breakpoint
ALTER TABLE contracts.sign_marks DROP CONSTRAINT IF EXISTS sign_marks_sig_ck;
--> statement-breakpoint
ALTER TABLE contracts.sign_marks ADD CONSTRAINT sign_marks_sig_ck CHECK (user_signature_id IS NOT NULL OR quick_signature_id IS NOT NULL);
--> statement-breakpoint
-- Chỗ ký của Bên B được đánh dấu đã ký bằng `signed_version_id` (người ký = `sign_versions.signer_contact_id`), `signed_by` giữ NULL ⇒ chỉ ô Bên B được nới.
ALTER TABLE contracts.sign_fields DROP CONSTRAINT IF EXISTS sign_fields_signed_ck;
--> statement-breakpoint
ALTER TABLE contracts.sign_fields ADD CONSTRAINT sign_fields_signed_ck
  CHECK ((signed_by IS NULL) = (signed_version_id IS NULL) OR (side = 'B' AND signed_by IS NULL AND signed_version_id IS NOT NULL));
--> statement-breakpoint
-- ===== Hàm DEFINER (chủ migration, `search_path` cố định). Tra theo BĂM token; trạng thái: open | signed | declined | expired | revoked. =====
-- `partner_sign_link_open`: tra link + (audit ⇒) ghi `opened_at` lần đầu. 0 hàng ⇒ link không tồn tại.
CREATE OR REPLACE FUNCTION contracts.partner_sign_link_open(h bytea, audit boolean)
RETURNS TABLE (link_id uuid, tenant_id uuid, contract_id uuid, contact_id uuid, state text, expires_at timestamptz,
  sent_at timestamptz, opened_at timestamptz, signed_at timestamptz, declined_at timestamptz, decline_reason text, quick_id uuid, quick_method text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r contracts.partner_sign_links%ROWTYPE;
BEGIN
  SELECT * INTO r FROM contracts.partner_sign_links l WHERE l.token_hash = h;
  IF NOT FOUND THEN RETURN; END IF;
  IF audit AND r.opened_at IS NULL THEN
    UPDATE contracts.partner_sign_links l SET opened_at = now() WHERE l.id = r.id AND l.opened_at IS NULL RETURNING l.opened_at INTO r.opened_at;
  END IF;
  RETURN QUERY SELECT r.id, r.tenant_id, r.contract_id, r.contact_id,
    CASE WHEN r.revoked_at IS NOT NULL THEN 'revoked' WHEN r.signed_at IS NOT NULL THEN 'signed' WHEN r.declined_at IS NOT NULL THEN 'declined'
      WHEN r.expires_at <= now() THEN 'expired' ELSE 'open' END,
    r.expires_at, r.sent_at, r.opened_at, r.signed_at, r.declined_at, r.decline_reason,
    q.id, q.method
    FROM (SELECT 1) x LEFT JOIN LATERAL (SELECT k.id, k.method FROM contracts.partner_quick_signatures k
      WHERE k.link_id = r.id AND k.tenant_id = r.tenant_id ORDER BY k.created_at DESC, k.id DESC LIMIT 1) q ON true;
END $$;
--> statement-breakpoint
-- Chữ ký nhanh mới nhất của link — CHỈ khi link còn `open`. Ghi thêm hàng mới (giữ lịch sử), tối đa 20 mỗi link; 'ok' | 'gone' | 'closed' | 'limit' | 'invalid'.
CREATE OR REPLACE FUNCTION contracts.partner_sign_quick_put(h bytea, m text, p bytea) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r contracts.partner_sign_links%ROWTYPE;
BEGIN
  SELECT * INTO r FROM contracts.partner_sign_links l WHERE l.token_hash = h FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF r.revoked_at IS NOT NULL OR r.expires_at <= now() THEN RETURN 'gone'; END IF;
  IF r.signed_at IS NOT NULL OR r.declined_at IS NOT NULL THEN RETURN 'closed'; END IF;
  IF (SELECT count(*) FROM contracts.partner_quick_signatures k WHERE k.link_id = r.id AND k.tenant_id = r.tenant_id) >= 20 THEN RETURN 'limit'; END IF;
  INSERT INTO contracts.partner_quick_signatures (tenant_id, link_id, method, png) VALUES (r.tenant_id, r.id, m, p);
  RETURN 'ok';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.partner_sign_quick_get(h bytea) RETURNS TABLE (id uuid, png bytea)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT k.id, k.png FROM contracts.partner_sign_links l
    JOIN contracts.partner_quick_signatures k ON k.link_id = l.id AND k.tenant_id = l.tenant_id
   WHERE l.token_hash = h ORDER BY k.created_at DESC, k.id DESC LIMIT 1
$$;
--> statement-breakpoint
-- Chốt link: 'sign' (đã ký đủ) hoặc 'decline' (kèm lý do). CAS theo trạng thái ⇒ 'ok' | 'closed' | 'gone' | 'invalid'.
CREATE OR REPLACE FUNCTION contracts.partner_sign_finish(h bytea, how text, why text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r contracts.partner_sign_links%ROWTYPE;
BEGIN
  SELECT * INTO r FROM contracts.partner_sign_links l WHERE l.token_hash = h FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF r.revoked_at IS NOT NULL OR r.expires_at <= now() THEN RETURN 'gone'; END IF;
  IF r.signed_at IS NOT NULL OR r.declined_at IS NOT NULL THEN RETURN 'closed'; END IF;
  IF how = 'sign' THEN UPDATE contracts.partner_sign_links SET signed_at = now() WHERE id = r.id;
  ELSIF how = 'decline' THEN UPDATE contracts.partner_sign_links SET declined_at = now(), decline_reason = left(why, 2000) WHERE id = r.id;
  ELSE RETURN 'invalid'; END IF;
  RETURN 'ok';
END $$;
--> statement-breakpoint
-- Khoá hàng link (FOR UPDATE) đầu tx Lưu/chốt: hai lần Lưu song song nối đuôi nhau, và «Trả lại» (thu hồi link) đợi lần Lưu đang chạy. Trả trạng thái.
CREATE OR REPLACE FUNCTION contracts.partner_sign_lock(h bytea) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r contracts.partner_sign_links%ROWTYPE;
BEGIN
  SELECT * INTO r FROM contracts.partner_sign_links l WHERE l.token_hash = h FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  RETURN CASE WHEN r.revoked_at IS NOT NULL THEN 'revoked' WHEN r.signed_at IS NOT NULL THEN 'signed' WHEN r.declined_at IS NOT NULL THEN 'declined'
    WHEN r.expires_at <= now() THEN 'expired' ELSE 'open' END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.partner_sign_link_open(bytea, boolean), contracts.partner_sign_quick_put(bytea, text, bytea),
  contracts.partner_sign_quick_get(bytea), contracts.partner_sign_finish(bytea, text, text), contracts.partner_sign_lock(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.partner_sign_link_open(bytea, boolean), contracts.partner_sign_quick_put(bytea, text, bytea),
  contracts.partner_sign_quick_get(bytea), contracts.partner_sign_finish(bytea, text, text), contracts.partner_sign_lock(bytea) TO contracts_rw;
