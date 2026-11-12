-- CR-130 pha 2 · L2 · ADR-0043 · cổng GHI duy nhất community → SHT: `contracts.community_link_partner` liên kết tài khoản công ty đối tác
-- (`ext_org_id`) với một đối tác SHT khi Admin chủ quản duyệt yêu cầu tham gia (vai `partner_roles` + hồ sơ `partner_profiles`).
-- SECURITY DEFINER (community_rw không có quyền bảng `contracts.*`; chạy ngay trong tx duyệt ⇒ rollback chung). Tenant chỉ từ GUC
-- `app.tenant_id` (KHÔNG từ tham số). Người xem là đối tác (user ngoài) hoặc thiếu tenant ⇒ 42501. Idempotent; vai chỉ THÊM.
-- Khoá đối tác: (1) đã có hồ sơ cho tài khoản này ⇒ giữ; (2) đối tác SHT trùng tên (đã fold) chưa gắn tài khoản ⇒ dùng lại;
-- (3) mới `name:<fold>` (khoá đã có tài khoản khác giữ ⇒ `name:<fold>|<org>`). Tài khoản đã gắn đối tác khác ⇒ linked = false.
CREATE OR REPLACE FUNCTION contracts.community_link_partner(p_org uuid, p_name text, p_roles text[])
  RETURNS TABLE (o_party text, o_linked boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_t uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_t IS NULL OR packs.viewer_ext_org() IS NOT NULL THEN
    RAISE EXCEPTION 'community_link_partner: chỉ người nội bộ trong phạm vi tenant' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR p_name IS NULL OR btrim(p_name) = '' OR NOT (coalesce(p_roles, '{}') <@ ARRAY['supplier', 'customer']::text[]) THEN
    RAISE EXCEPTION 'community_link_partner: tham số không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH ex AS (SELECT pp.party_key FROM contracts.partner_profiles pp WHERE pp.tenant_id = v_t AND pp.ext_org_id = p_org),
    f AS (SELECT coalesce(nullif(contracts.fold(p_name), ''), p_org::text) AS f),
    same AS (SELECT pr.party_key FROM contracts.partner_roles pr, f
      WHERE pr.tenant_id = v_t AND contracts.fold(pr.name) = f.f
        AND NOT EXISTS (SELECT 1 FROM contracts.partner_profiles q
          WHERE q.tenant_id = pr.tenant_id AND q.party_key = pr.party_key AND q.ext_org_id IS NOT NULL)
      ORDER BY pr.first_at, pr.party_key LIMIT 1),
    k AS (SELECT coalesce((SELECT party_key FROM ex), (SELECT party_key FROM same),
        CASE WHEN EXISTS (SELECT 1 FROM contracts.partner_profiles q, f
            WHERE q.tenant_id = v_t AND q.party_key = 'name:' || f.f AND q.ext_org_id IS NOT NULL)
          THEN 'name:' || (SELECT f FROM f) || '|' || p_org::text ELSE 'name:' || (SELECT f FROM f) END) AS pk),
    r AS (INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from)
      SELECT v_t, k.pk, x.role, left(p_name, 300), 'manual' FROM k, unnest(coalesce(p_roles, '{}')) AS x(role)
      ON CONFLICT (tenant_id, party_key, role) DO NOTHING RETURNING 1),
    p AS (INSERT INTO contracts.partner_profiles AS pp (tenant_id, party_key, ext_org_id, invited_at)
      SELECT v_t, k.pk, p_org, now() FROM k
      ON CONFLICT (tenant_id, party_key) DO UPDATE SET ext_org_id = coalesce(pp.ext_org_id, excluded.ext_org_id),
        invited_at = coalesce(pp.invited_at, excluded.invited_at), updated_at = now()
      RETURNING pp.ext_org_id)
  SELECT (SELECT pk FROM k), (SELECT ext_org_id FROM p) = p_org WHERE (SELECT count(*) FROM r) >= 0;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.community_link_partner(uuid, text, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.community_link_partner(uuid, text, text[]) TO contracts_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_rw') THEN
    GRANT USAGE ON SCHEMA contracts TO community_rw;
    GRANT EXECUTE ON FUNCTION contracts.community_link_partner(uuid, text, text[]) TO community_rw;
  END IF;
END $$;
