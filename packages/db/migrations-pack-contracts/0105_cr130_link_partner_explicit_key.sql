-- CR-130 pha 2 · L2 (soát) · ADR-0043 · sửa `contracts.community_link_partner` (0104 đã áp ⇒ migration mới, không sửa 0104).
-- (1) BỎ tự gắn tài khoản vào đối tác SHT trùng tên: tên đến từ form do công ty ngoài tự gõ ⇒ có thể mạo danh đối tác thật. Nay hàm nhận
--     `p_party_key` do ADMIN chọn tường minh khi duyệt: có ⇒ gắn vào đối tác đó (đã gắn tài khoản khác ⇒ PARTNER_ALREADY_LINKED 23505;
--     không có đối tác ⇒ PARTNER_NOT_FOUND 22023); NULL ⇒ luôn tạo khoá MỚI `name:<fold>` (khoá đã có ở SHT ⇒ thêm `|<org>`; không bao giờ
--     gắn vào đối tác có sẵn). Tài khoản đã có hồ sơ ⇒ giữ khoá (idempotent), `p_party_key` khác khoá đó ⇒ PARTNER_ALREADY_LINKED.
-- (2) `p_org` phải thuộc tenant hiện tại (`admin.external_orgs`, hàm DEFINER đọc được) ⇒ ORG_NOT_IN_TENANT 42501.
-- (3) Bỏ EXECUTE của `contracts_rw` (không chỗ nào gọi; community gọi trong tx của mình). Bản 3 tham số giữ làm vỏ (community 0012 đã
--     GRANT nó; DB mới chạy 0012 sau contracts) — gọi bản mới với `p_party_key = NULL`.
CREATE OR REPLACE FUNCTION contracts.community_link_partner(p_org uuid, p_name text, p_roles text[], p_party_key text)
  RETURNS TABLE (o_party text, o_linked boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_t uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_key text;
  v_name text;
  v_fold text;
BEGIN
  IF v_t IS NULL OR packs.viewer_ext_org() IS NOT NULL THEN
    RAISE EXCEPTION 'community_link_partner: chỉ người nội bộ trong phạm vi tenant' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR p_name IS NULL OR btrim(p_name) = '' OR NOT (coalesce(p_roles, '{}') <@ ARRAY['supplier', 'customer']::text[])
    OR (p_party_key IS NOT NULL AND char_length(p_party_key) NOT BETWEEN 1 AND 300) THEN
    RAISE EXCEPTION 'community_link_partner: tham số không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.external_orgs o WHERE o.id = p_org AND o.tenant_id = v_t) THEN
    RAISE EXCEPTION 'ORG_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;
  SELECT pp.party_key INTO v_key FROM contracts.partner_profiles pp WHERE pp.tenant_id = v_t AND pp.ext_org_id = p_org;
  IF v_key IS NOT NULL THEN
    IF p_party_key IS NOT NULL AND p_party_key <> v_key THEN
      RAISE EXCEPTION 'PARTNER_ALREADY_LINKED' USING ERRCODE = '23505';
    END IF;
  ELSIF p_party_key IS NOT NULL THEN
    IF NOT (EXISTS (SELECT 1 FROM contracts.partner_roles r WHERE r.tenant_id = v_t AND r.party_key = p_party_key)
      OR EXISTS (SELECT 1 FROM contracts.partner_profiles q WHERE q.tenant_id = v_t AND q.party_key = p_party_key)
      OR EXISTS (SELECT 1 FROM contracts.companies c WHERE c.tenant_id = v_t AND c.party_key = p_party_key)) THEN
      RAISE EXCEPTION 'PARTNER_NOT_FOUND' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM contracts.partner_profiles q
      WHERE q.tenant_id = v_t AND q.party_key = p_party_key AND q.ext_org_id IS NOT NULL AND q.ext_org_id <> p_org) THEN
      RAISE EXCEPTION 'PARTNER_ALREADY_LINKED' USING ERRCODE = '23505';
    END IF;
    v_key := p_party_key;
  ELSE
    v_fold := coalesce(nullif(contracts.fold(p_name), ''), p_org::text);
    v_key := 'name:' || v_fold;
    IF EXISTS (SELECT 1 FROM contracts.partner_roles r WHERE r.tenant_id = v_t AND r.party_key = v_key)
      OR EXISTS (SELECT 1 FROM contracts.partner_profiles q WHERE q.tenant_id = v_t AND q.party_key = v_key)
      OR EXISTS (SELECT 1 FROM contracts.companies c WHERE c.tenant_id = v_t AND c.party_key = v_key) THEN
      v_key := v_key || '|' || p_org::text;
    END IF;
  END IF;
  -- Tên vai: đối tác có sẵn ⇒ giữ tên SHT của nó (không để chữ do công ty ngoài gõ thành tên hiển thị); mới ⇒ tên đã gõ.
  v_name := coalesce((SELECT r.name FROM contracts.partner_roles r
    WHERE r.tenant_id = v_t AND r.party_key = v_key AND r.name IS NOT NULL AND r.name <> '' ORDER BY r.first_at, r.id LIMIT 1), left(p_name, 300));
  INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from)
    SELECT v_t, v_key, x.role, v_name, 'manual' FROM unnest(coalesce(p_roles, '{}')) AS x(role)
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  INSERT INTO contracts.partner_profiles AS pp (tenant_id, party_key, ext_org_id, invited_at)
    VALUES (v_t, v_key, p_org, now())
    ON CONFLICT (tenant_id, party_key) DO UPDATE SET ext_org_id = coalesce(pp.ext_org_id, excluded.ext_org_id),
      invited_at = coalesce(pp.invited_at, excluded.invited_at), updated_at = now();
  RETURN QUERY SELECT v_key, true;
END
$$;
--> statement-breakpoint
-- Vỏ tương thích (community 0012 GRANT chữ ký này): luôn tạo khoá mới.
CREATE OR REPLACE FUNCTION contracts.community_link_partner(p_org uuid, p_name text, p_roles text[])
  RETURNS TABLE (o_party text, o_linked boolean)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT * FROM contracts.community_link_partner(p_org, p_name, p_roles, NULL::text)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.community_link_partner(uuid, text, text[], text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.community_link_partner(uuid, text, text[]) FROM PUBLIC, contracts_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_rw') THEN
    GRANT USAGE ON SCHEMA contracts TO community_rw;
    GRANT EXECUTE ON FUNCTION contracts.community_link_partner(uuid, text, text[], text) TO community_rw;
  END IF;
END $$;
