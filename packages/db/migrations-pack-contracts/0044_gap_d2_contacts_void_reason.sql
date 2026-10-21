-- GAP-D2 · #24 nhiều người liên hệ của đối tác (thay điện thoại + liên hệ đơn của 0037) · #25 lý do khi huỷ một dòng sổ đối tác.
-- Chỉ cộng thêm; chạy lại vô hại. `partner_contacts`: RLS FORCE theo tenant (`packs.secure_table`) + M1 như `partner_notes` (0024):
-- chế độ org chỉ thấy/ghi liên hệ của đối tác mình thấy hoặc do mình tạo. Không UPDATE (ghi = thay cả danh sách của một đối tác).
-- Dữ liệu cũ: mỗi dòng danh bạ có điện thoại / liên hệ ⇒ một người liên hệ (cột cũ giữ nguyên, chỉ còn là dự phòng khi đọc).
CREATE TABLE IF NOT EXISTS contracts.partner_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  name text NOT NULL,
  role text,
  phone text,
  email text,
  our_owner text,
  sort integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_contacts_pkey PRIMARY KEY (id),
  CONSTRAINT partner_contacts_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300 AND char_length(name) BETWEEN 1 AND 120
    AND char_length(role) <= 120 AND char_length(phone) <= 30 AND char_length(email) <= 200 AND char_length(our_owner) <= 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_contacts_party_idx ON contracts.partner_contacts (tenant_id, party_key, sort, created_at, id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_contacts');
--> statement-breakpoint
REVOKE UPDATE ON contracts.partner_contacts FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS partner_contacts_visible ON contracts.partner_contacts;
--> statement-breakpoint
CREATE POLICY partner_contacts_visible ON contracts.partner_contacts AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
DROP POLICY IF EXISTS partner_contacts_visible_del ON contracts.partner_contacts;
--> statement-breakpoint
CREATE POLICY partner_contacts_visible_del ON contracts.partner_contacts AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
DROP POLICY IF EXISTS partner_contacts_ins ON contracts.partner_contacts;
--> statement-breakpoint
CREATE POLICY partner_contacts_ins ON contracts.partner_contacts AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT contracts.sees_all())
    OR (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND (party_key = ANY ((SELECT contracts.visible_party_keys())::text[])
        OR EXISTS (SELECT 1 FROM contracts.partner_roles r
          WHERE r.tenant_id = partner_contacts.tenant_id AND r.party_key = partner_contacts.party_key)
        OR EXISTS (SELECT 1 FROM contracts.companies co
          WHERE co.tenant_id = partner_contacts.tenant_id AND co.party_key = partner_contacts.party_key))));
--> statement-breakpoint
INSERT INTO contracts.partner_contacts (tenant_id, party_key, name, phone, created_by)
SELECT co.tenant_id, co.party_key, coalesce(nullif(btrim(co.contact_person), ''), btrim(co.phone)), nullif(btrim(co.phone), ''), co.created_by
FROM contracts.companies co
WHERE (nullif(btrim(co.contact_person), '') IS NOT NULL OR nullif(btrim(co.phone), '') IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM contracts.partner_contacts pc WHERE pc.tenant_id = co.tenant_id AND pc.party_key = co.party_key);
--> statement-breakpoint
ALTER TABLE contracts.partner_event_voids ADD COLUMN IF NOT EXISTS reason text;
--> statement-breakpoint
ALTER TABLE contracts.partner_event_voids DROP CONSTRAINT IF EXISTS partner_event_voids_reason_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_event_voids ADD CONSTRAINT partner_event_voids_reason_ck CHECK (char_length(reason) <= 500);
