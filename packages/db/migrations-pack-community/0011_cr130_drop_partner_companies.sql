-- CR-130 pha 2 · L2 · ADR-0043: MỘT nguồn đối tác. Nhãn vai/nhóm hàng/khu vực của công ty đối tác nằm ở gói `contracts`
-- (`partner_roles` + `partner_profiles`); RLS Bảng tin đọc qua MỘT hàm cổng `contracts.community_partners(uuid[])` (contracts 0103).
-- `community.partner_companies` gỡ hẳn (chưa có khách dùng thật ⇒ không backfill). Vai Bảng tin: `supplier` | `customer`
-- (`buyer` cũ ⇒ `customer`, một tên với SHT). CHECK `aud_mode` vẫn là `buyers` (tên chế độ audience, không đổi).
-- `community_rw` do 0001 tạo SAU contracts trên DB mới ⇒ cấp tại đây: chỉ USAGE schema + EXECUTE hàm, KHÔNG quyền bảng.
GRANT USAGE ON SCHEMA contracts TO community_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.community_partners(uuid[]) TO community_rw;
--> statement-breakpoint
-- Vai + nhóm hàng của CHÍNH công ty người xem (đối tác); chủ quản (viewer NULL ⇒ mảng NULL ⇒ không hàng)/chưa có hồ sơ ⇒ rỗng.
-- INVOKER; hàm cổng DEFINER tự khoá tenant (GUC) + người xem. Gọi trong `(SELECT …)` của policy ⇒ chạy MỘT lần mỗi câu.
CREATE OR REPLACE FUNCTION community.viewer_labels() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT cp.roles FROM contracts.community_partners(ARRAY[packs.viewer_ext_org()]) cp), '{}'::text[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.viewer_cats() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT cp.cats FROM contracts.community_partners(ARRAY[packs.viewer_ext_org()]) cp), '{}'::text[])
$$;
--> statement-breakpoint
-- D2 (trùng `domain/audience.rules.ts`): `buyer` ⇒ `customer`.
CREATE OR REPLACE FUNCTION community.audience_ok(
  p_mode text, p_cats text[], p_orgs uuid[], p_type text, p_post_cats text[],
  v_org uuid, v_labels text[], v_cats text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_mode
    WHEN 'all' THEN true
    WHEN 'suppliers' THEN 'supplier' = ANY (v_labels)
    WHEN 'buyers' THEN 'customer' = ANY (v_labels)
    WHEN 'companies' THEN v_org = ANY (p_orgs)
    WHEN 'cats' THEN (CASE WHEN cardinality(p_cats) > 0 THEN p_cats ELSE p_post_cats END) && v_cats
      AND CASE p_type WHEN 'sell' THEN 'customer' = ANY (v_labels)
                      WHEN 'buy' THEN 'supplier' = ANY (v_labels) ELSE true END
    ELSE false
  END
$$;
--> statement-breakpoint
DROP TABLE IF EXISTS community.partner_companies CASCADE;
