-- V2-C · KN-08 · HD-10 · BA 5.6a-d · DT-05 · intake C11 (làn đầy đủ): đối tác nhiều vai + ghi chú. Chỉ cộng thêm; chạy lại vô hại.
-- Đối tác = `party_key` (D7-04, giữ như C11: MST hoặc fold(tên) — khớp tên không phân biệt hoa thường/dấu ⊇ BA 5.6a);
-- `companies` vẫn là hồ sơ (danh bạ, HD8) — vai KHÔNG tạo hàng `companies` (danh bạ HD8 "thêm công ty đã có ⇒ 409" giữ nguyên).
-- Không FK sang `contracts.contracts` (D9-02: test TRUNCATE không CASCADE; BA HD-07 xoá HĐ vẫn giữ đối tác).
CREATE TABLE IF NOT EXISTS contracts.partner_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  role text NOT NULL,
  name text,
  created_from text NOT NULL DEFAULT 'contract',
  contract_id uuid,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  first_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_roles_pkey PRIMARY KEY (id),
  CONSTRAINT partner_roles_uq UNIQUE (tenant_id, party_key, role),
  CONSTRAINT partner_roles_role_ck CHECK (role IN ('supplier', 'customer', 'commission_payer')),
  CONSTRAINT partner_roles_from_ck CHECK (created_from IN ('contract', 'backfill', 'manual')),
  CONSTRAINT partner_roles_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300 AND char_length(name) <= 300)
);
--> statement-breakpoint
-- DT-05: ghi chú theo người + ngày; xoá được (người viết hoặc quản lý — route), không sửa.
CREATE TABLE IF NOT EXISTS contracts.partner_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  body text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_notes_pkey PRIMARY KEY (id),
  CONSTRAINT partner_notes_source_ck CHECK (source IN ('manual', 'internet')),
  CONSTRAINT partner_notes_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300 AND char_length(body) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
-- HD-10: gõ tên không MST ⇒ khớp tên đã fold (không quét cả bảng).
CREATE INDEX IF NOT EXISTS partner_roles_name_idx ON contracts.partner_roles (tenant_id, contracts.fold(name));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_notes_party_idx ON contracts.partner_notes (tenant_id, party_key, created_at DESC, id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_roles');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_notes');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.partner_roles FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE ON contracts.partner_notes FROM contracts_rw;
--> statement-breakpoint
-- M1 (như `companies_visible` 0019): chế độ org chỉ thấy hàng của đối tác mình thấy hoặc do mình tạo; `sees_all()` như cũ.
DROP POLICY IF EXISTS partner_roles_visible ON contracts.partner_roles;
--> statement-breakpoint
CREATE POLICY partner_roles_visible ON contracts.partner_roles AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
-- Ghi: không giả tác giả (created_by = người phiên; việc nền không user ⇒ `sees_all()`).
DROP POLICY IF EXISTS partner_roles_own_ins ON contracts.partner_roles;
--> statement-breakpoint
CREATE POLICY partner_roles_own_ins ON contracts.partner_roles AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS partner_notes_visible ON contracts.partner_notes;
--> statement-breakpoint
CREATE POLICY partner_notes_visible ON contracts.partner_notes AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
DROP POLICY IF EXISTS partner_notes_visible_del ON contracts.partner_notes;
--> statement-breakpoint
CREATE POLICY partner_notes_visible_del ON contracts.partner_notes AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
-- Thêm ghi chú: tác giả = người phiên VÀ đối tác mình thấy (vai/danh bạ qua RLS của chính bảng đó, hoặc khoá bên thấy được).
DROP POLICY IF EXISTS partner_notes_ins ON contracts.partner_notes;
--> statement-breakpoint
CREATE POLICY partner_notes_ins ON contracts.partner_notes AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT contracts.sees_all())
    OR (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND (party_key = ANY ((SELECT contracts.visible_party_keys())::text[])
        OR EXISTS (SELECT 1 FROM contracts.partner_roles r
          WHERE r.tenant_id = partner_notes.tenant_id AND r.party_key = partner_notes.party_key)
        OR EXISTS (SELECT 1 FROM contracts.companies co
          WHERE co.tenant_id = partner_notes.tenant_id AND co.party_key = partner_notes.party_key))));
