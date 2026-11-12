-- CR-130 pha 2 · L1 · ADR-0043: MỘT nguồn đối tác. Hồ sơ đối tác (nhóm hàng, khu vực, tài khoản công ty trên Bảng tin) nằm ở gói
-- `contracts` cạnh `partner_roles` (vai NCC/khách); `community.partner_companies` sẽ gỡ ở lát L2. Chưa có khách dùng thật ⇒ không backfill.
-- Khoá `(tenant_id, party_key)` (`tax:<MST>` / `name:<fold>`, như `partner_roles`). Không FK sang `admin.external_orgs` (luật pack-sql):
-- usecase kiểm `ext_org_id` thuộc tenant + còn hiệu lực qua `ExtDirectory` trước khi ghi. Chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.partner_profiles (
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  cats text[] NOT NULL DEFAULT '{}',
  area text NOT NULL DEFAULT '',
  ext_org_id uuid,
  invited_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  CONSTRAINT partner_profiles_pkey PRIMARY KEY (tenant_id, party_key),
  -- Một tài khoản công ty chỉ gắn một đối tác (NULL không tính trùng); đồng thời là index tra theo `ext_org_id` của hàm đọc.
  CONSTRAINT partner_profiles_org_uq UNIQUE (tenant_id, ext_org_id),
  CONSTRAINT partner_profiles_key_ck CHECK (char_length(party_key) BETWEEN 1 AND 300),
  CONSTRAINT partner_profiles_cats_ck CHECK (cardinality(cats) <= 50),
  CONSTRAINT partner_profiles_area_ck CHECK (char_length(area) <= 100)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_profiles');
--> statement-breakpoint
-- Role gói gọi được hàm người xem của kit (policy dưới). `packs.install` chỉ cấp cho role ở gói đã dùng chúng.
GRANT USAGE ON SCHEMA packs TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.viewer_ext_org(), packs.viewer_is_admin(text) TO contracts_rw;
--> statement-breakpoint
-- Đọc: người nội bộ theo luật thấy như `partner_roles_visible` (M1: thấy hết / do mình ghi / đối tác mình thấy); đối tác (user ngoài)
-- chỉ hàng của công ty mình; user ngoài bị từ chối (nil) ⇒ không hàng nào. Việc nền (không user) ⇒ `sees_all()` đúng.
DROP POLICY IF EXISTS partner_profiles_visible ON contracts.partner_profiles;
--> statement-breakpoint
CREATE POLICY partner_profiles_visible ON contracts.partner_profiles AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (CASE WHEN (SELECT packs.viewer_ext_org()) IS NOT NULL
    THEN ext_org_id = (SELECT packs.viewer_ext_org())
    ELSE (SELECT contracts.sees_all())
      OR updated_by = NULLIF(current_setting('app.user_id', true), '')::uuid
      OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]) END);
--> statement-breakpoint
-- Ghi: chỉ người nội bộ là quản trị gói (`tenant_admin` hoặc nhóm `contracts-admin`) hoặc việc nền (không user). Đối tác không ghi.
DROP POLICY IF EXISTS partner_profiles_write_ins ON contracts.partner_profiles;
--> statement-breakpoint
CREATE POLICY partner_profiles_write_ins ON contracts.partner_profiles AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL
    AND (coalesce(current_setting('app.user_id', true), '') = '' OR (SELECT packs.viewer_is_admin('contracts'))));
--> statement-breakpoint
DROP POLICY IF EXISTS partner_profiles_write_upd ON contracts.partner_profiles;
--> statement-breakpoint
CREATE POLICY partner_profiles_write_upd ON contracts.partner_profiles AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL
    AND (coalesce(current_setting('app.user_id', true), '') = '' OR (SELECT packs.viewer_is_admin('contracts'))))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL
    AND (coalesce(current_setting('app.user_id', true), '') = '' OR (SELECT packs.viewer_is_admin('contracts'))));
--> statement-breakpoint
DROP POLICY IF EXISTS partner_profiles_write_del ON contracts.partner_profiles;
--> statement-breakpoint
CREATE POLICY partner_profiles_write_del ON contracts.partner_profiles AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL
    AND (coalesce(current_setting('app.user_id', true), '') = '' OR (SELECT packs.viewer_is_admin('contracts'))));
--> statement-breakpoint
-- Cổng đọc cho RLS Bảng tin (ADR-0043): gói `community` cần nhãn/nhóm hàng/tên của đối tác ngay trong SQL. MỘT câu, lọc
-- `ext_org_id = ANY(p_orgs)` qua UNIQUE (tenant_id, ext_org_id). SECURITY DEFINER (chủ migration) vì `community_rw` không có quyền bảng
-- `contracts.*`; tenant lấy từ GUC `app.tenant_id` (KHÔNG từ tham số) + lọc tường minh ⇒ không đọc chéo tenant; người xem là đối tác
-- (`packs.viewer_ext_org()` khác NULL) chỉ nhận hàng của chính công ty mình. Tên = tên SHT: vai mới nhất → hồ sơ công ty → khách CKS (MST)
-- → khoá đối tác. Vai chỉ `supplier`/`customer` (bên trả hoa hồng không phải vai Bảng tin).
CREATE OR REPLACE FUNCTION contracts.community_partners(p_orgs uuid[])
  RETURNS TABLE (ext_org_id uuid, party_key text, name text, roles text[], cats text[], area text)
  LANGUAGE sql STABLE SECURITY DEFINER ROWS 20 SET search_path = pg_catalog, pg_temp AS $$
  WITH me AS (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS t, packs.viewer_ext_org() AS v)
  SELECT pp.ext_org_id, pp.party_key,
    coalesce(
      (SELECT r.name FROM contracts.partner_roles r
        WHERE r.tenant_id = pp.tenant_id AND r.party_key = pp.party_key AND r.name IS NOT NULL AND r.name <> ''
        ORDER BY r.first_at DESC, r.id LIMIT 1),
      (SELECT co.name FROM contracts.companies co
        WHERE co.tenant_id = pp.tenant_id AND co.party_key = pp.party_key AND co.name IS NOT NULL AND co.name <> ''
        LIMIT 1),
      (SELECT cu.name FROM contracts.cks_customers cu
        WHERE cu.tenant_id = pp.tenant_id AND left(pp.party_key, 4) = 'tax:' AND cu.tax_id = substr(pp.party_key, 5)
        LIMIT 1),
      pp.party_key),
    coalesce((SELECT array_agg(r.role ORDER BY r.role) FROM contracts.partner_roles r
        WHERE r.tenant_id = pp.tenant_id AND r.party_key = pp.party_key AND r.role IN ('supplier', 'customer')),
      '{}'::text[]),
    pp.cats, pp.area
  FROM me JOIN contracts.partner_profiles pp ON pp.tenant_id = me.t
  WHERE pp.ext_org_id = ANY (p_orgs) AND (me.v IS NULL OR pp.ext_org_id = me.v)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.community_partners(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.community_partners(uuid[]) TO contracts_rw;
--> statement-breakpoint
-- `community_rw` do `packs.install('community')` (0001 của gói đó) tạo SAU gói này trên DB mới ⇒ khối dưới chỉ phục vụ DB đã có role;
-- community 0011 (L2) cấp lại (idempotent). Chỉ USAGE schema + EXECUTE hàm này — KHÔNG quyền bảng.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_rw') THEN
    GRANT USAGE ON SCHEMA contracts TO community_rw;
    GRANT EXECUTE ON FUNCTION contracts.community_partners(uuid[]) TO community_rw;
  END IF;
END $$;