--> statement-breakpoint
-- 5.6b: vai theo loại HĐ (`deal` của V2-A 0022; null ⇒ suy từ `direction`) — Mua → NCC, Bán → khách, Giới thiệu → bên trả HH.
-- Bên đối tác theo `direction` (≡ lịch HD7): `sale` (gồm Giới thiệu, V2-A: tiền vào) ⇒ bên mua `buyer_*`, `purchase` ⇒ bên bán.
CREATE OR REPLACE FUNCTION contracts.partner_role_of(c contracts.contracts)
  RETURNS TABLE (party_key text, role text, name text)
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT contracts.party_key(c.fields -> (s.side || '_name') ->> 'value', c.fields -> (s.side || '_tax_id') ->> 'value'),
    s.role, left(nullif(btrim(c.fields -> (s.side || '_name') ->> 'value'), ''), 300)
  FROM (SELECT CASE d WHEN 'buy' THEN 'supplier' WHEN 'sell' THEN 'customer' WHEN 'referral' THEN 'commission_payer' END AS role,
          CASE WHEN c.direction = 'sale' THEN 'buyer' ELSE 'supplier' END AS side
        FROM (SELECT coalesce(c.deal, CASE c.direction WHEN 'purchase' THEN 'buy' WHEN 'sale' THEN 'sell' END) AS d) x) s
  WHERE s.role IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.partner_role_of(contracts.contracts) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.partner_role_of(contracts.contracts) TO contracts_rw;
--> statement-breakpoint
-- 5.6b/c + HD-09: "tạo khi lưu" = HĐ (kind contract) ở trạng thái đã xác nhận (tập HD4/HD7, như `visible_party_keys()`): thêm vai còn
-- thiếu, có rồi ⇒ không làm gì. Theo tập (Luật 4c): trigger CÂU LỆNH + bảng chuyển tiếp ⇒ một INSERT mỗi câu bất kể số hàng
-- (nhập lô I1). UPDATE chỉ xét hàng đổi `fields`/`direction` hoặc vừa vào trạng thái đã xác nhận (vòng nhắc HD4 đổi trạng thái giữa
-- các mức đã xác nhận ⇒ không ghi). Chạy quyền người gọi (RLS + policy tác giả ở trên).
CREATE OR REPLACE FUNCTION contracts.v2c_partner_roles() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  me uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by)
    SELECT n.tenant_id, r.party_key, r.role, r.name, 'contract', n.id, coalesce(me, n.created_by)
    FROM v2c_new n CROSS JOIN LATERAL contracts.partner_role_of(n) r
    WHERE n.kind = 'contract' AND n.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
      AND char_length(r.party_key) <= 300
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  ELSE
    INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by)
    SELECT n.tenant_id, r.party_key, r.role, r.name, 'contract', n.id, coalesce(me, n.created_by)
    FROM v2c_new n JOIN v2c_old o ON o.id = n.id
      CROSS JOIN LATERAL contracts.partner_role_of(n) r
    WHERE n.kind = 'contract' AND n.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
      AND (o.fields IS DISTINCT FROM n.fields OR o.direction IS DISTINCT FROM n.direction OR o.deal IS DISTINCT FROM n.deal
        OR o.status NOT IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))
      AND char_length(r.party_key) <= 300
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2c_partner_roles() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2c_partner_roles() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2c_roles_ins ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_v2c_roles_ins AFTER INSERT ON contracts.contracts
  REFERENCING NEW TABLE AS v2c_new FOR EACH STATEMENT EXECUTE FUNCTION contracts.v2c_partner_roles();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2c_roles_upd ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_v2c_roles_upd AFTER UPDATE ON contracts.contracts
  REFERENCING OLD TABLE AS v2c_old NEW TABLE AS v2c_new FOR EACH STATEMENT EXECUTE FUNCTION contracts.v2c_partner_roles();
--> statement-breakpoint
-- Dữ liệu cũ: vai từ HĐ đã xác nhận, HĐ sớm nhất làm gốc (tên, người tạo). Một câu.
INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by, first_at)
SELECT DISTINCT ON (c.tenant_id, r.party_key, r.role) c.tenant_id, r.party_key, r.role, r.name, 'backfill', c.id, c.created_by,
  c.created_at
FROM contracts.contracts c CROSS JOIN LATERAL contracts.partner_role_of(c) r
WHERE c.kind = 'contract' AND c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') AND char_length(r.party_key) <= 300
ORDER BY c.tenant_id, r.party_key, r.role, c.created_at, c.id
ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
